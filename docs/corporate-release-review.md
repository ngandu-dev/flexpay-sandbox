# Corporate API release review

Prepared on 2026-10-29. The user approved committing the reviewed changes in all three repositories.
Tagging, package publication, and production deployment remain pending.

## Scope

| Repository | Review branch | Planned release |
| --- | --- | --- |
| `ngandu-dev/flexpay-php` | `codex/flexpay-corporate-v4` | PHP SDK 4.0.0 |
| `ngandu-dev/flexpay-ts` (local folder `flexpay`) | `codex/flexpay-corporate-v3` | TypeScript SDK 3.0.0, pending major Changeset |
| `bernard-ng/flexpay-sandbox` (local folder `flexpay-proxy`) | `codex/flexpay-corporate` | Unreleased simulator update |

The supplied corporate API document and endpoint message define the collection contract. The original PDF is not
copied into any repository. The platform application remains on its existing released SDK; migrating that consumer
requires the new package version after review.

## Contract changes

- Both mobile and card collections use `https://corporateapi.flexpay.cd/api/rest/v1/paymentService`.
- Status lookups use `https://apicheck.flexpaie.com/api/rest/v1/check/{orderNumber}`.
- Card and mobile requests use a bearer authorization header. Card bodies no longer carry the token.
- Corporate bodies use `callback_url`, plus card-only `approve_url`, `cancel_url`, and `decline_url`. Controlled
  rejection responses support recognition of `callbackUrl`; both SDKs retain the documented `callback_url` spelling.
- Card requests use type `2`; mobile requests use type `1`. Description and home URL are absent from corporate payloads.
- One required `BaseUrl` object contains `payment`, `check`, and `payout`. Each is a versioned prefix ending at
  `/api/rest/v1`, without the service name. Environment flags and individual endpoint options are removed.
- Every client requires all three destinations. Production has an explicit preset; no corporate sandbox address
  has been supplied, and no omitted endpoint silently selects a remote service.
- Payouts keep their previous endpoint and request contract because no replacement payout contract was supplied.
- A successful check requires both lookup code zero and transaction status zero. Every response code and transaction
  status is an immutable `Status` value. Its `value` preserves the provider integer, including unknown codes, without
  a union type. Simulator status `2` means pending locally; it is not a verified provider mapping.
- Payment and payout POST requests are sent once. Only status GET requests retry, because provider idempotency has not
  been established.

See `UPGRADE_4.0.0.md` in the PHP SDK and `UPGRADE_3.0.0.md` in the TypeScript SDK for constructor
changes and migration examples. Each SDK README documents its current API.

## Object design

