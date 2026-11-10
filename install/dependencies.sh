#!/bin/bash
set -euo pipefail
case "${1:-}" in
  git)
    if git --version >/dev/null 2>&1; then exit 0; fi
    xcode-select --install
    echo 'Завершите установку Command Line Tools в системном окне, затем повторите moootion setup.'
    ;;
  docker)
    if [ ! -d /Applications/Docker.app ]; then
      case "$(uname -m)" in arm64) arch=arm64 ;; x86_64) arch=amd64 ;; *) exit 1 ;; esac
      tmp="$(mktemp -d)"
      mounted=0
      cleanup() { if [ "$mounted" = 1 ]; then hdiutil detach "$tmp/volume" >/dev/null || true; fi; rm -rf "$tmp"; }
      trap cleanup EXIT
      curl -fL "https://desktop.docker.com/mac/main/$arch/Docker.dmg" -o "$tmp/Docker.dmg"
      hdiutil attach "$tmp/Docker.dmg" -nobrowse -mountpoint "$tmp/volume"
      mounted=1
      ditto "$tmp/volume/Docker.app" /Applications/Docker.app
    fi
    open -a /Applications/Docker.app
    echo 'Завершите штатные окна первого запуска Docker Desktop. Условия сервиса принимаются пользователем.'
    ;;
  *) echo 'Ожидается git или docker' >&2; exit 1 ;;
esac
