# Interview Prep Kit — notes

## Current Status

Main has Advisor Confirm-card recap for every kit action and nested prep-doc subpages. #29 (inline flashcard Review, per-card Approve/Skip) and #30 (stay-as-recap after apply, `add_subpage`, shared-context rewrite guard, prep-doc Review rendering) are merged. Local leftovers `context/README.md` and `interview.config.js` are still dirty and must not be committed (public-repo guardrail).

## Known Bugs

_(none open from the 2026-08-25 Advisor Confirm session)_

## In Progress

_(nothing — pick from Up Next)_

## Up Next

- ~~Advisor flashcard proposals stay inline until Review; approve/skip per card~~ — 2026-08-25 (#29)
- ~~Confirm recap after apply for all kit actions; `add_subpage`; block shared-context rewrites~~ — 2026-08-25 (#30)
- Retry in the real Advisor thread: “create a subpage in the onsite prep docs for each set of questions” — Confirm cards should parse (no orange “could not be read”)
- Optionally sync `interview.config.js` proposal examples with in-app `systemPrompt.js` KIT_ACTIONS (left unstaged on purpose)

## GitHub Issues

- #13 [open] [QA] Coverage gaps and proposals — PR #12
- #11 [open] [QA] Coverage gaps and proposals — PR #6
- #10 [open] [QA] Coverage gaps and proposals — PR #5
- #9 [open] [QA] Coverage gaps and proposals — PR #4
- #8 [open] [QA] Coverage gaps and proposals — PR #3
- #7 [open] [QA] Coverage gaps and proposals — PR #2

## Session Log

- 2026-08-25 — Shipped Advisor flashcard inline Review (#29) and Confirm recap + prep-doc subpages (#30). After apply, every kit Confirm keeps Review and drops the write button. Shared context can no longer be rewritten via `update_prep_doc`. Nested onsite pages use `add_subpage`.
