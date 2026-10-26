#!/bin/bash
# Установка (и обновление) студии Moootion на маке одной командой:
#   curl -fsSL https://github.com/__REPO__/releases/latest/download/install.sh | bash
# Ставит студию в ~/Moootion (свой Node внутри, без sudo и Homebrew). При обновлении заменяется только код:
# проекты, рендеры и настройки (projects/, renders/, trash/, .moootion/) остаются на месте и никуда не отправляются.
set -euo pipefail

REPO="__REPO__"
HOME_DIR="${MOOOTION_HOME:-$HOME/Moootion}"
say() { printf '\033[1m%s\033[0m\n' "$*"; }

[ "$(uname -s)" = "Darwin" ] || { echo "Этот установщик — для macOS. Для Windows: install.ps1"; exit 1; }
case "$(uname -m)" in
  arm64) TARGET="mac-arm64"; ARCH="arm64" ;;
  x86_64) TARGET="mac-x64"; ARCH="x64" ;;
  *) echo "Неизвестная архитектура: $(uname -m)"; exit 1 ;;
esac

# git нужен для версий проектов (откат правок агента). На маке он приходит с Command Line Tools.
if ! xcode-select -p >/dev/null 2>&1; then
  say "Нужны Command Line Tools от Apple (в них git) — сейчас откроется системное окно, нажмите «Установить»."
  xcode-select --install >/dev/null 2>&1 || true
  echo "Установка студии продолжится; версии проектов заработают, когда Command Line Tools установятся."
fi

say "Скачиваю Moootion ($TARGET)…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fL --progress-bar "https://github.com/$REPO/releases/latest/download/moootion-$TARGET.tar.gz" -o "$TMP/moootion.tar.gz"
tar -xzf "$TMP/moootion.tar.gz" -C "$TMP"

say "Ставлю в $HOME_DIR…"
mkdir -p "$HOME_DIR"
# only the code is replaced; the user's data stays
for item in server studio runtime library templates tools node_modules .runtime package.json package-lock.json \
  vite.config.ts tsconfig.json README.md NOTICE.md moootion .sdk-version; do
  rm -rf "${HOME_DIR:?}/$item"
done
cp -R "$TMP/Moootion/." "$HOME_DIR/"
mkdir -p "$HOME_DIR/projects"

cd "$HOME_DIR"
NODE="$HOME_DIR/.runtime/node/bin/node"
NPM="$HOME_DIR/.runtime/node/lib/node_modules/npm/bin/npm-cli.js"
say "Ставлю агента Claude (Claude Agent SDK $(cat .sdk-version)) из npm…"
PATH="$HOME_DIR/.runtime/node/bin:$PATH" "$NODE" "$NPM" install --no-save --no-audit --no-fund --loglevel=error \
  "@anthropic-ai/claude-agent-sdk@$(cat .sdk-version)"
CLAUDE="$HOME_DIR/node_modules/@anthropic-ai/claude-agent-sdk-darwin-$ARCH/claude"

# the `moootion` command and a Desktop launcher
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME_DIR/moootion" "$HOME/.local/bin/moootion"
cat > "$HOME/Desktop/Moootion.command" <<EOF
#!/bin/bash
exec "$HOME_DIR/moootion" start
EOF
chmod +x "$HOME/Desktop/Moootion.command"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *)
  for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
    grep -qs 'local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
  done ;;
esac

# Claude: the studio works through your Claude subscription (Pro or Max)
if ! "$CLAUDE" auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
  say "Войдите в Claude — откроется браузер (нужна подписка Pro или Max):"
  "$CLAUDE" auth login </dev/tty || echo "Войти можно и позже: moootion login"
fi

say "Готово. Запуск: значок Moootion на рабочем столе или команда moootion в новом окне Терминала."
say "Figma и Magnific подключаются в claude.ai → Настройки → Коннекторы."
if [ -t 1 ] || [ -e /dev/tty ]; then
  printf "Запустить студию сейчас? [Y/n] "
  read -r answer </dev/tty || answer="y"
  case "$answer" in n|N) ;; *) exec "$HOME_DIR/moootion" start ;; esac
fi
