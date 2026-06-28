// Demo config — The Office characters (fictional interview loop for screenshots).
// Install with: npm run demo:setup

export const APP = {
  title: "Interview Prep — Sabre",
  subtitle: "Staff SWE loop · Ryan Howard",
  role: "Staff Software Engineer",
  company: "Sabre",
  candidateName: "Ryan Howard",
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
  "portfolio.md": "Portfolio & side projects",
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
    subtitle: "30-min intro · Pam Beesly",
    file: "prep-recruiter.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 1 — recruiter screen with Pam Beesly.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "hm",
    title: "Hiring Manager",
    subtitle: "45-min behavioral · Jim Halpert",
    file: "prep-hm.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 2 — hiring manager interview with Jim Halpert.\n\n${SECTIONS_SPEC}`,
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
    subtitle: "Dwight · Oscar · Angela",
    file: "prep-onsite.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 4 — onsite loop.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "final",
    title: "Final Round",
    subtitle: "Michael Scott · VP Engineering",
    file: "prep-final.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 5 — final with Michael Scott, VP Engineering.\n\n${SECTIONS_SPEC}`,
  },
];

export const TRANSCRIBE_STAGES = STAGES.map(({ id, title, subtitle }) => ({
  id,
  title,
  subtitle,
}));

export const TRANSCRIBE_STAGE_INSTRUCTIONS = {
  recruiter: `Recruiter screen with Pam Beesly — role fit, motivation, comp band, timeline.`,
  hm: `Hiring manager with Jim Halpert — team fit, staff scope, behavioral depth, pranks optional.`,
  takehome: `Take-home debrief — printer cloud sync system design, tradeoffs, clarity.`,
  onsite: `Onsite — Dwight (architecture), Oscar (technical), Angela (cross-functional).`,
  final: `Final with Michael Scott, VP Engineering — staff scope, leadership, why Sabre, first 90 days.`,
};

export const ADVISOR_STARTERS = [
  "How prepared am I for Dwight's architecture round?",
  "What should I ask Jim about on-call expectations?",
  "Help me tighten my 'tell me about yourself' for Sabre.",
  "Which flashcards am I weakest on?",
  "Draft 3 questions for Michael Scott's final round.",
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
