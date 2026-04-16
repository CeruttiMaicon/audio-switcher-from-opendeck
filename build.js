#!/usr/bin/env node
/**
 * Gera `dist/audio-switcher-opendeck-linux-v<Version>.sdPlugin.zip` para instalação no OpenDeck.
 * Lê a versão de `audio-switcher.sdPlugin/manifest.json` e empacota apenas ficheiros de runtime
 * (manifest, bin/plugin.js, node_modules/ws, propertyInspector, imgs, layouts).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PLUGIN_NAME = "audio-switcher.sdPlugin";
const PLUGIN_ROOT = join(ROOT, PLUGIN_NAME);
const MANIFEST_PATH = join(PLUGIN_ROOT, "manifest.json");
const DIST_DIR = join(ROOT, "dist");

function readVersion() {
	if (!existsSync(MANIFEST_PATH)) {
		console.error(`build: manifest não encontrado: ${MANIFEST_PATH}`);
		process.exit(1);
	}
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
	} catch (e) {
		console.error("build: falha ao ler manifest.json:", e);
		process.exit(1);
	}
	const v = manifest.Version;
	if (typeof v !== "string" || !v.trim()) {
		console.error('build: manifest.json sem campo "Version" (string) válido.');
		process.exit(1);
	}
	return v.trim().replace(/[/\\<>:"|?*]/g, "-");
}

function ensureZipCli() {
	try {
		execFileSync("zip", ["-v"], { stdio: "pipe" });
	} catch {
		console.error("build: o comando 'zip' não está no PATH (ex.: sudo apt install zip)");
		process.exit(1);
	}
}

function runBuildJs() {
	const pkg = join(PLUGIN_ROOT, "package.json");
	if (!existsSync(pkg)) {
		console.error(`build: falta ${pkg}`);
		process.exit(1);
	}
	const r = spawnSync("npm", ["run", "build:js"], {
		cwd: PLUGIN_ROOT,
		stdio: "inherit",
		shell: false,
	});
	if (r.status !== 0) {
		process.exit(r.status ?? 1);
	}
}

function stageRelease(stagePluginRoot) {
	const binSrc = join(PLUGIN_ROOT, "bin", "plugin.js");
	const wsSrc = join(PLUGIN_ROOT, "node_modules", "ws");
	const piSrc = join(PLUGIN_ROOT, "propertyInspector");
	const imgsSrc = join(PLUGIN_ROOT, "imgs");
	const layoutsSrc = join(PLUGIN_ROOT, "layouts");

	if (!existsSync(binSrc)) {
		console.error(`build: falta ${binSrc} — npm run build:js na pasta ${PLUGIN_NAME}`);
		process.exit(1);
	}
	if (!existsSync(wsSrc)) {
		console.error(`build: falta ${wsSrc} — execute npm install em ${PLUGIN_NAME}`);
		process.exit(1);
	}
	if (!existsSync(piSrc) || !existsSync(imgsSrc) || !existsSync(layoutsSrc)) {
		console.error("build: faltam propertyInspector/, imgs/ ou layouts/");
		process.exit(1);
	}

	mkdirSync(join(stagePluginRoot, "bin"), { recursive: true });
	mkdirSync(join(stagePluginRoot, "node_modules"), { recursive: true });

	copyFileSync(MANIFEST_PATH, join(stagePluginRoot, "manifest.json"));
	copyFileSync(binSrc, join(stagePluginRoot, "bin", "plugin.js"));
	cpSync(piSrc, join(stagePluginRoot, "propertyInspector"), { recursive: true });
	cpSync(imgsSrc, join(stagePluginRoot, "imgs"), { recursive: true });
	cpSync(layoutsSrc, join(stagePluginRoot, "layouts"), { recursive: true });
	cpSync(wsSrc, join(stagePluginRoot, "node_modules", "ws"), { recursive: true });
}

function main() {
	if (!existsSync(PLUGIN_ROOT)) {
		console.error(`build: pasta do plugin não encontrada: ${PLUGIN_ROOT}`);
		process.exit(1);
	}

	ensureZipCli();
	const version = readVersion();
	const outName = `audio-switcher-opendeck-linux-v${version}.sdPlugin.zip`;
	const outPath = join(DIST_DIR, outName);

	runBuildJs();

	const stageParent = mkdtempSync(join(tmpdir(), "audio-switcher-pack-"));
	const stagePlugin = join(stageParent, PLUGIN_NAME);
	mkdirSync(stagePlugin, { recursive: true });

	try {
		stageRelease(stagePlugin);
		mkdirSync(DIST_DIR, { recursive: true });
		if (existsSync(outPath)) {
			rmSync(outPath, { force: true });
		}
		execFileSync("zip", ["-rq", outPath, PLUGIN_NAME], {
			cwd: stageParent,
			stdio: "inherit",
		});
		console.log(`build: criado ${outPath}`);
		validateOpenDeckZip(outPath, PLUGIN_NAME);
	} finally {
		rmSync(stageParent, { recursive: true, force: true });
	}
}

/**
 * Garante estrutura exigida pelo OpenDeck: raiz = `<pluginName>/`, sem dist/ aninhado nem pasta duplicada.
 */
function validateOpenDeckZip(zipPath, pluginName) {
	let listing;
	try {
		listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
	} catch (e) {
		console.error("build: não foi possível validar o ZIP (precisa de `unzip` com suporte a -Z1):", e);
		process.exit(1);
	}
	const paths = listing
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	if (paths.length === 0) {
		console.error("build: ZIP vazio.");
		process.exit(1);
	}
	const prefix = `${pluginName}/`;
	const bad = paths.filter(
		(p) =>
			!p.startsWith(prefix) ||
			p.includes("/dist/") ||
			p.includes(`${pluginName}/${pluginName}/`),
	);
	if (bad.length > 0) {
		console.error("build: estrutura do ZIP inválida (esperado só entradas sob", prefix + "):");
		for (const b of bad.slice(0, 15)) {
			console.error("  -", b);
		}
		process.exit(1);
	}
	if (!paths.includes(`${prefix}manifest.json`)) {
		console.error(`build: falta ${prefix}manifest.json no ZIP.`);
		process.exit(1);
	}
	if (!paths.includes(`${prefix}bin/plugin.js`)) {
		console.error(`build: falta ${prefix}bin/plugin.js no ZIP.`);
		process.exit(1);
	}
	console.log(`build: validação OK — raiz única ${prefix} (${paths.length} entradas)`);
}

function verifyOnly() {
	ensureZipCli();
	const version = readVersion();
	const outPath = join(DIST_DIR, `audio-switcher-opendeck-linux-v${version}.sdPlugin.zip`);
	if (!existsSync(outPath)) {
		console.error(`verify: ficheiro não encontrado: ${outPath}\n  Execute antes: npm run build`);
		process.exit(1);
	}
	validateOpenDeckZip(outPath, PLUGIN_NAME);
	console.log("verify: ZIP pronto para distribuição.");
}

if (process.argv.includes("--verify-only")) {
	verifyOnly();
} else {
	main();
}
