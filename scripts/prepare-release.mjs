import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const packagesDir = path.join(rootDir, "packages");
const releaseDir = path.join(rootDir, ".release");
const repoUrl = "https://github.com/ticketpm/packages.git";
const repoHttpUrl = "https://github.com/ticketpm/packages";
const packageOrder = ["core", "discord-api", "discordjs"];

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function normalizeWorkspaceDependency(version) {
	if (version === "workspace:*") {
		return true;
	}

	return version.startsWith("workspace:");
}

function rewriteInternalDependencies(dependencies, releaseVersion, registry) {
	if (!dependencies) {
		return undefined;
	}

	const rewritten = Object.fromEntries(
		Object.entries(dependencies).map(([name, range]) => {
			if (!name.startsWith("@ticketpm/")) {
				return [name, range];
			}

			assert(normalizeWorkspaceDependency(range), `Expected ${name} to use workspace: dependencies before release preparation.`);

			if (registry === "npm") {
				return [name, releaseVersion];
			}

			return [name, `npm:@jsr/${name.slice(1).replace("/", "__")}@${releaseVersion}`];
		})
	);

	return Object.keys(rewritten).length > 0 ? rewritten : undefined;
}

function copyIfPresent(sourcePath, targetPath) {
	if (!existsSync(sourcePath)) {
		return;
	}

	cpSync(sourcePath, targetPath, { recursive: true });
}

function jsrSpecifier(packageName, version) {
	return `jsr:${packageName}@${version}`;
}

function rewriteJsrSourceImports(sourceDir, releaseVersion) {
	if (!existsSync(sourceDir)) {
		return;
	}

	for (const entry of readdirSync(sourceDir)) {
		const entryPath = path.join(sourceDir, entry);
		const stats = statSync(entryPath);

		if (stats.isDirectory()) {
			rewriteJsrSourceImports(entryPath, releaseVersion);
			continue;
		}

		if (!entryPath.endsWith(".ts")) {
			continue;
		}

		let source = readFileSync(entryPath, "utf8");
		source = source.replaceAll(
			/"@ticketpm\/([^"]+)"/g,
			(_, packageSlug) => `"${jsrSpecifier(`@ticketpm/${packageSlug}`, releaseVersion)}"`
		);
		source = source.replaceAll(
			/'@ticketpm\/([^']+)'/g,
			(_, packageSlug) => `'${jsrSpecifier(`@ticketpm/${packageSlug}`, releaseVersion)}'`
		);
		writeFileSync(entryPath, source);
	}
}

function packageMetadata(pkg) {
	return {
		name: pkg.manifest.name,
		version: pkg.manifest.version,
		description: pkg.manifest.description,
		license: pkg.manifest.license,
		type: pkg.manifest.type,
		sideEffects: pkg.manifest.sideEffects,
		repository: {
			type: "git",
			url: repoUrl,
			directory: `packages/${pkg.slug}`
		},
		bugs: {
			url: `${repoHttpUrl}/issues`
		},
		homepage: `${repoHttpUrl}/tree/main/packages/${pkg.slug}#readme`
	};
}

const packages = packageOrder.map((slug) => {
	const packageDir = path.join(packagesDir, slug);
	const manifestPath = path.join(packageDir, "package.json");
	const manifest = readJson(manifestPath);

	return {
		slug,
		dir: packageDir,
		manifest
	};
});

const releaseVersion = packages[0]?.manifest.version;

assert(releaseVersion, "Could not determine the workspace release version.");
assert(
	packages.every((pkg) => pkg.manifest.version === releaseVersion),
	"All packages must use the same lockstep version before publishing."
);

const refName = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (refName) {
	assert(refName === `v${releaseVersion}`, `Git tag ${refName} does not match the lockstep version v${releaseVersion}.`);
}

rmSync(releaseDir, { recursive: true, force: true });

for (const pkg of packages) {
	const distDir = path.join(pkg.dir, "dist");
	assert(existsSync(distDir), `Missing build output for ${pkg.manifest.name}. Run the build before preparing a release.`);

	const npmTargetDir = path.join(releaseDir, "npm", pkg.slug);
	mkdirSync(npmTargetDir, { recursive: true });
	copyIfPresent(distDir, path.join(npmTargetDir, "dist"));
	copyIfPresent(path.join(pkg.dir, "README.md"), path.join(npmTargetDir, "README.md"));
	copyIfPresent(path.join(rootDir, "LICENSE"), path.join(npmTargetDir, "LICENSE"));

	const npmManifest = {
		...packageMetadata(pkg),
		exports: pkg.manifest.exports,
		files: ["dist", "README.md", "LICENSE"],
		publishConfig: {
			access: "public",
			provenance: true
		},
		dependencies: rewriteInternalDependencies(pkg.manifest.dependencies, releaseVersion, "npm"),
		peerDependencies: pkg.manifest.peerDependencies,
		peerDependenciesMeta: pkg.manifest.peerDependenciesMeta,
		optionalDependencies: pkg.manifest.optionalDependencies,
		engines: pkg.manifest.engines
	};

	writeJson(path.join(npmTargetDir, "package.json"), npmManifest);

	const jsrTargetDir = path.join(releaseDir, "jsr", pkg.slug);
	mkdirSync(jsrTargetDir, { recursive: true });
	copyIfPresent(path.join(pkg.dir, "src"), path.join(jsrTargetDir, "src"));
	copyIfPresent(path.join(pkg.dir, "README.md"), path.join(jsrTargetDir, "README.md"));
	copyIfPresent(path.join(rootDir, "LICENSE"), path.join(jsrTargetDir, "LICENSE"));
	rewriteJsrSourceImports(path.join(jsrTargetDir, "src"), releaseVersion);

	const jsrDependencies = {
		...(rewriteInternalDependencies(pkg.manifest.dependencies, releaseVersion, "jsr") ?? {}),
		...(pkg.manifest.peerDependencies ?? {})
	};

	if (pkg.slug === "discordjs" && pkg.manifest.devDependencies?.["discord.js"]) {
		jsrDependencies["discord.js"] ??= pkg.manifest.devDependencies["discord.js"];
	}

	const jsrManifest = {
		name: pkg.manifest.name,
		version: releaseVersion,
		type: "module",
		dependencies: Object.keys(jsrDependencies).length > 0 ? jsrDependencies : undefined
	};

	const jsrConfig = {
		name: pkg.manifest.name,
		version: releaseVersion,
		exports: "./src/index.ts"
	};

	writeJson(path.join(jsrTargetDir, "package.json"), jsrManifest);
	writeJson(path.join(jsrTargetDir, "jsr.json"), jsrConfig);
}

console.log(`Prepared release bundles for version ${releaseVersion} in ${path.relative(rootDir, releaseDir)}.`);
