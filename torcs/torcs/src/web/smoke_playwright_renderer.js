#!/usr/bin/env node

const { chromium } = require("playwright");

const DEFAULT_URL = "http://127.0.0.1:8002/torcs_web_renderer.html";
const DEFAULT_TRACK = "speed-dreams:data/tracks/circuit/jarama/jarama.xml";
const DEFAULT_CAR = "/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml";
const DEFAULT_RUNTIME_TRACK = "/torcs/data/tracks/circuit/jarama/jarama.xml";

function parseArgs(argv) {
	const result = {
		url: process.env.TORCS_WEB_URL || DEFAULT_URL,
		track: process.env.TORCS_WEB_TRACK || DEFAULT_TRACK,
		car: process.env.TORCS_WEB_CAR || DEFAULT_CAR,
		runtimeTrack: process.env.TORCS_WEB_RUNTIME_TRACK || DEFAULT_RUNTIME_TRACK,
		headed: process.env.TORCS_WEB_HEADED === "1",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === "--url" && next) {
			result.url = next;
			index += 1;
		} else if (arg === "--track" && next) {
			result.track = next;
			index += 1;
		} else if (arg === "--car" && next) {
			result.car = next;
			index += 1;
		} else if (arg === "--runtime-track" && next) {
			result.runtimeTrack = next;
			index += 1;
		} else if (arg === "--headed") {
			result.headed = true;
		} else if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return result;
}

function printUsage() {
	console.log(`Usage: node torcs/torcs/src/web/smoke_playwright_renderer.js [options]

Options:
  --url URL              Renderer URL. Defaults to ${DEFAULT_URL}
  --track VALUE          Track select value. Defaults to Jarama Speed Dreams key
  --car VALUE            Car select value. Defaults to kc-2000gt runtime path
  --runtime-track PATH   Expected runtime track path after Start
  --headed               Run Chromium headed
`);
}

function fail(message, details = {}) {
	console.error(message);
	console.error(JSON.stringify(details, null, 2));
	process.exit(1);
}

function isIgnorableConsoleMessage(message) {
	return /No available adapters|WebGPU is not supported|WebGPU is not available|Falling back to WebGL2|GPU stall due to ReadPixels|skipped background dome because no texture was provided/i
		.test(message.text);
}

async function waitForOption(page, selector, value) {
	await page.waitForFunction(
		({ selector: selectSelector, value: optionValue }) =>
			Array.from(document.querySelector(selectSelector)?.options || [])
				.some((option) => option.value === optionValue),
		{ selector, value },
		{ timeout: 30000 },
	);
}

async function waitForState(page, state) {
	await page.waitForFunction(
		(expected) => document.querySelector("#state")?.textContent?.trim().toLowerCase() === expected,
		state,
		{ timeout: 30000 },
	);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const consoleMessages = [];
	const pageErrors = [];
	const failedRequests = [];
	let runtimeSelection = null;

	const browser = await chromium.launch({ headless: !options.headed });
	const page = await browser.newPage();
	page.on("console", (message) => {
		const item = {
			type: message.type(),
			text: message.text(),
			location: message.location(),
		};
		consoleMessages.push(item);
	});
	page.on("pageerror", (error) => {
		pageErrors.push({ name: error.name, message: error.message, stack: error.stack });
	});
	page.on("requestfailed", (request) => {
		const failure = request.failure();
		failedRequests.push({
			url: request.url(),
			method: request.method(),
			resourceType: request.resourceType(),
			errorText: failure ? failure.errorText : "",
		});
	});

	try {
		await page.goto(options.url, { waitUntil: "domcontentloaded" });
		await waitForState(page, "loaded");
		await waitForOption(page, "#track", options.track);
		await waitForOption(page, "#car", options.car);
		await page.selectOption("#track", options.track);
		await page.selectOption("#car", options.car);
		await page.click("#start");
		await waitForState(page, "ready");
		await page.waitForTimeout(500);
		runtimeSelection = await page.evaluate(() => window.torcsLastRuntimeSelection || null);
	} finally {
		await browser.close();
	}

	const blockingConsole = consoleMessages.filter((message) =>
		(message.type === "error" || message.type === "warning") &&
		!isIgnorableConsoleMessage(message),
	);
	const fallbackWarnings = consoleMessages.filter((message) =>
		message.text.includes("using default TORCS runtime data behind converted visual assets"),
	);
	const runtimeResolutionMessages = consoleMessages.filter((message) =>
		message.text.includes("TORCS web renderer using resolved runtime data behind selected visual assets"),
	);
	const importantRequestFailures = failedRequests.filter((request) =>
		!request.url.startsWith("data:") &&
		!request.url.includes("favicon.ico"),
	);
	const runtimeSelectionMismatch = !runtimeSelection ||
		runtimeSelection.runtimeTrack !== options.runtimeTrack ||
		runtimeSelection.trackUsesFallback ||
		runtimeSelection.carUsesFallback;

	if (pageErrors.length || importantRequestFailures.length || fallbackWarnings.length ||
		runtimeSelectionMismatch || blockingConsole.length) {
		fail("TORCS Playwright renderer smoke test failed", {
			url: options.url,
			track: options.track,
			car: options.car,
			expectedRuntimeTrack: options.runtimeTrack,
			runtimeSelection,
			pageErrors,
			failedRequests: importantRequestFailures,
			fallbackWarnings,
			runtimeResolutionMessages,
			blockingConsole,
		});
	}

	console.log(JSON.stringify({
		url: options.url,
		track: options.track,
		car: options.car,
		expectedRuntimeTrack: options.runtimeTrack,
		runtimeSelection,
		consoleMessages: consoleMessages.length,
		runtimeResolutionMessages: runtimeResolutionMessages.length,
	}, null, 2));
}

main().catch((error) => {
	fail("TORCS Playwright renderer smoke test failed to run", {
		name: error.name,
		message: error.message,
		stack: error.stack,
	});
});
