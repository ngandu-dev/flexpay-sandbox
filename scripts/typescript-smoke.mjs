// Run: node scripts/typescript-smoke.mjs /absolute/path/to/flexpay
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const sdkPath = process.argv[2];
if (!sdkPath)
	throw new Error(
		"Pass the TypeScript SDK checkout path (build its dist first).",
	);
const { Client } = await import(
	pathToFileURL(resolve(sdkPath, "dist/index.mjs")).href
);
const base = process.env.FLEXPAY_SIMULATOR_URL || "http://localhost:8080";
const client = new Client(
	{ merchant: "TESTMERCHANT", token: "test-token" },
	{
		payment: `${base}/api/rest/v1`,
		check: `${base}/api/rest/v1`,
		payout: `${base}/api/rest/v1`,
	},
);
const request = {
	amount: 25,
	reference: `ts-${Date.now()}`,
	currency: "USD",
	callbackUrl: "http://127.0.0.1:9000/callback",
	phone: "243810000001",
};
const mobile = await client.mobile(request);
assert.ok(mobile.accepted);
// Wait for the simulator to complete this successful test transaction.
for (let attempt = 0; attempt < 100; attempt++) {
	const response = await fetch(
		`${base}/api/rest/v1/check/${mobile.orderNumber}`,
		{ headers: { Authorization: "Bearer test-token" } },
	).then((r) => r.json());
	if (response.transaction.status !== "2") break;
	await new Promise((resolve) => setTimeout(resolve, 100));
}
const checked = await client.check(mobile.orderNumber);
assert.ok(checked.successful);
assert.equal(checked.transaction.status.value, 0);
assert.equal(checked.transaction.amountCustomer, 25.63);
const payout = await client.payout({
	...request,
	reference: `payout-${Date.now()}`,
});
assert.ok(payout.accepted);
const card = await client.card({
	amount: 5,
	reference: `card-${Date.now()}`,
	currency: "USD",
	callbackUrl: request.callbackUrl,
	approveUrl: base,
	declineUrl: base,
	cancelUrl: base,
});
assert.ok(card.accepted);
assert.ok(card.url.startsWith(`${base}/checkout/`));
console.log("TypeScript client: mobile, check, payout, card passed.");
