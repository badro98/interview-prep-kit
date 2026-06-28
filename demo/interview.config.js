// Demo config — early-stage prep: Osama Badr, Product Quality Analyst @ Northwind Software.
// Only recruiter-call notes are filled in; other context is still placeholder.
// Interviewer names are The Office characters. Install with: npm run demo:setup

export const APP = {
  title: "Interview Prep — Product Quality Analyst",
  subtitle: "Product Quality Analyst · Osama Badr",
  role: "Product Quality Analyst",
  company: "Northwind Software",
  candidateName: "Osama Badr",
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
    subtitle: "30-min intro · Pam Beesly",
    file: "prep-recruiter.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 1 — recruiter screen with Pam Beesly.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "hm",
    title: "Hiring Manager",
    subtitle: "45-min behavioral · Jim Halpert",
    file: "prep-hm.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 2 — 45-minute behavioral with Jim Halpert, hiring manager for the Product Quality Analyst team.\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "takehome",
    title: "Take-home",
    subtitle: "Async case study · TBD after HM",
    file: "prep-takehome.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 3 — async take-home exercise (format TBD after hiring manager round).\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "onsite",
    title: "Onsite",
    subtitle: "Virtual panel · Dwight Schrute · Oscar Martinez",
    file: "prep-onsite.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 4 — virtual onsite (Dwight Schrute: team/culture; Oscar Martinez: work sample review).\n\n${SECTIONS_SPEC}`,
  },
  {
    id: "final",
    title: "Final Round",
    subtitle: "Michael Scott · Head of User Operations",
    file: "prep-final.md",
    regenTask: `Produce a focused interview-prep doc for STAGE 5 — final with Michael Scott, head of User Operations.\n\n${SECTIONS_SPEC}`,
  },
];

export const TRANSCRIBE_STAGES = STAGES.map(({ id, title, subtitle }) => ({
  id,
  title,
  subtitle,
}));

export const TRANSCRIBE_STAGE_INSTRUCTIONS = {
  recruiter: `Recruiter screen with Pam Beesly — role fit, motivation, pipeline intel.`,
  hm: `Hiring manager with Jim Halpert — behavioral round, STAR stories, role fit.`,
  takehome: `Take-home debrief — async case study (format TBD).`,
  onsite: `Virtual onsite — Dwight Schrute (team/culture) + Oscar Martinez (work sample review).`,
  final: `Final with Michael Scott, head of user ops — values/fit, why Northwind, first 90 days.`,
};

export const ADVISOR_STARTERS = [
  "What context should I upload next to improve my prep docs?",
  "How prepared am I for the Jim Halpert behavioral round?",
  "What questions should I ask Pam in my recruiter follow-up?",
  "Help me tighten my 90-second intro before the Jim Halpert round.",
  "I have new intel from the recruiter — I'll paste it below.",
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
