#!/bin/bash
# Moootion — запуск и обслуживание студии на маке.
#   moootion            запустить студию (откроется браузер)
#   moootion login      войти в Claude (подписка Pro или Max)
#   moootion update     обновить студию до последней версии (проекты не трогаются)
#   moootion doctor     проверить, всё ли на месте
set -euo pipefail

# the real folder of the studio, even when called through the ~/.local/bin link
SRC="${BASH_SOURCE[0]}"
while [ -L "$SRC" ]; do
  LINK="$(readlink "$SRC")"
  case "$LINK" in /*) SRC="$LINK" ;; *) SRC="$(dirname "$SRC")/$LINK" ;; esac
done
DIR="$(cd "$(dirname "$SRC")" && pwd)"
NODE="$DIR/.runtime/node/bin/node"
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
CLAUDE="$DIR/node_modules/@anthropic-ai/claude-agent-sdk-darwin-$ARCH/claude"

case "${1:-start}" in
  start)
    cd "$DIR"
    exec "$NODE" tools/start.mjs
    ;;
  login)
    exec "$CLAUDE" auth login
    ;;
  update)
    curl -fsSL "https://github.com/__REPO__/releases/latest/download/install.sh" | bash
    ;;
  doctor)
    echo "Студия:  $DIR"
    echo "Node:    $("$NODE" --version)"
    if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then echo "git:     $(git --version)"; else echo "git:     нет — версии проектов не будут сохраняться (xcode-select --install)"; fi
    if [ -x "$CLAUDE" ]; then echo "Claude:  $("$CLAUDE" auth status --text 2>/dev/null | head -1)"; else echo "Claude:  агент не установлен — запустите: moootion update"; fi
    if command -v python3 >/dev/null 2>&1; then echo "Python:  $(python3 --version) (необязательно)"; else echo "Python:  нет (необязательно)"; fi
    cd "$DIR" && "$NODE" node_modules/tsx/dist/cli.mjs tools/smoke.ts
    ;;
  *)
    echo "Команды: moootion [start|login|update|doctor]"
    exit 1
    ;;
esac
