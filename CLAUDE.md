# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Beeyond Limits is a Chrome Manifest V3 extension (React 19 + Vite + Tailwind 4, plain JS, no TypeScript). It is local-first: all state lives in `chrome.storage.local`, and there is no backend.

## Commands

```bash
npm install
npm run build        # vite build + scripts/copy-extension-files.mjs -> dist/
npm test             # node --test (built-in runner, no framework)
npm run lint         # eslint .
node --test tests/focusEngine.test.js                      # single file
node --test --test-name-pattern="pause" tests/focusEngine.test.js  # single test
```

CI (`.github/workflows/ci.yml`, Node 22) runs lint, test, and build. All three must pass.

To run the extension, load `dist/` unpacked at `chrome://extensions`. After any change, rebuild and click Reload. `npm run dev` only renders the popup UI, with no `chrome.*` APIs available. Changes to timers, blocking, storage, alarms, or audio have to be checked in a real `dist/` build: close and reopen the popup, let a phase transition happen, mute the alarm popup.

## Build gotcha: background code is not bundled

Vite bundles only the popup (`index.html` -> `src/main.jsx`). `scripts/copy-extension-files.mjs` copies `src/background.js`, `src/offscreen.{html,js}`, and the whole `src/core/` directory into `dist/` **as-is**, and copies `src/blocked.{html,js}` to the `dist/` root. As a result:

- `src/core/*.js`, `background.js`, and `offscreen.js` must be plain browser ES modules. They can't import npm packages or JSX, and every relative import needs its `.js` extension.
- If you add a new file that the service worker, offscreen document, or blocked page needs outside `src/core/`, you must also add it to the copy script.
- The popup also imports `src/core/` modules, so those modules are used in both the bundled and the unbundled context.

## Architecture

**The service worker is the single source of truth.** `src/background.js` owns three managers: `FocusSessionManager`, `BackgroundPomodoroManager`, and `AmbientSoundManager`. Timers use `chrome.alarms` (`focusSessionTimer`, `pomodoroTimer`), so they keep running after the popup closes. The popup holds no authoritative state. It sends `chrome.runtime.onMessage` messages (`FOCUS_*`, `POMODORO_*`, `AMBIENT_*`, `UPDATE_BLOCKING_RULES`) and receives `FOCUS_STATE_UPDATE` / `POMODORO_STATE_UPDATE` broadcasts. Every handler replies `{ success, error? }` through `respond()`.

**Serialized operations.** Each domain has its own `createOperationQueue()` (blocker, pomodoro, ambient, focus) so that alarm callbacks and messages can't interleave on the same state. New mutating handlers must run through the matching queue.

**Layering inside `src/core/`:**
- `focusSession.js`: pure state machine with no chrome APIs. States are `idle`, `active_focus`, `paused_focus`, `focus_completed`, `active_break`, `paused_break`, `break_completed`, and `abandoned`. Transitions are pure functions (`createFocusSession`, `pauseFocusSession`, `startNextFocusCycle`, …) and must stay deterministic.
- `focusStorage.js`: persistence and normalization for the `STORAGE_KEYS` records (active session, templates, history, preferences), with `chrome.storage` injected as a parameter.
- `blocking.js`: domain normalization and the one Declarative Net Request rule engine (dynamic rule IDs start at 1000). Blocked pages redirect to `blocked.html`.
- `offscreenBridge.js` + `audio.js` + `offscreen.js`: MV3 service workers can't play audio, so all alarm and ambient playback goes through an offscreen document. Messages addressed to it carry `target: "offscreen"`, and the background listener ignores them.
- `focusSessionClient.js` / `hooks/useFocusSession.js`: the popup side of the focus protocol.

**Popup routing.** There is no router library. `App.jsx` switches on a `currentPage` string. On load, it routes to `alarm` when there is a pending alarm and the session is in a `*_completed` state, or to `focus-active` when a session is running. It also reads `?view=alarm|focus-complete` from the URL, which is how the background opens the alarm popup (this needs Chrome 127+).

**Two blockers, one engine (ADR-001).** The Website Blocker quick tool keeps its own `blockedUrls`/`isBlocking`. Each Focus Session template and runtime snapshot owns a separate blocklist. While a session is running, its rules take precedence: `UPDATE_BLOCKING_RULES` only saves the quick tool config, and breaks run unblocked. When it ends, the stored quick tool state is re-applied. Don't couple the two configurations. `synchronizeStartup()` re-applies whichever one owns blocking after a browser restart.

## Tests

Tests live in `tests/*.test.js` and use `node:test` and `node:assert/strict`. Background tests build a hand-written `chrome` mock on `globalThis` and then re-import the service worker with a cache-busting query string (`import(\`../src/background.js?test=${Date.now()}\`)`), so every import gets a fresh module. Some suites wrap tests in a `serialTest` helper because the mock is global. Pure `src/core` modules are imported directly.

## Conventions

- UI follows the neo-brutalist "Carnival" design system in `DESIGN.md`: 3px ink borders, hard offset shadows (`brutal-border`, `brutal-shadow`), flat colors, Anton/Outfit/JetBrains Mono. Avoid rounded corners, soft shadows, and gradients. The popup is fixed at 400px wide.
- Don't add Chrome permissions without updating `docs/CHROME_WEB_STORE.md`. Don't add remote code or telemetry without updating `PRIVACY.md`.
- Architectural decisions go in `docs/decisions/` (ADRs). Feature specs are in `docs/specs/`.
- `PROJECT.md` holds the Focus Session states, storage keys, and message protocol. Update it when those change. The `docs/BUG_*` reports are historical, so their old file paths are expected.
- Commit messages are often written in Vietnamese.
