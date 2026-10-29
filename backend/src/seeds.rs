//! Repeatable demonstration transactions. Seeding never schedules callbacks.

use anyhow::Result;
use rusqlite::params;
use serde_json::json;

use crate::{
    model::{PaymentRequest, Transaction},
    store::Store,
};

pub async fn seed(store: &Store, merchant: &str) -> Result<usize> {
    let mut records = Vec::new();

    for (kind, payment_type) in [("mobile", "1"), ("card", "2")] {
        for (outcome, status, phone) in [
            ("success", 0, "243810000001"),
            ("failure", 1, "243810000002"),
            ("pending", 2, "243810000003"),
        ] {
            let reference = format!("seed-{kind}-{outcome}");
            let order_number = format!("SIM-SEED-{kind}-{outcome}");
            let card = kind == "card";
            let request = PaymentRequest {
                merchant: merchant.into(),
                authorization: None,
                payment_type: Some(json!(payment_type)),
                reference,
                phone: (!card).then(|| phone.into()),
                amount: json!("25.00"),
                currency: "USD".into(),
                callback_url: "http://127.0.0.1:1/seed-callback".into(),
                description: None,
                approve_url: card.then(|| "http://localhost/approved".into()),
                cancel_url: card.then(|| "http://localhost/cancelled".into()),
                decline_url: card.then(|| "http://localhost/declined".into()),
                home_url: None,
            };

            let transaction = Transaction {
                order_number,
                kind: kind.into(),
                request,
                amount: "25.00".into(),
                amount_customer: "25.63".into(),
                status,
                channel: if card { "visa" } else { "mpesa" }.into(),
                provider_reference: if status == 0 {
                    format!("SEED-{kind}-success")
                } else {
                    String::new()
                },
                created_at: "29-10-2026 10:00:00".into(),
                callback_attempts: vec![],
            };

            records.push((
                transaction.order_number.clone(),
                serde_json::to_string(&transaction)?,
            ));
        }
    }

    store
        .run(move |db| {
            let transaction = db.unchecked_transaction()?;
            let mut inserted = 0;

            for (id, data) in records {
                inserted += transaction.execute(
                "INSERT INTO transactions (id, data) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING",
                params![id, data],
            )?;
            }

            transaction.commit()?;

            Ok(inserted)
        })
        .await
}
