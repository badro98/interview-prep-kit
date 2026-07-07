# Customization prompt (power-user / seed-job path)

Most people should just use the in-app onboarding wizard — open the app and step through name → profile → job → stages → generate, no file editing required. This prompt is for the **seed job** baked into `interview.config.js` and `generated/` (the one loaded by **Use the repo's sample setup**): use it if you want an AI coding assistant to regenerate that job's prep docs and flashcards ahead of time.

Copy the prompt below into **Cursor**, **Claude Code**, **Codex**, or any AI coding assistant after you've added your context (Context tab uploads, `context/` files, or both).

---

```
You are helping me customize the interview-prep-kit template for my upcoming interview.

Read README.md, context/README.md, and interview.config.js first. Then:

1. Read my active context — files in /context/ plus any notes I've added in the app.
2. Update interview.config.js with my role, company, candidate name, interview stages
   (names, subtitles, regeneration prompts grounded in my pipeline).
3. Regenerate /generated/prep-*.md — one focused prep doc per stage using my context.
4. Regenerate /generated/flashcards.json — 20–25 role-specific questions with
   referenceAnswer + keyPoints grounded in my background.
5. Update advisor starter questions in interview.config.js to match my interviewers/stages.

Rules:
- Every output must cite MY metrics and stories from context, not generic advice.
- Do not add or commit API keys.
- Keep coach() and API mode as the default path.
- Keep the app runnable with npm run dev after changes.
```

---

## Optional follow-up prompts

**After a recruiter call:**
```
I have new intel from my recruiter call — I'll paste the notes below. Add or update context (new markdown file or custom entry content), and suggest updates to the affected prep docs in generated/.
```

**Regenerate one stage only:**
```
Regenerate generated/prep-onsite.md only, using my full context and the stage definition in interview.config.js. Be specific to my metrics and stories.
```

**Expand flashcards:**
```
Add 10 more flashcards to generated/flashcards.json for [behavioral / technical / role-specific] questions. Ground referenceAnswer and keyPoints in my context. Don't duplicate existing questions.
```
