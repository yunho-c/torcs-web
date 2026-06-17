const emittedWarnings = new Set();

export function warnOnce(key, message, details = undefined) {
	if (emittedWarnings.has(key)) {
		return;
	}
	emittedWarnings.add(key);
	if (details === undefined) {
		console.warn(message);
		return;
	}
	console.warn(message, details);
}
