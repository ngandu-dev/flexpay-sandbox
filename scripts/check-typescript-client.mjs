import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function checkTypeScriptClient({
	base,
	callbackBase,
	typescriptRoot,
	json,
	eventually,
}) {
	const { Client, parseCallback } = await import(
		pathToFileURL(join(typescriptRoot, "dist/index.mjs"))
	);
	const client = new Client(
		{ merchant: "TESTMERCHANT", token: "test-token" },
		{
			payment: `${base}/api/rest/v1`,
			check: `${base}/api/rest/v1`,
			payout: `${base}/api/rest/v1`,
		},
	);

	for (const [label, phone, expected] of [
		["success", "243810000001", 0],
		["failure", "243810000002", 1],
		["pending", "243810000003", 2],
	]) {
		const reference = `ts-mobile-${label}`;
		const response = await client.mobile({
			amount: 10,
			currency: "USD",
			reference,
			phone,
			callbackUrl: `${callbackBase}/callback/${reference}`,
		});
		assert.ok(response.accepted, "Mobile initiation accepted");
		await verifyState(response.orderNumber, expected);

		if (expected === 2) {
			await json(
				`${base}/api/simulator/transactions/${response.orderNumber}/resolve`,
				"POST",
				{ status: 0 },
			);
			await verifyState(response.orderNumber, 0);
		}

		await verifyCallback(reference, response.orderNumber, expected !== 1);
	}

	for (const [label, cardNumber, expected, destination] of [
		["success", "4242424242424242", 0, "approved"],
		["failure", "4000000000000002", 1, "declined"],
		["pending", "4000000000003220", 2, null],
		["cancel", "", 5, "cancelled"],
	]) {
		const reference = `ts-card-${label}`;
		const response = await client.card({
			amount: 12.5,
			currency: "CDF",
			reference,
			callbackUrl: `${callbackBase}/callback/${reference}`,
			approveUrl: `${callbackBase}/approved`,
			cancelUrl: `${callbackBase}/cancelled`,
			declineUrl: `${callbackBase}/declined`,
		});
		assert.ok(response.accepted, "Card initiation accepted");
		assert.equal(new URL(response.url).origin, base);
		const page = await fetch(response.url);
		assert.ok(page.ok, "Hosted card page must be available");
		const result = await json(
			`${base}/api/simulator/checkout/${response.orderNumber}`,
			"POST",
			{ cardNumber, cancel: label === "cancel" },
		);
		assert.equal(result.status, expected);
		assert.equal(
			result.redirectUrl,
			destination === null ? null : `${callbackBase}/${destination}`,
		);
		await verifyState(response.orderNumber, expected);

		if (expected === 2) {
			await json(
				`${base}/api/simulator/transactions/${response.orderNumber}/resolve`,
				"POST",
				{ status: 1 },
			);
			await verifyState(response.orderNumber, 1);
		}

		await verifyCallback(reference, response.orderNumber, expected === 0);
	}

	const reference = "ts-payout-success";
	const payout = await client.payout({
		amount: 5,
		currency: "USD",
		reference,
		phone: "243810000001",
		callbackUrl: `${callbackBase}/callback/${reference}`,
	});
	assert.ok(payout.accepted);
	await verifyState(payout.orderNumber, 0);
	await verifyCallback(reference, payout.orderNumber, true);
	console.log(
		"TypeScript: mobile success/failure/pending, card success/failure/pending/cancel, payout, and callback replay passed.",
	);

	async function verifyState(id, expected) {
		await eventually(async () => {
			const state = await client.check(id);

			if (state.transaction?.status.value !== expected) {
				return false;
			}

			assert.equal(state.successful, expected === 0);
			return true;
		}, `Transaction ${id} did not reach simulator status ${expected}`);
	}

	async function verifyCallback(reference, id, successful) {
		await eventually(
			async () =>
				(await json(`${callbackBase}/recorded/${reference}`)).length > 0,
			`No callback for ${reference}`,
		);
		const [payload] = await json(`${callbackBase}/recorded/${reference}`);
		const callback = parseCallback(payload);
		assert.equal(callback.reference, reference);
		assert.equal(callback.orderNumber, id);
		assert.equal(callback.successful, successful);

		if (successful) {
			assert.ok(callback.providerReference);
		}

		await json(`${base}/api/simulator/transactions/${id}/callback`, "POST", {});
		await eventually(
			async () =>
				(await json(`${callbackBase}/recorded/${reference}`)).length === 2,
			`Replay missing for ${reference}`,
		);
		const [first, second] = await json(`${callbackBase}/recorded/${reference}`);
		assert.deepEqual(first, second);
	}
}
