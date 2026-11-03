# Project: Focus Session for Beeyond Limits

This document describes the Focus Session as it is implemented now. The original MVP plan (milestones M1–M8) is in git history.

## Architecture

- `src/core/focusSession.js`: pure domain model. It holds the state machine, duration and progress calculations, and validation, and makes no Chrome API calls.
- `src/core/focusStorage.js`: reads, writes, and normalizes the active session, templates, history, and preferences in `chrome.storage.local`.
- `src/background.js` (`FocusSessionManager`): the authoritative engine in the service worker. It owns the `focusSessionTimer` alarm, phase transitions, notifications, the alarm popup, and the session environment (blocker and ambient mix). It also hosts `BackgroundPomodoroManager` and `AmbientSoundManager`.
- `src/core/focusSessionClient.js` + `src/hooks/useFocusSession.js`: the popup's messaging client and its React state.
- `src/pages/` + `src/components/`: React 19 UI in the neo-brutalist "Carnival" style (`DESIGN.md`).

## State machine

Focus states: `idle`, `active_focus`, `paused_focus`, `focus_completed`, `active_break`, `paused_break`, `break_completed`, `abandoned`.

A session loops Work → Break → Work until the user ends it (see `docs/focus-session-loop.md`). The runtime session ID stays the same across cycles. Each work cycle gets an increasing cycle number and its own history record, so a completion is written to history exactly once per cycle.

## Features

| Feature | Where | Status |
|---|---|---|
| Domain model and state machine | `src/core/focusSession.js` | Done |
| Storage | `src/core/focusStorage.js` | Done |
| Background engine and timer | `FocusSessionManager` in `src/background.js` | Done |
| Ambient mix per session | `SessionAmbientMix.jsx`, `AmbientSoundManager` | Done |
| Session blocker, separate from the quick-tool blocker (ADR-001) | `SessionBlockerEditor.jsx`, `src/core/blocking.js` | Done |
| Tasks and session goal | `SessionGoalField.jsx`, `focusSessionClient.js` | Done |
| Pomodoro and Focus Session lock each other out | `src/background.js`, `QuickTools.jsx` | Done |
| Setup screen and saved templates | `FocusSessionSetup.jsx`, `SavedSessions.jsx` | Done |
| Active session screen | `ActiveFocusSession.jsx` | Done |
| Phase alarm popup | `AlarmPopup.jsx` | Done |
| Completion, break, and next cycle | `FocusSessionComplete.jsx` | Done |
| Recovery after popup close and service worker restart | `src/background.js`, `App.jsx` | Done |
| Stats page (7/30-day chart, completion rate, stop reasons, minutes per template, daily goal) | `FocusStats.jsx`, `src/core/focusStats.js` | Done |
| Floating widget on other screens | — | Not implemented |

## Storage keys

- `activeFocusSession`: runtime session object, or `null`.
- `focusSessionTemplates`: array of saved templates.
- `focusSessionHistory`: array of completed and abandoned work cycles (pruned to 90 days / 500 records).
- `focusSessionDailySummary`: `{ [YYYY-MM-DD]: { completedSessions, focusMinutes, abandonedSessions } }`. Records pruned from history are folded in here first, so totals survive pruning.
- `focusSessionPreferences`: user preferences object, including `dailyGoalMinutes` (15–600, default 100).
- `focusPendingAlarm`: the phase alarm that is waiting to be muted.

## Message protocol

The popup sends these through `chrome.runtime.sendMessage`. Every reply has the shape `{ success, error?, ... }`.

| Message | Payload |
|---|---|
| `FOCUS_GET_STATE` | none. Returns `{ activeSession, pendingAlarm, templates, history, dailySummary, preferences }` |
| `FOCUS_START_SESSION` | `{ config }` |
| `FOCUS_PAUSE_SESSION`, `FOCUS_RESUME_SESSION`, `FOCUS_SKIP_BREAK`, `FOCUS_START_NEXT_CYCLE` | `{ runtimeId? }` |
| `FOCUS_ABANDON_SESSION` | `{ runtimeId, reason }` |
| `FOCUS_START_BREAK` | `{ runtimeId, durationMinutes }` |
| `FOCUS_UPDATE_PREFERENCES` | `{ preferences }` |
| `FOCUS_SESSION_TEMPLATE_SAVE`, `FOCUS_SESSION_TEMPLATE_UPDATE` | `{ template }` |
| `FOCUS_SESSION_TEMPLATE_DUPLICATE`, `FOCUS_SESSION_TEMPLATE_DELETE` | `{ templateId }` |
| `FOCUS_STOP_ALARM` | none |

The background broadcasts `FOCUS_STATE_UPDATE` whenever the session changes.

## Tests

- `tests/focusSession.test.js`: state machine.
- `tests/focusStorage.test.js`: storage.
- `tests/focusEngine.test.js`: background engine, Pomodoro lock, message protocol.
- `tests/focusE2E.test.js`: end-to-end scenarios.
- `tests/focusStats.test.js`: stats aggregation and the daily summary.
- `tests/focusSessionClient.test.js`, `tests/focusSetupPersistence.test.js`, `tests/focusEnvironmentStatus.test.js`: popup-side helpers.
