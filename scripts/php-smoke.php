<?php

declare(strict_types=1);

// Run: php scripts/php-smoke.php /absolute/path/to/flexpay-php
require ($argv[1] ?? throw new RuntimeException('Pass the PHP SDK checkout path')) . '/vendor/autoload.php';

use Ngandu\Flexpay\BaseUrl;
use Ngandu\Flexpay\Client;
use Ngandu\Flexpay\Credential;
use Ngandu\Flexpay\Data\Currency;
use Ngandu\Flexpay\Request\CardRequest;
use Ngandu\Flexpay\Request\MobileRequest;
use Ngandu\Flexpay\Request\PayoutRequest;

$base = getenv('FLEXPAY_SIMULATOR_URL') ?: 'http://localhost:8080';
$client = new Client(
    credential: new Credential(merchant: 'TESTMERCHANT', token: 'test-token'),
    baseUrl: new BaseUrl(
        payment: "$base/api/rest/v1",
        check: "$base/api/rest/v1",
        payout: "$base/api/rest/v1",
    ),
);

$mobile = $client->mobile(new MobileRequest(
    amount: 25,
    reference: 'php-' . time(),
    currency: Currency::USD,
    callbackUrl: 'http://127.0.0.1:9000/callback',
    phone: '243810000001',
));

if (!$mobile->isAccepted() || !$mobile->orderNumber) {
    throw new RuntimeException('Mobile request was not accepted');
}

for ($attempt = 0; $attempt < 100; ++$attempt) {
    $checked = $client->check($mobile->orderNumber);

    if ($checked->transaction?->status->value !== 2) {
        break;
    }

    usleep(100000);
}

if (!$checked->isSuccessful() || $checked->transaction?->amountCustomer !== 25.63) {
    throw new RuntimeException('Status check failed');
}

$payout = $client->payout(new PayoutRequest(
    amount: 5,
    reference: 'php-payout-' . time(),
    currency: Currency::USD,
    callbackUrl: 'http://127.0.0.1:9000/callback',
    phone: '243810000001',
));

if (!$payout->isAccepted()) {
    throw new RuntimeException('Payout request was not accepted');
}

$card = $client->card(new CardRequest(
    amount: 5,
    reference: 'php-card-' . time(),
    currency: Currency::USD,
    callbackUrl: 'http://127.0.0.1:9000/callback',
    approveUrl: $base,
    cancelUrl: $base,
    declineUrl: $base,
));

if (!$card->isAccepted() || !str_starts_with($card->url ?? '', "$base/checkout/")) {
    throw new RuntimeException('Card request was not accepted');
}

echo "PHP client: mobile, check, payout, card passed.\n";
