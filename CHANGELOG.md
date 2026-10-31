# Changelog

## 0.2.3 - 2026-10-31

### Fixed

- Publish release images to the public `ghcr.io/ngandu-dev/flexpay-sandbox` package after the repository transfer.
- Use the public package path in the Docker Compose file and release examples.

## 0.2.2 - 2026-10-31

### Fixed

- The release image target was incorrect after the repository transfer; fixed in 0.2.3.

## 0.2.1 - 2026-10-31

### Changed

- Use the TypeScript and PHP `BaseUrl.sandbox()` presets in the sandbox integration examples.
- Refer to version 4 for both SDKs and document one shared sandbox URL for all three operations.

## 0.2.0 - 2026-10-29

### Changed

- Accept mobile and card payments at the corporate `/api/rest/v1/paymentService` endpoint. Require bearer headers and type `1` or `2`; accept `callback_url` and the observed `callbackUrl` alias, while rejecting duplicate callback names, obsolete card fields, and body credentials.
- Use the corporate request format in the gateway dashboard and the PHP 4 and TypeScript 3 client examples. Keep the legacy card route and payout protocol available.
- Preserve existing SQLite transaction records while removing the obsolete card description, home URL, and reference-length requirements.
- Migrate SDK examples and cross-client checks to required `BaseUrl` objects, explicit payment methods, immutable `Status` values, separate acceptance and payment outcomes, and credential-independent callback parsing.
- Keep README examples on the current SDK APIs and point migration guidance to the clients' versioned upgrade guides.

### Fixed

- Use the official shadcn 4.23.0 eject workflow to retain its Tailwind utilities as local CSS and remove the CLI dependency, including vulnerable `deepmerge` and `braces` chains. Remove the obsolete dependency overrides and audit exception; local and CI audits now check every dependency.

### Added

- An idempotent `--seed` command for six deterministic mobile/card success, failure, and pending transactions. It preserves existing data and sends no callbacks.
- Corporate request, authentication, hosted checkout, callback, and seed integration coverage.
- A repeatable cross-client check that runs the PHP and TypeScript SDKs against a temporary simulator and callback receiver. See [the release review](docs/corporate-release-review.md) for commands and results.
- Record the real corporate endpoint's mobile/card rejection and nonexistent-order response shapes in the release review. Successful payment and callback verification remains pending.
- Record one authorized real USD 1 card initiation: the TypeScript client parsed an accepted response with an order number and checkout URL. No checkout or payment completion was attempted.
- Verify both clients against a real existing-order lookup reporting an operator-declined card transaction. Both preserve lookup code zero and transaction status four as `Status` values and correctly return false for payment success.

### Migration

- Replace client environment flags and individual URL options with one `BaseUrl` containing `payment`, `check`, and `payout`. All three point to the local `/api/rest/v1` prefix.
- Send corporate card and mobile payloads to `paymentService`. Keep `callback_url` in SDK payloads and examples; the simulator also accepts the observed `callbackUrl` alias for both payment types. Send only one callback field.
- No corporate upstream sandbox was provided. An existing declined-card lookup is verified; paid and pending status responses remain unverified. Simulator status values are not an assertion about undocumented upstream values.
