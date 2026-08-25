---
name: advisor-prep-doc-subpages
description: >-
  Adds nested pages under an existing interview stage through Advisor
  add_subpage proposals (never a new stage, never replace the main prep doc).
  Use when the user asks for subpages, extra pages, per-interviewer docs,
  question-set pages, or a call debrief under a stage, or when an Advisor
  subpage proposal fails to parse (orange “could not be read”).
---

# Advisor prep-doc subpages

Subpages live **under a stage** on Prep Docs (⋯ → Add subpage). They are not a new interview round and not a rewrite of the stage’s main doc.

## When the user asks to split a stage / add pages

1. Emit **tiny JSON** — `type`, `stageId`, `title` only. Never put the page body inside JSON.
2. Emit each page in a `<prep-doc stageId="..." title="...">` tag (same tag as main prep docs). Match `title` so multiple pages on one stage attach correctly.
3. Keep chat short (what the pages are + Confirm). Do not recap the bodies.

```advisor-actions
{"proposals":[
  {"type":"add_subpage","stageId":"onsite","title":"Jane — system design"},
  {"type":"add_subpage","stageId":"onsite","title":"Alex — behavioral"}
]}
```

<prep-doc stageId="onsite" title="Jane — system design">
# Jane — system design

...page markdown...
</prep-doc>

<prep-doc stageId="onsite" title="Alex — behavioral">
# Alex — behavioral

...page markdown...
</prep-doc>

## Do not

- `add_stage` — that creates a **new round** on the pipeline.
- `update_prep_doc` — that **replaces or appends** the stage’s main prep doc.
- Dump the pages into chat. Confirm cards come from the JSON + tags.

Parser: `src/features/advisor/actions.js` (`add_subpage` / `add_page`). Execute writes `addStagePage(stageId, { title, html })`. Confirm UI is `ActionProposals.jsx`. After **Add subpage**, that button goes away; **Review** stays for the recap. Applying remounts Prep Docs via `onStagesChange` (`kind: "subpage"`).

Unknown types or markdown stuffed into JSON → orange “could not be read”. Salvage needs a complete `<prep-doc>` tag per page.

The stage id must already exist (`onsite`, `hm`, …). For a brand-new round, use `add_stage` instead (see advisor-prep-doc-updates).
