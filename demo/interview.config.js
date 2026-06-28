// Demo config — fictional candidate for README screenshots.
// Install with: npm run demo:setup

export const APP = {
  title: "Interview Prep — Northwind",
  subtitle: "Staff SWE loop · Jordan Lee",
  role: "Staff Software Engineer",
  company: "Northwind Analytics",
  candidateName: "Jordan Lee",
};

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
    subtitle: "30-min intro · Maya Chen",
    file: "prep-recruiter.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 1 — recruiter screen with Maya Chen.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "hm",
    title: "Hiring Manager",
    subtitle: "45-min behavioral · Sam Rivera",
    file: "prep-hm.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 2 — hiring manager interview with Sam Rivera (Director, Data Platform).\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "takehome",
    title: "Take-home",
    subtitle: "System design doc · 48-hr window",
    file: "prep-takehome.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 3 — system design take-home.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "onsite",
    title: "Onsite",
    subtitle: "Architecture + cross-func · 3 interviews",
    file: "prep-onsite.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 4 — onsite loop.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "final",
    title: "Final Round",
    subtitle: "VP Engineering · values & scope",
    file: "prep-final.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 5 — final with VP Eng.\n\n${SECTIONS_SPEC}`,
  },
];

export const TRANSCRIBE_STAGES = STAGES.map(({ id, title, subtitle }) => ({
  id,
  title,
  subtitle,
}));

export const TRANSCRIBE_STAGE_INSTRUCTIONS = {
  recruiter: `Recruiter screen with Maya Chen — role fit, motivation, comp band, timeline.`,
  hm: `Hiring manager with Sam Rivera — team fit, staff scope, platform guild, behavioral depth.`,
  takehome: `Take-home debrief — system design doc for real-time pipeline, tradeoffs, clarity.`,
  onsite: `Onsite — architecture deep-dive, cross-functional, coding.`,
  final: `Final with VP Eng — staff scope, leadership, why Northwind, first 90 days.`,
};

export const ADVISOR_STARTERS = [
  "How prepared am I for the onsite architecture round?",
  "What should I ask the hiring manager about on-call expectations?",
  "Help me tighten my 'tell me about yourself' for Northwind.",
  "Which flashcards am I weakest on?",
  "Draft 3 questions for the VP final round.",
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
- Use their FLASHCARD DECK to avoid duplicate questions and spot gaps.

Interview stages (for reference):
${stageList}

Tone: supportive but honest. Flag gaps without being discouraging.`;
}

export function buildSpeakerMappingPrompt() {
  const { candidateName, role, company } = APP;
  return `The candidate is ${candidateName} (interviewing for ${role} at ${company}).`;
}
