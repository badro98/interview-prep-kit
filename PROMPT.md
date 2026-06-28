# Customization prompt

Copy this into **Cursor**, **Claude Code**, **Codex**, or any AI coding assistant after you've filled in your `context/` files.

---

```
You are helping me customize the interview-prep-kit template for my upcoming interview.

Read README.md and interview.config.js first. Then:

1. Read all files in /context/ — I have filled in my materials.
2. Update interview.config.js with my role, company, candidate name, interview stages
   (names, subtitles, regeneration prompts grounded in my pipeline).
3. Regenerate /generated/prep-*.md — one focused prep doc per stage using my context.
4. Regenerate /generated/flashcards.json — 20–25 role-specific questions with
   referenceAnswer + keyPoints grounded in my background.
5. Update advisor starter questions in interview.config.js to match my interviewers/stages.

Rules:
- Every output must cite MY metrics and stories from context/, not generic advice.
- Do not add or commit API keys.
- Do not remove paste mode or the coach() abstraction.
- Keep the app runnable with npm run dev after changes.
```

---

## Optional follow-up prompts

**After a recruiter call:**
```
I have new intel from my recruiter call — I'll paste the notes below. Update context/recruiter-call.md, add anything relevant to context/intel.md, and suggest updates to the affected prep docs in generated/.
```

**Regenerate one stage only:**
```
Regenerate generated/prep-onsite.md only, using my full context/ and the stage definition in interview.config.js. Be specific to my metrics and stories.
```

**Expand flashcards:**
```
Add 10 more flashcards to generated/flashcards.json for [behavioral / technical / role-specific] questions. Ground referenceAnswer and keyPoints in my context/. Don't duplicate existing questions.
```
