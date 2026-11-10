# Запуск Moootion

При просьбе запустить студию запускай весь комплект через `npm run dev` или `npm start`, а не один Vite. API автоматически подготавливает Docker/Linux-исполнитель и проверяет авторизацию Codex и подключения Figma/Magnific. Не запускай модельные задачи или платные генерации ради проверки подключения.

Перед повторным запуском проверь порты 5173/8787. Если API работает, проверь `GET /api/projects/:id/chat` для всех проектов. Не прерывай работающие агентские задачи. Останавливай только проверенные процессы этой студии. Фоновый запуск в Windows выполняй со скрытым окном.

После запуска проверь HTTP-ответ интерфейса, API, `GET /api/codex/executor`, `GET /api/codex/status` и `GET /api/codex/connectors`. Открытый интерфейс не означает готовность исполнителя. Сообщай фактическую доступность каждого инструмента и конкретную причину отказа. Не объявляй Docker готовым до `ready: true`.

Docker запускается штатным CLI; при ошибке регистрации Windows используется установленный Docker Desktop.exe. Если и он не стартует, диагностируй установку; не подменяй изолированный shell выполнением агентского кода на хосте. Не перезагружай компьютер и не выполняй вход в аккаунты автоматически.

# Installing Moootion for a user

These instructions apply when the user asks to install or prepare this repository, not to video-generation tasks.

1. Choose the agent from the assistant carrying out the installation: ChatGPT/Codex → `--provider=chatgpt`; Claude → `--provider=claude`. Pass this explicitly if the host does not expose its identity. Preserve an existing provider on updates unless the user requests a switch.
2. Before installing extra services, ask once about the needed components: Docker Desktop for arbitrary Python/shell (including NumPy, SciPy, Pillow, OpenCV and FFmpeg), Figma for design import, and Magnific for media generation. Reuse authorization already given in the conversation. Node/Remotion and Git are the build/versioning prerequisites. Explain which components can be skipped.
3. Use the common installer (`moootion setup` / `node tools/setup.mjs`) with the user's choices, e.g. `--yes --docker=install --connectors=figma,magnific`. Do not silently select Claude or silently skip missing services because no TTY is available.
4. Complete the selected provider login and service connections through their normal flows. Let the user handle legal agreements and credentials when required. Never copy credentials between providers.
5. Run the readiness checks and smoke render. Report unfinished login, Docker setup/reboot, missing components or connectors honestly; an unpacked archive is not a fully ready installation.

See `docs/installation.md`. Local installer changes require a new published release before remote installations use them.
