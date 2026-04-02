import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const releaseRoot = path.join(rootDir, ".release", "jsr");
const packageOrder = ["core", "discord-api", "discordjs"];

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		shell: process.platform === "win32"
	});

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
	}
}

async function isVersionPublished(manifestPath) {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const response = await fetch(`https://jsr.io/${manifest.name}/${manifest.version}_meta.json`, {
		method: "HEAD"
	});

	return response.ok;
}

for (const slug of packageOrder) {
	const packageDir = path.join(releaseRoot, slug);
	const manifestPath = path.join(packageDir, "package.json");

	if (await isVersionPublished(manifestPath)) {
		console.log(`Skipping ${slug}; this JSR version is already published.`);
		continue;
	}

	console.log(`Dry-running JSR publish for ${slug}.`);
	run("npx", ["jsr", "publish", "--dry-run", "--allow-dirty"], packageDir);

	console.log(`Publishing ${slug} to JSR.`);
	run("npx", ["jsr", "publish", "--allow-dirty"], packageDir);
}
