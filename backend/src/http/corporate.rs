use std::sync::Arc;

use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    ApiError, AppState,
    error::ApiResult,
    model::{PaymentKind, PaymentRequest},
    payments,
};

use super::auth::authorize;

/// Parses the corporate wire format separately from persisted and legacy requests.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CorporatePayment {
    merchant: String,
    #[serde(rename = "type")]
    payment_type: Value,
    reference: String,
    amount: Value,
    currency: String,
    #[serde(alias = "callbackUrl")]
    callback_url: String,
    phone: Option<String>,
    approve_url: Option<String>,
    cancel_url: Option<String>,
    decline_url: Option<String>,
}

impl CorporatePayment {
    fn into_request(self) -> ApiResult<(PaymentRequest, PaymentKind)> {
        let kind = match self.payment_type {
            Value::String(ref value) if value == "1" => PaymentKind::Mobile,
            Value::String(ref value) if value == "2" => PaymentKind::Card,
            Value::Number(ref value) if value.as_u64() == Some(1) => PaymentKind::Mobile,
            Value::Number(ref value) if value.as_u64() == Some(2) => PaymentKind::Card,
            _ => return Err(ApiError::Invalid("type must be 1 or 2".into())),
        };

        if kind == PaymentKind::Card && self.phone.is_some()
            || kind == PaymentKind::Mobile
                && (self.approve_url.is_some()
                    || self.cancel_url.is_some()
                    || self.decline_url.is_some())
        {
            return Err(ApiError::Invalid(
                "phone belongs to mobile payments; return URLs belong to card payments".into(),
            ));
        }

        Ok((
            PaymentRequest {
                merchant: self.merchant,
                authorization: None,
                payment_type: Some(self.payment_type),
                reference: self.reference,
                phone: self.phone,
                amount: self.amount,
                currency: self.currency,
                callback_url: self.callback_url,
                description: None,
                approve_url: self.approve_url,
                cancel_url: self.cancel_url,
                decline_url: self.decline_url,
                home_url: None,
            },
            kind,
        ))
    }
}

pub(super) async fn pay(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Result<Json<CorporatePayment>, JsonRejection>,
) -> ApiResult<Json<Value>> {
    authorize(&state, &headers, None)?;

    let Json(body) = body.map_err(|error| ApiError::Invalid(error.body_text()))?;

    if body.merchant != state.merchant {
        return Err(ApiError::Unauthorized);
    }

    let (request, kind) = body.into_request()?;
    let mut response = payments::create(state, request, kind).await?;
    response["code"] = Value::String("0".into());

    Ok(Json(response))
}
