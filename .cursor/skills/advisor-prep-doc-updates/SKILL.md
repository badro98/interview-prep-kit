---
name: advisor-prep-doc-updates
description: >-
  Regenerates or updates interview prep docs through the in-app Advisor via
  update_prep_doc / add_stage proposals (never dump the full doc in chat). Use
  when changing advisor kit actions, systemPrompt KIT ACTIONS, or when a
  prep-doc proposal fails to parse (orange “could not be read” warning).
---

# Advisor prep-doc updates

Prep Docs are kit state. The Advisor must **propose** a write, not paste the document into chat.

## When the user asks to spin up / regenerate / rewrite a prep doc

1. Emit **tiny JSON** (metadata only — never put the document inside JSON).
2. Emit each document in a `<prep-doc>` tag (not a markdown ` ```prep-doc ` fence). Code samples inside the tag are fine; triple-backtick fences used to close early and leave a broken code block in chat.
3. Keep the chat reply short (what changed + Confirm). Do not recap the doc.
4. **New rounds** (coding, system design, …) → `add_stage`.
5. **Existing stages** → `update_prep_doc` (`replace` by default; `append` only to add a section).

```advisor-actions
{"proposals":[{"type":"add_stage","id":"coding","title":"Practical coding"}]}
```

<prep-doc stageId="coding" title="Practical coding">
# Practical coding

...complete markdown...
</prep-doc>

Parser lives in `src/features/advisor/actions.js`: attaches tagged bodies to JSON proposals, salvages `<prep-doc>` tags if JSON is invalid, and promotes unknown `update_prep_doc` stage ids to `add_stage`. Confirm UI is `ActionProposals.jsx` (**Review** for the full draft). Applying remounts Prep Docs via `onStagesChange`.

Assigning existing flashcards to a stage is `update_flashcards` (tiny JSON, no doc tags). A leftover ```json dump in chat usually means the model used an unknown type or a plain json fence — both are now parsed when `"proposals"` is present.

Audit / "suggest stage assignment" is a kit change, not a talk-through: emit `update_flashcards` in the **same reply**. Confirm/Dismiss is the ask — do not wait for "make the assignment".

Do not tell the user the doc was already saved. Do not ask "should I propose this?" — emit the blocks in the same reply.
