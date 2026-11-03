# Spec: Session-scoped Website Blocker

Status: **Approved — 2026-07-28**  
Supersedes the shared-blocklist assumption in [`focus-session-ux-spec.md`](focus-session-ux-spec.md) and is governed by [ADR-001](../decisions/ADR-001-session-scoped-blocklists.md).

## Objective

Allow a Focus Session to block exactly the sites relevant to that session,
without altering the persistent Website Blocker managed through Quick Tools.

## Product model

| Surface                      | Owns                                        | Applies when                            |
| ---------------------------- | ------------------------------------------- | --------------------------------------- |
| Quick Tool Website Blocker   | Manual `blockedUrls` and `isBlocking`       | No Focus Session owns blocking          |
| Focus Session Setup/template | Session `blocker.blockedUrls`               | The user starts that session            |
| Active Focus Session runtime | Immutable snapshot of the session blocklist | From session start until Finish/abandon |

There is one Chrome DNR rule engine. During an active Focus Session, the
session owns the effective rules. Quick Tool edits made during the session are
saved but not applied; the stored Quick Tool state is applied on Finish, Skip
Break or Stop Early.

## UX requirements

### Focus Session Setup

- `Website Blocker` has an independent on/off toggle.
- The blocklist shown and edited belongs only to the pending session config.
- `Edit sites` opens a session-scoped editor in the Focus Session flow.
- The editor supports add, remove and clear; it never opens or mutates Quick
  Tool manual settings.
- The UI displays a real count and clearly warns when a blocker is enabled
  with no sites.
- Saving a template saves its blocklist. Starting a template pre-fills it.

### Quick Tool Website Blocker

- Continues to manage manual blocker configuration outside Focus Sessions.
- While a Focus Session is active, it shows a non-dismissible ownership banner:
  `Focus Session is controlling website blocking`.
- Manual controls describe that changes apply after the active session; they do
  not claim the manual state is the current effective blocker state.

### Active Session lifecycle

- Start snapshots session domains.
- Pause leaves the session blocker active.
- Start Break disables all blocking, including after a browser restart mid-break.
- Finish, Skip Break and Stop Early apply the stored manual state, including
  Quick Tool edits saved during the session.
- Editing a template or pending setup cannot mutate an active runtime snapshot.

## Data model

```js
// Existing Quick Tool data — preserved as manual configuration.
{ blockedUrls: ["facebook.com"], isBlocking: true }

// Template and active-session snapshot.
{
  blocker: {
    enabled: true,
    blockedUrls: ["youtube.com", "reddit.com"],
  },
}
```

## Migration

- Preserve existing `blockedUrls` and `isBlocking` unchanged.
- Seed a new session configuration from the current manual list only once when
  no session-specific configuration exists.
- Do not keep the two lists synchronized after seeding.

## Acceptance criteria

- A user can block YouTube in one saved session and allow it in another.
- Editing session sites never changes Quick Tool `blockedUrls` or `isBlocking`.
- During a session, Quick Tool does not present its manual toggle as the active
  blocker status.
- The stored manual blocker state is applied after any terminal session path.
- Browser tests cover start, pause, break, finish, abandon and popup reopen.

## Not doing

- Reusable named blocklist profiles: defer until templates prove insufficient.
- Two separate DNR engines or overlapping rule ownership.
- A session-level override that silently unblocks a site from an active manual
  blocker; session ownership is explicit and temporary instead.
