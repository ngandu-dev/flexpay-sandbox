use flexpay_sandbox::{seeds, store::Store};
use reqwest::Client;
use serde_json::{Value, json};

use crate::common::{check, create, mobile, server};

fn card(callback: &str) -> Value {
    json!({
        "merchant": "TESTMERCHANT",
        "type": "2",
        "reference": "corporate-card-order",
        "amount": "100",
        "currency": "CDF",
        "callback_url": callback,
        "approve_url": "http://localhost/approved",
        "cancel_url": "http://localhost/cancelled",
        "decline_url": "http://localhost/declined",
    })
}

#[tokio::test]
async fn corporate_card_uses_shared_endpoint_and_hosted_outcomes() {
    let (base, state) = server().await;

    for (number, expected, redirect) in [
        ("4242424242424242", 0, Some("http://localhost/approved")),
        ("4000000000000002", 1, Some("http://localhost/declined")),
        ("4000000000003220", 2, None),
    ] {
        let response = create(
            &base,
            &card("http://127.0.0.1:1/callback"),
            "/api/rest/v1/paymentService",
        )
        .await;
        assert_eq!(response["code"], "0");
        let id = response["orderNumber"].as_str().unwrap();
        assert_eq!(response["url"], format!("{base}/checkout/{id}"));
        assert_eq!(check(&base, id).await["transaction"]["status"], "2");
        let completed: Value = Client::new()
            .post(format!("{base}/api/simulator/checkout/{id}"))
            .json(&json!({"cardNumber": number}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(completed["status"], expected);
        assert_eq!(completed["redirectUrl"], json!(redirect));
        assert_eq!(
            check(&base, id).await["transaction"]["status"],
            expected.to_string()
        );
        let transaction = state.store.get(id).await.unwrap().unwrap();
        assert_eq!(transaction.callback()["channel"], "visa");
        assert!(transaction.callback().get("message").is_none());
        assert!(transaction.request.authorization.is_none());
    }

    state.shutdown.cancel();
}

#[tokio::test]
async fn corporate_accepts_both_callback_spellings_for_mobile_and_card() {
    let (base, state) = server().await;
    let callback = "http://127.0.0.1:1/callback";

    for mut body in [mobile("243810000003", callback), card(callback)] {
        for spelling in ["callback_url", "callbackUrl"] {
            body.as_object_mut().unwrap().remove("callback_url");
            body.as_object_mut().unwrap().remove("callbackUrl");
            body[spelling] = json!(callback);

            let response = create(&base, &body, "/api/rest/v1/paymentService").await;
            assert_eq!(response["code"], "0");
            let id = response["orderNumber"].as_str().unwrap();
            let transaction = state.store.get(id).await.unwrap().unwrap();
            assert_eq!(transaction.request.callback_url, callback);
            assert_eq!(transaction.status, 2);
            assert!(transaction.callback_attempts.is_empty());
        }
    }

    assert_eq!(state.store.list().await.unwrap().len(), 4);
    state.shutdown.cancel();
}

#[tokio::test]
async fn corporate_rejects_both_callback_names_in_one_request() {
    let (base, state) = server().await;
    let callback = "http://127.0.0.1:1/callback";

    for mut body in [mobile("243810000003", callback), card(callback)] {
        for alias_value in [callback, "http://127.0.0.1:1/different-callback"] {
            body["callbackUrl"] = json!(alias_value);

            let response = Client::new()
                .post(format!("{base}/api/rest/v1/paymentService"))
                .bearer_auth("test-token")
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 400);
            let error: Value = response.json().await.unwrap();
            assert!(
                error["message"]
                    .as_str()
                    .unwrap()
                    .contains("duplicate field")
            );
        }
    }

    assert!(state.store.list().await.unwrap().is_empty());
    state.shutdown.cancel();
}

#[tokio::test]
async fn corporate_rejects_legacy_fields_wrong_types_and_missing_header() {
    let (base, state) = server().await;
    let valid = card("http://localhost/callback");
    let mut invalid = Vec::new();

    for (key, value) in [
        ("authorization", json!("Bearer test-token")),
        ("description", json!("Legacy description")),
        ("home_url", json!("http://localhost")),
        ("phone", json!("243810000001")),
        ("type", json!(3)),
        ("type", json!(null)),
    ] {
        let mut body = valid.clone();
        body[key] = value;
        invalid.push(body);
    }

    for key in [
        "type",
        "callback_url",
        "approve_url",
        "cancel_url",
        "decline_url",
    ] {
        let mut body = valid.clone();
        body.as_object_mut().unwrap().remove(key);
        invalid.push(body);
    }

    let mut wrong_mobile = mobile("243810000001", "http://localhost/callback");
    wrong_mobile["approve_url"] = json!("http://localhost/approved");
    invalid.push(wrong_mobile);

    for body in invalid {
        let response = Client::new()
            .post(format!("{base}/api/rest/v1/paymentService"))
            .bearer_auth("test-token")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400, "Accepted invalid request: {body}");
    }

    let mut body_token = valid.clone();
    body_token["authorization"] = json!("Bearer test-token");
    let response = Client::new()
        .post(format!("{base}/api/rest/v1/paymentService"))
        .json(&body_token)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    assert!(state.store.list().await.unwrap().is_empty());
    state.shutdown.cancel();
}

#[tokio::test]
async fn seeds_are_repeatable_preserve_existing_state_and_never_deliver_callbacks() {
    let store = Store::open(":memory:").unwrap();
    assert_eq!(seeds::seed(&store, "TESTMERCHANT").await.unwrap(), 6);
    let initial = serde_json::to_value(store.list().await.unwrap()).unwrap();
    assert_eq!(seeds::seed(&store, "CHANGED").await.unwrap(), 0);
    assert_eq!(
        initial,
        serde_json::to_value(store.list().await.unwrap()).unwrap()
    );

    for kind in ["mobile", "card"] {
        for (outcome, expected) in [("success", 0), ("failure", 1), ("pending", 2)] {
            let id = format!("SIM-SEED-{kind}-{outcome}");
            let transaction = store.get(&id).await.unwrap().unwrap();
            assert_eq!(transaction.status, expected);
            assert_eq!(transaction.kind, kind);
            assert!(transaction.callback_attempts.is_empty());
            assert_eq!(
                transaction.callback()["code"],
                if expected == 0 { "0" } else { "1" }
            );
        }
    }
}
