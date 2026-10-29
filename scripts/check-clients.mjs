import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkTypeScriptClient } from "./check-typescript-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [phpRoot, typescriptRoot] = process.argv.slice(2);
const temporary = await mkdtemp(join(tmpdir(), "flexpay-clients-"));
const binary = join(root, "backend/target/debug/flexpay_sandbox");
const recorded = new Map();
const receiver = createServer(async (request, response) => {
	const pathname = new URL(request.url, "http://localhost").pathname;
	const reference = pathname.split("/").at(-1);

	if (request.method === "POST" && pathname.startsWith("/callback/")) {
		let body = "";

		for await (const chunk of request) {
			body += chunk;
		}

		const deliveries = recorded.get(reference) ?? [];
		deliveries.push(JSON.parse(body));
		recorded.set(reference, deliveries);
		response.writeHead(204).end();
		return;
	}

	response.writeHead(200, { "Content-Type": "application/json" });
	response.end(JSON.stringify(recorded.get(reference) ?? []));
});

let simulator;
let simulatorLog = "";

try {
	receiver.listen(0, "127.0.0.1");
	await once(receiver, "listening");
	const callbackBase = `http://127.0.0.1:${receiver.address().port}`;
	const reservation = createServer();
	reservation.listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const port = reservation.address().port;
	await new Promise((resolveClose) => reservation.close(resolveClose));
	const base = `http://127.0.0.1:${port}`;
	const args = [
		"--database",
		join(temporary, "sandbox.db"),
		"--public-url",
		base,
	];

	await command(binary, [...args, "--seed"]);
	await command(binary, [...args, "--seed"]);
	simulator = spawn(binary, [
		...args,
		"--bind",
		`127.0.0.1:${port}`,
		"--frontend",
		join(root, "frontend/dist/client"),
	]);
	simulator.stdout.on("data", (chunk) => {
		simulatorLog += chunk;
	});
	simulator.stderr.on("data", (chunk) => {
		simulatorLog += chunk;
	});
	simulator.on("error", (error) => {
		simulatorLog += error.message;
	});

	await eventually(
		async () => (await fetch(`${base}/health`)).ok,
		"Simulator did not start",
	);
	const seeded = await json(`${base}/api/simulator/transactions`);
	assert.equal(
		seeded.length,
		6,
		"Running seeds twice must produce exactly six records",
	);
	assert.deepEqual(
		seeded.map((value) => `${value.kind}:${value.status}`).sort(),
		["card:0", "card:1", "card:2", "mobile:0", "mobile:1", "mobile:2"],
	);

	const settings = await json(`${base}/api/simulator/settings`);
	await json(`${base}/api/simulator/settings`, "PUT", {
		...settings,
		delayMs: 20,
	});
	await checkTypeScriptClient({
		base,
		callbackBase,
		typescriptRoot,
		json,
		eventually,
	});
	await command(process.env.PHP_BINARY ?? "php", [
		join(root, "scripts/check-php-client.php"),
		phpRoot,
		base,
		callbackBase,
	]);

	const transactions = await json(`${base}/api/simulator/transactions`);
	const generated = transactions.filter((value) =>
		/^(ts|php)-/.test(value.request.reference),
	);
	assert.equal(
		generated.length,
		16,
		"Both SDKs must create eight transactions each",
	);
	assert.ok(
		generated.every((value) => !value.request.authorization),
		"Credentials must not be stored in payment payloads",
	);
	console.log(
		"Cross-client integration passed: 6 idempotent seeds; 16 SDK payments/payouts; callbacks, replay, checkout, cancellation, and pending resolution.",
	);
} catch (error) {
	console.error(simulatorLog);
	throw error;
} finally {
	if (simulator && simulator.exitCode === null) {
		const stopped = once(simulator, "exit");
		simulator.kill("SIGINT");
		await stopped;
	}

	await new Promise((resolveClose) => receiver.close(resolveClose));
	await rm(temporary, { recursive: true, force: true });
}

async function command(executable, args) {
	const child = spawn(executable, args, { cwd: temporary, stdio: "inherit" });
	const [code] = await once(child, "exit");
	assert.equal(code, 0, `${executable} failed`);
}

async function json(url, method = "GET", body) {
	const response = await fetch(url, {
		method,
		headers: {
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(5000),
	});
	assert.ok(response.ok, `${method} ${url}: ${response.status}`);
	return response.json();
}

async function eventually(predicate, message) {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			if (await predicate()) {
				return;
			}
		} catch (error) {
			if (
				!(error instanceof TypeError && error.cause?.code === "ECONNREFUSED")
			) {
				throw error;
			}
		}

		await delay(50);
	}

	throw new Error(message);
}
