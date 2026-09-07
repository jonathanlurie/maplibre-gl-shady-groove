import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";

// Uses an installed Chromium browser and Node's built-in WebSocket, with no test dependencies.
const executable =
	process.env.CHROME_PATH ??
	(process.platform === "darwin"
		? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
		: "google-chrome");
const profile = await mkdtemp(join(tmpdir(), "shady-groove-test-"));
const server = await createServer({
	root: process.env.TEST_ROOT,
	configFile: false,
	server: { host: "127.0.0.1", port: 0 },
	logLevel: "error",
});
const page = process.env.TEST_PAGE ?? "/tests/webgl.html";
let browser;
let socket;
try {
	await server.listen();
	const address = server.httpServer.address();
	const origin = `http://127.0.0.1:${address.port}`;
	browser = spawn(
		executable,
		[
			"--headless=new",
			"--no-first-run",
			"--no-default-browser-check",
			"--remote-debugging-port=0",
			`--user-data-dir=${profile}`,
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	let launchError;
	browser.on("error", (error) => {
		launchError = error;
	});
	let endpoint;
	for (let i = 0; i < 200; i++) {
		if (launchError) throw launchError;
		if (browser.exitCode !== null)
			throw new Error(`Chromium exited with ${browser.exitCode}`);
		try {
			const [port, path] = (
				await readFile(join(profile, "DevToolsActivePort"), "utf8")
			)
				.trim()
				.split("\n");
			endpoint = `ws://127.0.0.1:${port}${path}`;
			break;
		} catch {
			await delay(100);
		}
	}
	if (!endpoint)
		throw new Error("Chromium did not expose a debugging endpoint.");
	socket = new WebSocket(endpoint);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const pending = new Map();
	let id = 0;
	socket.addEventListener("message", ({ data }) => {
		const message = JSON.parse(data);
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
		else entry.resolve(message.result);
	});
	const send = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const callId = ++id;
			const timeout = setTimeout(() => {
				pending.delete(callId);
				reject(new Error(`Timed out: ${method}`));
			}, 60000);
			pending.set(callId, {
				resolve: (value) => {
					clearTimeout(timeout);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});
			socket.send(JSON.stringify({ id: callId, method, params, sessionId }));
		});
	for (const dpr of [1, 2]) {
		const { targetId } = await send("Target.createTarget", {
			url: "about:blank",
		});
		const { sessionId } = await send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		await send(
			"Emulation.setDeviceMetricsOverride",
			{ width: 800, height: 600, deviceScaleFactor: dpr, mobile: false },
			sessionId,
		);
		await send(
			"Page.navigate",
			{ url: `${origin}${page}` },
			sessionId,
		);
		for (let i = 0; i < 100; i++) {
			const ready = await send(
				"Runtime.evaluate",
				{
					expression: `location.pathname === ${JSON.stringify(page)} && document.readyState === 'complete'`,
					returnByValue: true,
				},
				sessionId,
			);
			if (ready.result.value) break;
			await delay(50);
		}
		const result = await send(
			"Runtime.evaluate",
			{
				expression: process.env.TEST_EXPRESSION ?? "import('/tests/webgl.ts').then(module => module.run())",
				awaitPromise: true,
				returnByValue: true,
			},
			sessionId,
		);
		if (result.exceptionDetails)
			throw new Error(
				result.exceptionDetails.exception?.description ??
					JSON.stringify(result.exceptionDetails),
			);
		console.log(`DPR ${dpr}: ${JSON.stringify(result.result.value, null, 2)}`);
		if (result.result.value.failed.length) process.exitCode = 1;
		await send("Target.closeTarget", { targetId });
	}
} finally {
	socket?.close();
	if (browser && browser.exitCode === null) {
		browser.kill();
		await Promise.race([
			new Promise((resolve) => browser.once("exit", resolve)),
			delay(5000),
		]);
		if (browser.exitCode === null) browser.kill("SIGKILL");
	}
	await server.close();
	await rm(profile, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 200,
	});
}
