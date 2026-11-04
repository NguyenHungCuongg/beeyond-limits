# ADR-001: Use session-scoped blocklists with a shared blocking engine

## Status

Accepted

## Date

2026-07-28

## Context

Beeyond Limits has a persistent Website Blocker in Quick Tools and a Focus
Session blocker. A shared `blockedUrls` list made the two experiences appear
to control the same feature while showing different status. It also prevented
users from allowing a site such as YouTube in one session and blocking it in
another.

## Decision

Quick Tool Blocker and Focus Session Blocker will have separate configurations
and separate user-facing ownership, while continuing to use one Chrome
Declarative Net Request blocking engine.

- Quick Tool keeps its manual `blockedUrls` and `isBlocking` configuration.
- A Focus Session template and runtime snapshot own their own `blockedUrls`.
- While a Focus Session is active, it owns the effective blocking rules.
- Quick Tool edits made during a session are saved but not applied. The stored
  Quick Tool state is applied when the session finishes or is abandoned.
- The Quick Tool page must state that a running Focus Session controls
  blocking, rather than presenting the manual toggle as the active status.

## Alternatives considered

### Keep one shared blocklist

Rejected because it cannot support different blocked sites per session and
creates misleading ownership in the UI.

### Build two independent blocking engines

Rejected because competing rule sets need precedence and conflict handling.
Duplicating a browser-level blocker adds complexity without creating user value.

## Consequences

- Existing Quick Tool data remains intact and is never mutated by editing a
  session blocklist.
- Focus Session setup needs a session-scoped site editor and saved templates
  persist their own blocklist.
- Runtime orchestration must snapshot session domains and restore the manual
  state deterministically.
- Reusable blocklist profiles are intentionally deferred; templates provide
  the first level of reuse.
