<?php

declare(strict_types=1);

use Ngandu\Flexpay\BaseUrl;
use Ngandu\Flexpay\Client;
use Ngandu\Flexpay\Credential;
use Ngandu\Flexpay\Data\Currency;
use Ngandu\Flexpay\Request\CardRequest;
use Ngandu\Flexpay\Request\MobileRequest;
use Ngandu\Flexpay\Request\PayoutRequest;
use Ngandu\Flexpay\Response\CallbackResponse;

[$script, $phpRoot, $base, $callbackBase] = $argv;
require $phpRoot . '/vendor/autoload.php';

$client = new Client(
    credential: new Credential(merchant: 'TESTMERCHANT', token: 'test-token'),
    baseUrl: new BaseUrl(
        payment: $base . '/api/rest/v1',
        check: $base . '/api/rest/v1',
        payout: $base . '/api/rest/v1',
    ),
);

foreach ([
    ['success', '243810000001', 0],
    ['failure', '243810000002', 1],
    ['pending', '243810000003', 2],
] as [$label, $phone, $expected]) {
    $reference = 'php-mobile-' . $label;
    $response = $client->mobile(new MobileRequest(
        amount: 10,
        reference: $reference,
        currency: Currency::USD,
        callbackUrl: $callbackBase . '/callback/' . $reference,
        phone: $phone,
    ));
    ensure($response->isAccepted(), 'Mobile initiation accepted');
    verifyState($client, $response->orderNumber, $expected);

    if ($expected === 2) {
        jsonRequest($base . '/api/simulator/transactions/' . $response->orderNumber . '/resolve', ['status' => 0]);
        verifyState($client, $response->orderNumber, 0);
    }

    verifyCallback($base, $callbackBase, $reference, $response->orderNumber, $expected !== 1);
}

foreach ([
    ['success', '4242424242424242', 0, 'approved'],
    ['failure', '4000000000000002', 1, 'declined'],
    ['pending', '4000000000003220', 2, null],
    ['cancel', '', 5, 'cancelled'],
] as [$label, $number, $expected, $destination]) {
    $reference = 'php-card-' . $label;
    $response = $client->card(new CardRequest(
        amount: 12.5,
        reference: $reference,
        currency: Currency::CDF,
        callbackUrl: $callbackBase . '/callback/' . $reference,
        approveUrl: $callbackBase . '/approved',
        cancelUrl: $callbackBase . '/cancelled',
        declineUrl: $callbackBase . '/declined',
    ));
    ensure($response->isAccepted(), 'Card initiation accepted');
    ensure(str_starts_with($response->url, $base . '/'), 'Checkout must stay local');
    ensure(file_get_contents($response->url) !== false, 'Hosted checkout page available');
    $result = jsonRequest($base . '/api/simulator/checkout/' . $response->orderNumber, [
        'cardNumber' => $number,
        'cancel' => $label === 'cancel',
    ]);
    ensure($result['status'] === $expected, 'Checkout status');
    ensure($result['redirectUrl'] === ($destination === null ? null : $callbackBase . '/' . $destination), 'Checkout redirect');
    verifyState($client, $response->orderNumber, $expected);

    if ($expected === 2) {
        jsonRequest($base . '/api/simulator/transactions/' . $response->orderNumber . '/resolve', ['status' => 1]);
        verifyState($client, $response->orderNumber, 1);
    }

    verifyCallback($base, $callbackBase, $reference, $response->orderNumber, $expected === 0);
}

$reference = 'php-payout-success';
$payout = $client->payout(new PayoutRequest(
    amount: 5,
    reference: $reference,
    currency: Currency::USD,
    callbackUrl: $callbackBase . '/callback/' . $reference,
    phone: '243810000001',
));
ensure($payout->isAccepted(), 'Payout initiation accepted');
verifyState($client, $payout->orderNumber, 0);
verifyCallback($base, $callbackBase, $reference, $payout->orderNumber, true);
echo "PHP: mobile success/failure/pending, card success/failure/pending/cancel, payout, and callback replay passed.\n";

function ensure(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function jsonRequest(string $url, ?array $body = null): array
{
    $options = [
        'method' => $body === null ? 'GET' : 'POST',
        'header' => "Content-Type: application/json\r\nAuthorization: Bearer test-token\r\n",
        'timeout' => 5,
    ];

    if ($body !== null) {
        $options['content'] = json_encode($body, JSON_THROW_ON_ERROR);
    }

    $response = file_get_contents($url, false, stream_context_create(['http' => $options]));
    ensure($response !== false, 'HTTP request failed: ' . $url);

    return json_decode($response, true, flags: JSON_THROW_ON_ERROR);
}

function eventually(callable $predicate, string $message): void
{
    for ($attempt = 0; $attempt < 100; $attempt++) {
        if ($predicate()) {
            return;
        }

        usleep(50000);
    }

    throw new RuntimeException($message);
}

function verifyState(Client $client, string $id, int $expected): void
{
    eventually(function () use ($client, $id, $expected): bool {
        $response = $client->check($id);
        $code = $response->transaction?->status->value;

        if ($code !== $expected) {
            return false;
        }

        ensure($response->isSuccessful() === ($expected === 0), 'Lookup success must reflect payment outcome');

        return true;
    }, 'Transaction did not reach simulator status ' . $expected);
}

function verifyCallback(string $base, string $callbackBase, string $reference, string $id, bool $successful): void
{
    $recordedUrl = $callbackBase . '/recorded/' . $reference;
    eventually(fn (): bool => count(jsonRequest($recordedUrl)) > 0, 'Callback missing: ' . $reference);
    $payload = jsonRequest($recordedUrl)[0];
    $callback = CallbackResponse::fromPayload($payload);
    ensure($callback->reference === $reference, 'Callback reference');
    ensure($callback->orderNumber === $id, 'Callback order number');
    ensure($callback->isSuccessful() === $successful, 'Callback payment outcome');

    if ($successful) {
        ensure(is_string($callback->providerReference) && $callback->providerReference !== '', 'Provider reference must be mapped');
    }

    jsonRequest($base . '/api/simulator/transactions/' . $id . '/callback', []);
    eventually(fn (): bool => count(jsonRequest($recordedUrl)) === 2, 'Callback replay missing: ' . $reference);
    [$first, $second] = jsonRequest($recordedUrl);
    ensure($first === $second, 'Callback replay payload changed');
}
