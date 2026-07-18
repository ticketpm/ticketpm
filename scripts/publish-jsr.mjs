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

async function isVersionPublished(configPath) {
	const config = JSON.parse(readFileSync(configPath, "utf8"));
	const response = await fetch(`https://jsr.io/${config.name}/${config.version}_meta.json`, {
		method: "HEAD"
	});

	return response.ok;
}

for (const slug of packageOrder) {
	const packageDir = path.join(releaseRoot, slug);
	const configPath = path.join(packageDir, "jsr.json");

	if (await isVersionPublished(configPath)) {
		console.log(`Skipping ${slug}; this JSR version is already published.`);
		continue;
	}

	console.log(`Dry-running JSR publish for ${slug}.`);
	run("npx", ["jsr", "publish", "--dry-run", "--allow-dirty"], packageDir);

	console.log(`Publishing ${slug} to JSR.`);
	run("npx", ["jsr", "publish", "--allow-dirty"], packageDir);
}
