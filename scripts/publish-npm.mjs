import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const releaseRoot = path.join(rootDir, ".release", "npm");
const packageOrder = ["core", "discord-api", "discordjs"];

function run(command, args, cwd, options = {}) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		shell: process.platform === "win32",
		...options
	});

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
	}

	return result;
}

function runQuiet(command, args, cwd) {
	return spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: process.platform === "win32"
	});
}

for (const slug of packageOrder) {
	const packageDir = path.join(releaseRoot, slug);
	const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));

	const lookup = runQuiet(
		"npm",
		["view", `${manifest.name}@${manifest.version}`, "version", "--registry", "https://registry.npmjs.org/"],
		packageDir
	);

	if (lookup.status === 0) {
		console.log(`Skipping ${manifest.name}@${manifest.version}; it is already published on npm.`);
		continue;
	}

	console.log(`Publishing ${manifest.name}@${manifest.version} to npm.`);
	run("npm", ["publish", "--provenance", "--access", "public"], packageDir);
}
