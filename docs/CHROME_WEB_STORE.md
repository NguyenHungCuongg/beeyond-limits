# Chrome Web Store Submission Notes

This document contains reviewer-facing explanations for the current Beeyond Limits package. Keep it synchronized with `manifest.json`, extension behavior, and the Chrome Web Store privacy fields.

## Single purpose

Beeyond Limits helps users maintain focused work sessions by combining a timer, task planning, user-configured distraction blocking, session tracking, and ambient audio in one local-first workflow.

All features support that focus-workflow purpose. The extension does not inject content into arbitrary pages, replace search, display advertising, or collect browsing data for unrelated purposes.

## Permission justifications

### `storage`

Stores tasks, timer state, user-created session templates, active-session recovery data, session history, blocked-domain lists, ambient-audio settings, and preferences locally. This allows a running timer and configured workflow to survive popup closure and browser restart.

### `alarms`

Schedules Pomodoro and Focus Session phase completion in the background. The popup is not persistent, so a Chrome alarm is needed to complete a user-started timer reliably after the popup closes.

### `declarativeNetRequest`

Creates and removes dynamic rules for domains the user explicitly adds to the standalone blocker or the blocker attached to a Focus Session. Rules only target `main_frame` navigation and redirect matching domains to the packaged `blocked.html` page. The API is used instead of intercepting request content.

### `notifications`

Shows timer-completion notifications for user-started Pomodoro phases, and for Focus Session phases when the alarm popup cannot open (for example, when no Chrome window is focused). The Focus Session notification has a single "Mute alarm" button. Notifications are not used for advertising, donation requests, or unsolicited promotion.

### `offscreen`

Creates a packaged offscreen document for ambient audio and timer-alarm playback. Manifest V3 service workers do not provide a persistent DOM media context, so the offscreen document is required to play user-selected audio while the popup is closed.

### `<all_urls>` host access

The blocker accepts any HTTP or HTTPS domain chosen by the user. Broad host access is required so dynamic `declarativeNetRequest` redirect rules can operate on those user-selected domains, including while the extension popup is closed.

The permission is used for top-level blocking redirects and, while a blocklist editor is open, to read the active tab's URL so the editor can offer a one-click "Block this tab" suggestion. That domain is stored only if the user clicks the suggestion. Beeyond Limits does not register content scripts, inject code into pages, read page content, access cookies, inspect request or response bodies, or collect a general browsing history. Only the user-created blocked-domain list is stored, and it remains in `chrome.storage.local`.

### Web-accessible `blocked.html`

Only `blocked.html` is exposed to HTTP and HTTPS pages because Chrome must be able to redirect a blocked top-level navigation to this packaged page. No scripts, storage files, audio files, or internal application bundles are exposed through `web_accessible_resources`.

## Remote code declaration

Select: **No, this extension does not use remote code.**

All executable JavaScript, CSS, fonts, quotes, icons, and audio are packaged with the extension. The build does not use remote scripts, `eval`, or downloaded executable logic.

## Data-use summary

The extension handles user-created tasks, goals, session state/history, preferences, and blocked domains locally. It does not transmit this information to the developer or third parties and does not use it for advertising, analytics, credit decisions, or sale. See `PRIVACY.md` for the full disclosure.

## Reviewer test instructions

1. Open the extension popup and create a task.
2. Start, pause, resume, and reset the Pomodoro timer.
3. Add a domain in Website Blocker, enable blocking, and navigate to that domain; Chrome should redirect the top-level page to `blocked.html`.
4. Disable blocking and confirm the site is reachable again.
5. Configure a Focus Session with a timer, optional task, ambient sound, and blocked domain.
6. Start the session, close and reopen the popup, and confirm state recovery.
7. Test ambient audio and the timer-completion alarm, including mute/stop controls.
8. While a Focus Session is running, open a blocked domain: the blocked page shows the domain, the session goal, and the minutes left. The toolbar badge shows the minutes left.
9. Press Alt+Shift+P to pause and resume the Focus Session.
10. In a blocklist editor, click "+ Block this tab" or a preset such as "+ Social" to add domains.
11. On Home, click the "Today / Min" counter to open Stats (7/30-day chart, completion rate, daily goal).

No account, credentials, payment, or external service is required for review.
