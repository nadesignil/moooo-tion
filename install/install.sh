#!/bin/bash
# curl -fsSL https://github.com/__REPO__/releases/latest/download/install.sh | bash
# Optional: MOOOTION_PROVIDER=chatgpt|claude; setup options are forwarded as arguments.
set -euo pipefail
REPO='__REPO__'
HOME_DIR="${MOOOTION_HOME:-$HOME/Moootion}"
[ "$(uname -s)" = Darwin ] || { echo 'Для Windows используйте install.ps1'; exit 1; }
case "$(uname -m)" in arm64) TARGET=mac-arm64 ;; x86_64) TARGET=mac-x64 ;; *) exit 1 ;; esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf 'Скачиваю Moootion (%s)…\n' "$TARGET"
curl -fL "https://github.com/$REPO/releases/latest/download/moootion-$TARGET.tar.gz" -o "$TMP/moootion.tar.gz"
tar -xzf "$TMP/moootion.tar.gz" -C "$TMP"
# Validate before replacing any installed code. User projects/settings are not in this list.
[ -f "$TMP/Moootion/tools/setup.mjs" ] || { echo 'В этом релизе нет нового мастера установки. Нужен релиз с tools/setup.mjs.'; exit 1; }
[ -x "$TMP/Moootion/.runtime/node/bin/node" ] || exit 1
mkdir -p "$HOME_DIR"
for item in server studio runtime library templates tools install rules docs node_modules package.json package-lock.json vite.config.ts tsconfig.json README.md NOTICE.md moootion .sdk-version; do
  rm -rf "${HOME_DIR:?}/$item"
done
# Preserve .runtime/agents, which may contain the locally installed Codex CLI.
cp -R "$TMP/Moootion/." "$HOME_DIR/"
mkdir -p "$HOME_DIR/projects" "$HOME/.local/bin" "$HOME/Desktop"
ln -sf "$HOME_DIR/moootion" "$HOME/.local/bin/moootion"
# Quote the installation path as shell data, including apostrophes or dollar signs.
printf '#!/bin/bash\nexec %q start\n' "$HOME_DIR/moootion" > "$HOME/Desktop/Moootion.command"
chmod +x "$HOME/Desktop/Moootion.command"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *)
  for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
    grep -qs 'local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
  done ;;
esac
cd "$HOME_DIR"
NODE="$HOME_DIR/.runtime/node/bin/node"
# A piped curl script still gets a real terminal for the installation survey.
status=0
if ( : </dev/tty ) 2>/dev/null; then
  "$NODE" tools/setup.mjs "$@" </dev/tty || status=$?
else
  "$NODE" tools/setup.mjs "$@" || status=$?
fi
if [ "$status" -eq 0 ]; then
  echo 'Установка проверена. Запуск: moootion или ярлык на рабочем столе.'
elif [ "$status" -eq 2 ]; then
  echo 'Файлы установлены. Завершите отмеченные подключения: moootion setup. Студию можно открыть командой moootion.'
else
  echo 'Мастер установки завершился с ошибкой. Повторить: moootion setup.'
fi
exit "$status"
