#!/usr/bin/env bash
# Gera pipewire-sink-toggle.streamDeckPlugin na raiz do repositório (pasta pai da .sdPlugin).
# Inclui só ficheiros necessários em runtime (sem src/, tsconfig, scripts, etc.).
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
ARCHIVE="$REPO_ROOT/pipewire-sink-toggle.streamDeckPlugin"
NAME="$(basename "$PLUGIN_ROOT")"
BIN="$PLUGIN_ROOT/bin/plugin.js"

if ! command -v zip >/dev/null 2>&1; then
	echo "pack: o comando 'zip' não está instalado (ex.: sudo apt install zip)" >&2
	exit 1
fi

if [[ ! -f "$BIN" ]]; then
	echo "pack: falta $BIN — execute primeiro: npm run build:js" >&2
	exit 1
fi

WS_DIR="$PLUGIN_ROOT/node_modules/ws"
if [[ ! -d "$WS_DIR" ]]; then
	echo "pack: falta $WS_DIR — execute npm install na pasta .sdPlugin (dependência ws, não empacotável pelo esbuild)" >&2
	exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$NAME/bin" "$STAGE/$NAME/node_modules"
cp "$PLUGIN_ROOT/manifest.json" "$STAGE/$NAME/"
cp "$BIN" "$STAGE/$NAME/bin/"
cp -a "$PLUGIN_ROOT/propertyInspector" "$STAGE/$NAME/"
cp -a "$PLUGIN_ROOT/imgs" "$STAGE/$NAME/"
cp -a "$WS_DIR" "$STAGE/$NAME/node_modules/"

rm -f "$ARCHIVE"
(cd "$STAGE" && zip -rq "$ARCHIVE" "$NAME")
echo "pack: criado $ARCHIVE (manifest, bin/plugin.js, node_modules/ws, propertyInspector, imgs)"
