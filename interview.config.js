// Interview-specific customization — edit this file after cloning the template.
// See README.md and PROMPT.md for the full setup workflow.

export const APP = {
  title: "Interview Prep",
  subtitle: "Local-first study tool",
  role: "Software Engineer",
  company: "Acme Corp",
  candidateName: "Your Name",
};

/** Optional demo flag — demo/interview.config.js sets localStateVersion to clear stale custom context. */
export const DEMO = null;

// Optional starter files in context/ — see context/README.md.
// Users can delete, rename, or add files; labels are display names only.
export const CONTEXT_ORDER = [
  "resume.md",
  "job-description.md",
  "portfolio.md",
  "recruiter-call.md",
  "intel.md",
  "experiences.md",
];

export const CONTEXT_LABELS = {
  "resume.md": "Resume / background",
  "job-description.md": "Job description",
  "portfolio.md": "Portfolio & projects",
  "recruiter-call.md": "Recruiter & pipeline notes",
  "intel.md": "Role & company intel",
  "experiences.md": "Stories & metrics",
};

export const CONTEXT_SKIP = new Set(["README.md"]);

const SECTIONS_SPEC = `Structure the doc with these sections:
1. **What they're assessing** for this stage
2. **Likely questions**
3. **Your strongest stories mapped to each** (cite real metrics from the background)
4. **Talking points**
5. **Pitfalls to avoid**
Use Markdown. Be specific to the candidate's real experience — reference concrete numbers
and stories from the context files. No generic advice.`;

export const STAGES = [
  {
    id: "recruiter",
    title: "Recruiter Screen",
    subtitle: "30-min intro · role fit · logistics",
    file: "prep-recruiter.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 1 — the recruiter screen. Cover what they're assessing (role fit, motivation, salary/timeline logistics), likely questions, the candidate's strongest stories mapped to each, talking points, and pitfalls. Emphasize a crisp "walk me through your background" answer and why this role/company.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "hm",
    title: "Hiring Manager",
    subtitle: "45-min behavioral · team fit · scope",
    file: "prep-hm.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 2 — the hiring manager interview. Cover what they're assessing (team fit, ownership, role scope, how you work with stakeholders), likely behavioral questions, the candidate's strongest stories mapped to each, talking points, and pitfalls. This is often the first deep dive with the person you'd report to.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "takehome",
    title: "Take-home",
    subtitle: "Practical exercise · timed window",
    file: "prep-takehome.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 3 — the take-home or practical exercise. Cover what they're assessing, how to structure the work under time pressure, likely evaluation criteria, the candidate's relevant experience to highlight, and pitfalls (over-engineering, skipping communication).\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "onsite",
    title: "Onsite",
    subtitle: "Behavioral + technical · multiple interviewers",
    file: "prep-onsite.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 4 — the onsite loop. Cover behavioral rounds (collaboration, conflict, ownership), technical or case rounds if applicable, stories mapped to likely questions, and pitfalls (rambling, not asking clarifying questions).\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "final",
    title: "Final Round",
    subtitle: "Values · leadership · mutual fit",
    file: "prep-final.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 5 — the final round. Cover values/fit, why this role/company, first-90-days narrative, questions the candidate should ask, and pitfalls. The technical bar is largely cleared by now — focus on leadership readiness and mutual fit.\n\n${SECTIONS_SPEC}`,
  },
];

export const TRANSCRIBE_STAGES = STAGES.map(({ id, title, subtitle }) => ({
  id,
  title,
  subtitle,
}));

export const TRANSCRIBE_STAGE_INSTRUCTIONS = {
  recruiter: `This was the recruiter screen. Focus on role-fit questions, motivation, logistics, and any pipeline intel shared.`,
  hm: `This was the hiring manager interview. Focus on behavioral questions, team fit, role scope, ownership stories, and how the candidate asks about the team and priorities.`,
  takehome: `This was a take-home debrief or walkthrough. Focus on approach, time management, communication, and feedback on the deliverable.`,
  onsite: `This was the onsite loop. Separate behavioral vs technical threads if both appear. Note follow-up questions and collaboration signals.`,
  final: `This was the final round — values, fit, leadership readiness. Focus on why this role/company, first-90-days, and mutual fit.`,
};

export const ADVISOR_STARTERS = [
  "How prepared am I overall for this interview loop?",
  "What behavioral questions is my hiring manager most likely to ask?",
  "What questions should I ask my hiring manager about team scope?",
  "What questions should I ask in my recruiter screen?",
  "Help me brainstorm questions to ask in the final round.",
  "I have new intel from the recruiter — I'll paste it below.",
  "Create flashcards from a link or doc I'll paste — ask before adding them.",
];

export function buildAdvisorSystem() {
  const { candidateName, role, company } = APP;
  const stageList = STAGES.map(
    (s, i) => `${i + 1}. ${s.title} — ${s.subtitle}`
  ).join("\n");

  return `You are ${candidateName}'s interview prep advisor for the ${role} role at ${company}.

Your job:
- Help assess overall preparedness across all interview stages.
- Suggest likely questions interviewers may ask, grounded in the candidate's real background — not generic lists.
- Help brainstorm strong questions the candidate should ask at each stage.
- Incorporate updates they share from recruiter calls, new intel, or corrections to their story.
- Use their FLASHCARD DECK (provided below) to avoid duplicate questions, spot gaps, and propose new cards that fill weak areas.
- When they share a document, pasted text, or fetched webpage content, you may propose new flashcards and/or saving that material to context — but NEVER apply changes yourself; propose them for them to confirm in the UI.

When you want to propose adding flashcards and/or saving context, end your message with a fenced JSON block (after your normal prose). The app renders Confirm buttons from this block — do not say you already added anything.

\`\`\`advisor-actions
{
  "proposals": [
    {
      "type": "add_flashcards",
      "label": "Add 5 questions from the company blog post",
      "cards": [
        {
          "category": "behavioral|situational|role-specific",
          "question": "...",
          "referenceAnswer": "optional gold-standard answer in their voice",
          "keyPoints": ["optional", "bullet", "points"]
        }
      ]
    },
    {
      "type": "add_context",
      "label": "Save company pricing page to context",
      "name": "Short title for the context panel",
      "content": "Markdown summary or full pasted content to store",
      "sourceUrl": "https://optional-source-url"
    }
  ]
}
\`\`\`

Rules for proposals:
- Ask in your prose whether they want these changes — the UI will show Add / Dismiss buttons.
- Only include proposals when you have concrete content ready (questions drafted, context text written).
- For add_flashcards: avoid duplicating questions already in their deck; include referenceAnswer + keyPoints when you can ground them in their background.
- For add_context: use a clear name; content should be useful markdown (summary + key quotes/facts, or full pasted doc).
- Omit the advisor-actions block entirely when not proposing changes.
- You may include zero, one, or both proposal types in the same block.

Interview stages (for reference):
${stageList}

Tone: supportive but honest. Flag gaps without being discouraging.`;
}

export function buildSpeakerMappingPrompt() {
  const { candidateName, role, company } = APP;
  return `The candidate is ${candidateName} (interviewing for ${role} at ${company}).`;
}
