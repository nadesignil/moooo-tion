#!/bin/bash
set -euo pipefail
SRC="${BASH_SOURCE[0]}"
while [ -L "$SRC" ]; do
  LINK="$(readlink "$SRC")"
  case "$LINK" in /*) SRC="$LINK" ;; *) SRC="$(dirname "$SRC")/$LINK" ;; esac
done
DIR="$(cd "$(dirname "$SRC")" && pwd)"
NODE="$DIR/.runtime/node/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
cmd="${1:-start}"
[ "$#" -eq 0 ] || shift
cd "$DIR"
case "$cmd" in
  version|--version|-v) "$NODE" -p "require('./package.json').version" ;;
  start) exec "$NODE" tools/start.mjs "$@" ;;
  setup) exec "$NODE" tools/setup.mjs "$@" ;;
  login) exec "$NODE" tools/setup.mjs --login "$@" ;;
  doctor) exec "$NODE" tools/setup.mjs --check "$@" ;;
  update)
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    curl -fsSL 'https://github.com/__REPO__/releases/latest/download/install.sh' -o "$tmp"
    MOOOTION_HOME="$DIR" bash "$tmp" "$@"
    ;;
  *) echo 'Команды: moootion [start|setup|login|doctor|update|version]'; exit 1 ;;
esac