This refactor applies the [responsibility-driven design](https://github.com/bernard-ng/skills/blob/main/skills/engineering/responsibility-driven-design/SKILL.md),
[naming](https://github.com/bernard-ng/skills/blob/main/skills/engineering/name-design-objects/SKILL.md), and
[reliable collaboration](https://github.com/bernard-ng/skills/blob/main/skills/engineering/design-reliable-collaborations/SKILL.md)
skills requested for this release. Breaking public changes are intentional; obsolete aliases are removed.

| Role | Responsibility and collaborators |
| --- | --- |
| `BaseUrl` | Holds and validates the three required versioned endpoint prefixes. The client uses these destinations for its four explicit operations. |
| Request values or schemas | Validate payment input without merchant identity or bearer tokens. They describe a mobile, card, or payout request. |
| `Client` | Coordinates `mobile`, `card`, `payout`, and `check`, delegates HTTP work, and selects the operation's response decoder. It does not infer payment type from an input object's shape. |
| `HttpTransport` | Owns authentication, request execution, deadlines, response cleanup, redirect refusal, GET retries, and HTTP diagnostics. POST requests are sent once. |
| Response decoding | Translates provider fields into operation-specific results and detects invalid payloads while retaining HTTP context. Callback parsing works without constructing a client. |
| `Status` | Preserves one integer code and interprets only the documented zero/success and one/failure values. Other codes remain uninterpreted. |
| Initiation, callback, and check results | Distinguish request acceptance from reported payment success. Check success also requires a successful nested transaction. |

A mobile request flows from validated input through the client to transport. The request is encoded with merchant
identity and sent once with a bearer header. The initiation result reports acceptance and an order
number. A later check follows the separate check destination and evaluates the transaction's `Status`.

If the provider accepts that POST but the connection drops before its response arrives, transport raises a network
error and does not retry the payment. The caller owns reconciliation. A malformed response has the same uncertainty
about payment acceptance; it must not be converted into a rejected-payment result. Status GET requests can retry
within their fixed retry and deadline limits. Redirects are refused rather than replayed at another destination.
Transport closes an unfinished redirect response. A response header that suppresses retries keeps that decision
even if reading the body later fails. Both behaviors have regression coverage.

PHP exposes `isAccepted()` on initiation results and `isSuccessful()` on callback/check results. TypeScript results
have readonly `accepted` or `successful` properties derived from their immutable `Status` values. Callback success
only describes the supplied payload; parsing does not authenticate the sender or authorize order fulfillment.

No environment compatibility wrapper, generic `pay()` dispatcher, mutable request credentials, generic operation
registry, polling workflow, or provider-specific pending-state assumption is retained. Payout's existing wire
protocol remains because the provider has supplied no replacement.

## Repeatable cross-client verification

Install both SDKs' development dependencies and the sandbox frontend dependencies, then build the dashboard and run:

```sh
bun run --cwd frontend build
bash scripts/check-clients.sh /absolute/path/to/flexpay-php /absolute/path/to/flexpay-ts
```

The script builds the native sandbox and TypeScript distributions. It creates a temporary SQLite database, runs the
seed command twice, starts a loopback sandbox and callback receiver on temporary ports, and exercises both SDKs.
It stops its processes and removes its temporary database after completion. It uses fixed test credentials only.

Each SDK creates mobile success, failure, and pending payments; card success, failure, pending, and cancelled payments;
and a payout. Assertions cover status interpretation, provider references, callback payloads, replay, manual pending
resolution, hosted checkout availability, and approve/decline/cancel redirects. This is HTTP integration coverage;
browser interaction with the card form is a separate check.

The six seed records cover mobile/card success, failure, and pending. Seeding preserves existing records and sends no
callbacks. Pending seed records remain available for manual resolution in the dashboard.

## Validation results

| Check | Result |
| --- | --- |
| PHP 8.4.27 and 8.5.6 tests | Passed on both: 48 tests, 476 assertions, including the observed existing-order lookup, provider rejections, POST/DNS retry protection, and response cleanup |
| PHP ECS, Rector, PHPStan | Passed on both runtimes; PHP 8.4 PHPStan used `--memory-limit=512M` |
| Composer validation, audit, platform requirements, install dry run | Passed; zero advisories |
| Clean PHP production install and package smoke | Passed |
| TypeScript checks on Node 24.22.0 and 26.8.2 | Typechecking and all 118 tests passed on both; lint, CJS/ESM builds, publint, and Are the Types Wrong also passed. No runtime changes were needed for the latest observed-order regression. |
| TypeScript frozen install and audit | Passed; zero advisories |
| TypeScript coverage | 100% statements/lines/functions, 95.29% branches |
| Rust format, Clippy, and tests | Passed; 13 backend tests, including both callback spellings and duplicate-name rejection |
| Dashboard typecheck, tests, and build | Passed separately after the audit stopped that branch of `make check`; 8 frontend tests, 26 assertions |
| Dashboard frozen install and React Doctor | Passed; React Doctor 100/100 |
| Cross-client HTTP integration | Passed: 6 idempotent seeds and 16 SDK-created transactions |
| Manual resolution of both pending seeds | Passed; status zero and provider references returned |
| Development Compose build, health, dashboard, and proxied API | Passed in an isolated project on port 18086 |
| Packaged Docker image smoke, ARM64 | Passed after the callback-alias update; simulator runtime is unchanged by the SDK object refactor |
| Packaged Docker image build, AMD64 | Attempted; QEMU crashed running `rustc -vV` with SIGSEGV before compilation. Native AMD64 CI remains required. |
| Browser card flow | Passed: corporate request, hosted form, approval redirect, succeeded dashboard row |
| All three repositories' diff whitespace checks | Passed |
| Sandbox `make check` | Fails only at the dependency audit described below |
| Real provider rejection responses | Both payment types and a nonexistent-order check returned HTTP 200 JSON with code `"1"`; captured response shapes fit the SDK contracts |
| Real provider card initiation | One USD 1 request for the confirmed merchant returned HTTP 200, code `"0"`, a non-empty order number, and an HTTPS checkout URL. The refactored TypeScript client parsed it successfully. Checkout was not opened or completed. |
| Real provider existing-order check | PHP and TypeScript each sent one GET and parsed identical HTTP 200 JSON: lookup code `"0"`, transaction status `"4"`, and an operator-declined message. Both retain `Status` values and report payment success as false. |

The sandbox audit reports one low-severity finding in `deepmerge@4.3.1`, through
`shadcn > @shadcn/registry > deepmerge`:
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
The registry had no patched release when checked. Other reported advisories were repaired with compatible updates.
No new audit exception was added. The full sandbox gate is therefore not green, even though its functional checks
pass. The package is part of registry CLI tooling; the packaged release contains compiled assets and the Rust binary.

Detailed local logs are available at:

- `/tmp/flexpay-php-observed-order-quality.log`, `/tmp/flexpay-php-observed-order-php84-quality.log`,
  `/tmp/flexpay-ts-validation/observed-order-quality.log`, and `observed-order-node24.log` record the latest
  anonymized existing-order regression and supported-runtime checks;
- `/tmp/flexpay-php-design-quality.log`, `/tmp/flexpay-php-design-php84-quality.log`, and
  `/tmp/flexpay-php-design-package.log` record the final PHP object-design checks and clean production package smoke;
- `/tmp/flexpay-ts-validation/stream-cleanup-quality.log`, `stream-cleanup-coverage.log`, and `stream-cleanup-node24.log`
  record the final TypeScript checks; `redesign-install.log` and `redesign-audit.log` record the install and audit;
- `/tmp/flexpay-object-design-final-integration.log` records the final HTTP integration for both refactored clients;
- `/tmp/flexpay-sandbox-sdk-refactor-check.log` and `/tmp/flexpay-sandbox-sdk-refactor-frontend.log` record
  current simulator checks, including the unchanged audit failure;
- `/tmp/flexpay-php-quality.log`, `/tmp/flexpay-php84-tests.log`, and `/tmp/flexpay-php84-typecheck.log`;
- `/tmp/flexpay-ts-validation/quality.log`, `coverage.log`, `audit.log`, and `node24.log`;
- `/tmp/flexpay-cross-client-check.log`;
- `/tmp/flexpay-sandbox-check.log`, `/tmp/flexpay-sandbox-audit.log`, `/tmp/flexpay-sandbox-docker-build.log`, and
  `/tmp/flexpay-sandbox-packaged-smoke.log`;
- `/tmp/flexpay-sandbox-amd64-build.log` records the emulator failure;
- `/tmp/flexpay-dev-smoke.log`.

## Real endpoint rejection smoke

On 2026-10-29, the supplied bearer token was sent only to the two specified HTTPS endpoints. Redirects were disabled,
TLS verification remained enabled, and each probe was sent once. The token was supplied through standard input and
was not written into source files or response artifacts.

The payment probes deliberately omitted merchant, amount, and phone. No collection could be requested from those
payloads. The status probe used a newly generated nonexistent order number.

| Probe | Request | HTTP response | JSON response fields |
| --- | --- | --- | --- |
| Mobile rejection | `POST paymentService`, body `{"type":"1"}` | `200 application/json` | `code: "1"`, `message: "The callbackUrl parameter is required"`, `orderNumber: ""` |
| Card rejection | `POST paymentService`, body `{"type":"2"}` | `200 application/json` | `code: "1"`, `message: "The currency parameter is required"`, `orderNumber: ""`; no `url` |
| Unknown order | `GET check/SMOKE-NONEXISTENT-{random}` | `200 application/json` | `code: "1"`, a transaction-not-found `message`, `transaction: null` |

The two collection responses agree with the documented string code and message fields for rejection. The document
does not show a rejection example; the observed empty order number and absent card URL are accepted by both clients.
The new check response is not specified in the supplied document. Its observed not-found response matches the retained
check schema. These checks verify endpoint reachability and rejection parsing, not credential validity or successful
payment processing. They establish no pending-status mapping.

The mobile error uses the name `callbackUrl`, while the document's request field is `callback_url`. Neither field was
sent in the initial probe. The controlled comparison below provides evidence for both spellings.

Sanitized evidence is saved in `/tmp/flexpay-live-schema-review/responses.json`. Both SDKs include deterministic
regression fixtures for these observed failure responses; automated tests replay them without credentials or network
access.

The initial regression run is recorded in `/tmp/flexpay-php-observed-quality.log`,
`/tmp/flexpay-php-observed-php84-tests.log`, and `/tmp/flexpay-ts-validation/provider-rejections-node24.log`.
Current validation results for the refactored API appear in the table above.

## Callback spelling comparison

On 2026-10-29, additional controlled requests compared `callback_url` and `callbackUrl` against the real payment
endpoint. The first requests omitted merchant, amount, and phone; their errors named other missing fields and were
inconclusive. Subsequent requests used only non-chargeable sentinels:

```json
{
  "merchant": "SCHEMA_PROBE_INVALID_MERCHANT",
  "amount": "NOT_A_NUMBER",
  "phone": "NOT_A_PHONE_NUMBER",
  "reference": "CALLBACK-FIELD-VALIDATION-ONLY",
  "currency": "USD"
}
```

Each request also specified type `1` or `2`. Card requests included the documented return URL fields. All URL values
used `https://example.invalid/flexpay-schema-smoke`. A request contained at most one callback spelling. Every probe
was sent once. TLS verification stayed enabled and redirects were disabled. No positive amount, valid merchant, or
usable phone was supplied. No response accepted a payment or returned a non-empty order number or checkout URL.

| Controlled comparison | Observed response |
| --- | --- |
| Mobile, callback absent | HTTP 200, code `"1"`, `The callbackUrl parameter is required` |
| Mobile, either callback spelling with a URL string | HTTP 200, code `"1"`, `The amount value must be a positive number greater than 0` |
| Card, either callback spelling with a URL string | Same invalid-amount rejection |
| Card, callback absent | Invalid-amount rejection; this alone cannot establish callback recognition |
| Card, unrelated object-valued field and no callback | HTTP 200, code `"1"`, callback-required rejection |
| Card, object value under either callback spelling | HTTP 403, `text/html;charset=utf-8`, Tomcat Forbidden page |
| Card, repeat URL-string controls after the 403 responses | HTTP 200, code `"1"`, invalid-amount rejection for both spellings |

The mobile comparison and card object-type controls support both names being recognized at input validation.
The card string-only comparison is insufficient on its own because invalid-amount validation can hide a missing
callback. These controls support field recognition during input validation; they do not verify payment processing
or callback delivery. The card HTTP 403 responses alone cannot distinguish application binding from gateway filtering.

Both SDKs already send `callback_url`, so their serializers remain unchanged. The simulator now accepts `callbackUrl`
as an alias for both methods and rejects requests containing both spellings. Its duplicate-name rule avoids ambiguous
local requests; duplicate-field behavior has not been tested against the provider.

Added SDK regressions replay the observed invalid-amount JSON and HTML 403 responses. PHP retains HTTP status 403
as `ClientException` with `type: invalid_response`; TypeScript does the same. Neither includes the HTML body in the
diagnostic message. The callback-alias implementation also passed the six-seed, 16-transaction integration run and
the updated ARM64 packaged image smoke check. Current SDK counts and checks after the object refactor appear above;
the pre-existing sandbox audit failure remains.

Sanitized live evidence is in `/tmp/flexpay-live-schema-review/callback-fields.json`, `callback-fields-isolated.json`,
`callback-fields-binding.json`, and `callback-fields-card-confirmation.json`. Updated verification logs are
`/tmp/flexpay-php-callback-fields-quality.log`, `/tmp/flexpay-php-callback-fields-php84-quality.log`,
`/tmp/flexpay-ts-validation/callback-fields-node24.log`, `/tmp/flexpay-sandbox-callback-alias-check.log`,
`/tmp/flexpay-callback-alias-cross-client.log`, `/tmp/flexpay-sandbox-callback-alias-arm64-build.log`, and
`/tmp/flexpay-sandbox-callback-alias-arm64-smoke.log`.

## Real card checkout-link smoke

On 2026-10-29, the user authorized one real card-initiation request and confirmed the merchant code.
The refactored TypeScript client sent USD 1 with a unique smoke reference, the documented `callback_url`
field, and placeholder callback/return URLs under `https://example.invalid/`. The token was supplied
through standard input with terminal echo disabled and was not stored in source or response artifacts.
TLS verification remained enabled, redirects were disabled, and the POST was sent once.

FlexPay returned HTTP 200 JSON containing `code: "0"`, `message: "Transaction envoyé avec succès"`,
a non-empty `orderNumber`, and an HTTPS checkout `url` on `gwvisa.flexpay.cd`. It also returned
`orderId: null` and `sessionId: null`. The SDK accepted the extra fields, produced a `Status` with
value zero, and reported `accepted: true` with the returned order number and checkout URL.

The sanitized response is stored locally at `/tmp/flexpay-live-schema-review/card-link-result.json`.
The checkout URL and actual order number are intentionally absent from this repository document.
That initiation smoke included no checkout navigation, card entry, payment completion, callback delivery, or status lookup.
This verifies card initiation and response parsing; it does not verify collection of funds.

## Real existing-order check

On 2026-10-29, the user authorized a status lookup for the generated card order with both clients.
Each refactored SDK made one GET to the supplied `apicheck.flexpaie.com` endpoint, with TLS verification
enabled and redirects disabled. The supplied token stayed in process memory and was not stored in
source or response artifacts. The PHP request used Symfony's native HTTP client; TypeScript used
native Fetch. Recording wrappers retained the raw responses before the SDK parsers consumed them.

Both responses were identical HTTP 200 JSON. FlexPay's message stated that the transaction was
declined by the operator. The results matched each other and the raw response:

| Field | Provider response | Both SDKs |
| --- | --- | --- |
| Lookup code | `"0"` | `Status` with value `0` |
| Transaction status | `"4"` | `Status` with value `4` |
| Amount | `"1.0"` | Numeric `1` |
| Customer amount | `"1.02"` | Numeric `1.02` |
| Currency and channel | `"USD"`, `"visa"` | Preserved |
| Nested `orderNumber` | Absent | `null` |
| Payment success | Operator-declined message | `false` |

The provider placed its order number in `transaction.reference`; both clients preserved that value
without substituting the original merchant reference. The timestamp string was also preserved without
guessing its timezone. No parser changes were needed. This observation verifies an existing-order
lookup with a declined card outcome; it does not establish a universal status-code mapping or verify
paid or pending outcomes.

Sanitized local evidence is `/tmp/flexpay-live-schema-review/order-status-both.json`. Both SDK suites
include anonymized replay fixtures with a synthetic order number and timestamp. No real order number,
checkout link, merchant credential, or token was copied into those fixtures.

## Local review dashboard

The isolated review stack is available at `http://127.0.0.1:18086/`. It contains the six seeds and the
`browser-corporate-card` transaction completed during browser verification. Its callback receiver was not running;
callback delivery and replay were verified separately by the cross-client check's local receiver.

Stop and remove only this review stack and its test volume when finished:

```sh
FLEXPAY_PORT=18086 docker compose -p flexpay_corporate_review_dev -f compose.dev.yaml down --volumes
```

## Release conditions

Live rejection parsing, card checkout-link generation, and status parsing for a declined card order are verified.
Successful collection, callback delivery, and paid or pending status responses remain unverified. Before publishing,
verify a mobile collection, completion of a card collection, callbacks, and a status lookup reporting actual payment
success with that account. Record the provider's pending status and paid-transaction response structure; the supplied
document does not define them. Do not infer paid state from request acceptance or browser redirects.

The three working-tree diffs were approved for commit. Applying the TypeScript Changeset, tagging, publishing,
or updating the platform's dependency requires separate approval.
