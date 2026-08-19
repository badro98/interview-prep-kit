---
name: advisor-prep-doc-updates
description: >-
  Regenerates or updates interview prep docs through the in-app Advisor via
  update_prep_doc proposals (never dump the full doc in chat). Use when changing
  advisor kit actions, systemPrompt KIT ACTIONS, or when the user asks why
  Advisor printed a prep doc instead of offering Update prep doc.
---

# Advisor prep-doc updates

Prep Docs are kit state. The Advisor must **propose** a write, not paste the document into chat.

## When the user asks to regenerate / rewrite / update a prep doc

1. Emit **two fences** in the same reply:
   - Tiny `advisor-actions` JSON (metadata only — never put the document inside JSON).
   - A following `prep-doc` fence with the complete markdown.
2. Keep the chat reply short (what changed + Confirm). Do not recap the doc.
3. Use `mode: "replace"` for regenerate/rewrite/"based on new context".
4. Use `mode: "append"` only to add a section without replacing the rest.
5. Resolve the stage with `stageId` from the interview stages list (title match is ok).

```advisor-actions
{"proposals":[{"type":"update_prep_doc","stageId":"recruiter","mode":"replace"}]}
```

```prep-doc
# Recruiter Screen

...complete markdown...
```

Do not put the full document in JSON — unescaped quotes/newlines silently break parse, and the UI used to strip the fence anyway (chat showed only the intro). Parser now attaches the `prep-doc` fence and leaves a broken `advisor-actions` block visible if parse fails.

Parse/execute live in `src/features/advisor/actions.js`. Prompt copy lives in `src/features/advisor/systemPrompt.js` (`KIT_ACTIONS`), not `interview.config.js`. Confirm UI is `ActionProposals.jsx` (card preview is truncated; **Review** opens a scrollable overlay of the full markdown before accept). Applying remounts Prep Docs via `onStagesChange`.

Do not use `add_stage` for an existing stage. Do not tell the user the doc was already saved. Do not ask "should I propose this?" — emit the fences in the same reply.
