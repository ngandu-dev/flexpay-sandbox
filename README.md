# FlexPay Sandbox

A local FlexPay testing environment with a transaction dashboard, configurable payment outcomes, and a hosted card checkout. Test mobile payments, card payments, payouts, and callbacks without contacting the real FlexPay service.

## Run with Docker

```yaml
name: your_app

services:
  flexpay_sandbox:
    image: ghcr.io/bernard-ng/flexpay-sandbox:v0.2.1
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      FLEXPAY_PUBLIC_URL: http://localhost:8080
      FLEXPAY_MERCHANT: TESTMERCHANT
      FLEXPAY_TOKEN: test-token
    volumes:
      - sandbox-data:/app/data
    extra_hosts:
      - host.docker.internal:host-gateway

volumes:
  sandbox-data:
```

Start it and open **http://localhost:8080**:

```sh
docker compose up -d
```

Use `:v0.2.1` to pin this release, or `:latest` to follow stable releases. Each [GitHub release](https://github.com/bernard-ng/flexpay-sandbox/releases) also includes a ready-to-use `compose.prod.yaml` pinned to that release's image digest.

Change the published port and `FLEXPAY_PUBLIC_URL` together when using a different address. Set `FLEXPAY_MERCHANT` and `FLEXPAY_TOKEN` to the test credentials your integration will use. This is a development simulator; keep it local and use test data only.

## Point your integration at the sandbox

Version 0.2.1 supports the corporate API used by the PHP 4 and TypeScript 4 clients.
Use the [source development setup](CONTRIBUTING.md#development) when changing the simulator.

Pass the sandbox deployment URL to `BaseUrl.sandbox()` in TypeScript or `BaseUrl::sandbox()` in PHP.
Both methods use that URL for payments, status checks, and payouts:

| API | Base URL |
| --- | --- |
| Mobile and card payments | `http://localhost:8080/api/rest/v1` |
| Status checks | `http://localhost:8080/api/rest/v1` |
| Payouts (existing contract) | `http://localhost:8080/api/rest/v1` |

```ts
import { BaseUrl, Client, Credential } from '@ngandu-dev/flexpay';

const client = new Client(
  new Credential({ merchant: 'TESTMERCHANT', token: 'test-token' }),
  BaseUrl.sandbox('http://localhost:8080/api/rest/v1'),
);
```

```php
use Ngandu\Flexpay\BaseUrl;
use Ngandu\Flexpay\Client;
use Ngandu\Flexpay\Credential;

$client = new Client(
    credential: new Credential(merchant: 'TESTMERCHANT', token: 'test-token'),
    baseUrl: BaseUrl::sandbox('http://localhost:8080/api/rest/v1'),
);
```

Both clients require an explicit `BaseUrl.production()` or `BaseUrl.sandbox(url)` selection. There is
no implicit network destination. Initiation results report acceptance; checks and callbacks report
payment outcomes. Codes and transaction statuses are always `Status` values, with the provider's
integer available through `value`.

If your application runs in the same Docker network, use `http://flexpay_sandbox:8080` as the host in those URLs. The sandbox never forwards transactions to the live gateway.

## Corporate API

The PHP 4 and TypeScript 4 clients send mobile (`type: "1"`) and card (`type: "2"`)
requests to `POST /api/rest/v1/paymentService`. Authenticate with the `Authorization: Bearer ...`
header. The endpoint requires `callback_url` or its observed alias `callbackUrl`; card requests also
require `approve_url`, `cancel_url`, and `decline_url`. The SDKs and examples keep the documented
`callback_url` spelling. Provider validation probes recognized both callback spellings for mobile
and card requests; successful payment and callback delivery with the provider remain unverified.
The simulator rejects requests containing both callback names, body credentials, `description`, or
`home_url`. Amounts accept JSON numbers or decimal strings. Card responses include a local hosted
`/checkout/{id}` URL.

The legacy `/v1.1/pay` route remains available for testing old card integrations. Payouts retain
`/api/rest/v1/merchantPayOutService` and their existing request format. Existing SQLite data remains readable.

The current corporate payment host is `corporateapi.flexpay.cd`; the status-check host is
`apicheck.flexpaie.com`. No corporate sandbox URL was provided. The client examples above explicitly
use this local simulator for every operation.

The SDK repositories contain versioned migration guides: `UPGRADE_4.0.0.md` for PHP and
`UPGRADE_3.0.0.md` for TypeScript. Their READMEs document the current API.

## Seed demonstration transactions

Run the native executable with `--seed` before starting it:

```sh
cargo run --manifest-path backend/Cargo.toml -- --database /tmp/flexpay-review.db --seed
cargo run --manifest-path backend/Cargo.toml -- --database /tmp/flexpay-review.db
```

Or seed the Compose service's existing volume without starting the HTTP server:

```sh
docker compose -f compose.prod.yaml run --rm sandbox --seed
```

Seeding adds six deterministic records: mobile and card payments with success, failure, and pending
statuses. Order numbers are `SIM-SEED-mobile-success`, `SIM-SEED-mobile-failure`,
`SIM-SEED-mobile-pending`, `SIM-SEED-card-success`, `SIM-SEED-card-failure`, and
`SIM-SEED-card-pending`. Repeated runs preserve existing transactions and settings. Seeding sends no
callbacks and records no fictional delivery attempts. Use pending records to test manual resolution,
or create new transactions through the clients to test actual callback delivery.

## Testing use cases

- **Successful and failed payments:** use the test values below or configure your own phone/card rules in **Test configuration**.
- **Pending payments:** create a pending transaction, inspect it in **Transactions**, and manually resolve it as successful, failed, or cancelled.
- **Hosted card checkout:** create a card payment through your integration, open the returned checkout URL, and verify the success, decline, and cancellation redirects.
- **Mobile payouts:** test payout outcomes using the same phone rules as mobile collections.
- **Callbacks:** inspect the payload and delivery result in transaction details, then use **Replay callback** to retry delivery after fixing your receiver.
- **Refund states:** move successful transactions through refund pending and refunded to test status handling.
- **Fresh test runs:** reset transaction history from the dashboard while retaining your rules and settings.

The **Gateway simulator** page can create mobile payments, card checkouts, and payouts directly. **Test configuration** controls matching rules, default outcomes, completion delays, and simulated customer fees.

| Method | Test value | Result |
| --- | --- | --- |
| Phone | `243810000001` | Success |
| Phone | `243810000002` | Failure |
| Phone | `243810000003` | Pending |
| Card | `4242424242424242` | Success |
| Card | `4000000000000002` | Failure |
| Card | `4000000000003220` | Pending |

For a callback receiver on your host machine, use `http://host.docker.internal:9000/callback`. For a receiver in the same Docker network, use its service name. `localhost` inside the sandbox container refers to the sandbox itself.

Request acceptance does not mean payment success. Poll the status endpoint or wait for the callback.
The simulator uses transaction statuses `0` (succeeded), `1` (failed), `2` (pending), `3` (refund pending),
`4` (refunded), and `5` (cancelled). These are simulator conventions. A real corporate lookup returned status `4`
with an operator-declined message. Paid and pending corporate outcomes remain unverified; confirm the provider's
status meanings before relying on them in production.

## Update or stop

```sh
docker compose pull
docker compose up -d
docker compose down
```

When using a digest-pinned release attachment, replace it with the next release's attachment before updating. Keep the same project and volume names to retain your data. Removing the volume deletes its transaction history and configuration.

## Community

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and the [Code of Conduct](CODE_OF_CONDUCT.md) for community standards. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) — Copyright (c) 2026-present Bernard Ngandu and contributors.
