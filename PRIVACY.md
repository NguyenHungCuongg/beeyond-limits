# Privacy Policy for Beeyond Limits

Last updated: July 30, 2026

Beeyond Limits is a local-first Chrome extension for focus sessions, task planning, website blocking, timers, and ambient audio. This policy explains what information the extension handles and how it is used.

## Information handled by the extension

Beeyond Limits may store the following information when a user chooses to provide or create it:

- Tasks, focus goals, and completion state.
- Focus-session templates, active-session state, and session history.
- Timer, notification, ambient-audio, and other extension preferences.
- Website domains that the user explicitly adds to a block list.

This information is stored locally in `chrome.storage.local` so that extension state can survive popup closure and browser restarts.

## Website blocking

Beeyond Limits uses Chrome's `declarativeNetRequest` API to redirect top-level navigation to domains that the user explicitly chose to block. The extension does not inject scripts into websites, read page content, inspect HTTP request or response bodies, or collect a general browsing history.

The `<all_urls>` host permission allows the user-facing blocker to work with any HTTP or HTTPS domain selected by the user. While a blocklist editor is open, the extension also reads the active tab's address to offer a "Block this tab" shortcut; that domain is saved only if the user clicks it. It is not used for advertising, analytics, page-content collection, or tracking.

## Data transmission and sharing

The current version of Beeyond Limits:

- Does not require an account.
- Does not operate a backend service.
- Does not transmit extension data to the developer or third parties.
- Does not include analytics, advertising, tracking, or affiliate code.
- Does not sell or share user data.

Fonts, quotes, icons, and audio used by the extension are packaged with the extension and do not require remote asset requests.

## Data retention and deletion

Information remains in the extension's local storage until it is changed or deleted through extension functionality, cleared through Chrome, or the extension is uninstalled. Users can remove individual tasks, saved sessions, and blocked domains from the extension interface where those controls are available.

## Permissions

The extension uses Chrome permissions only to provide its disclosed focus and productivity features. A detailed permission rationale is available in [`docs/CHROME_WEB_STORE.md`](docs/CHROME_WEB_STORE.md).

## Limited Use

The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Information handled by the extension is used only to provide or improve its user-facing functionality.

## Changes to this policy

If a future version changes how information is handled, this policy and the Chrome Web Store privacy disclosures will be updated before that version is published. Material changes will be disclosed to users when required.

## Contact

Privacy questions can be submitted through the project's GitHub issue tracker:

https://github.com/NguyenHungCuongg/Beeyond-Limits/issues
