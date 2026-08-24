export const TEXT_DELAY_MS = 800;
export const ROTATE_MS = 2800;
export const LONG_ANSWER_CHARS = 280;

export const STAGES = {
  NEUTRAL: "neutral",
  ANALYZING: "analyzing",
  GENERATING: "generating",
  PARSING: "parsing",
  SCORING: "scoring",
};

export const THINKING_BUCKETS = {
  [STAGES.NEUTRAL]: [
    "Thinking it through",
    "Working on it",
    "Putting this together",
    "Reading closely",
  ],
  [STAGES.ANALYZING]: [
    "Reading your answer",
    "Checking the structure",
    "Looking for specifics",
    "Weighing what landed",
    "Finding the gaps",
  ],
  [STAGES.GENERATING]: [
    "Pulling from the job description",
    "Picking the hard ones",
    "Lining up a follow-up",
    "Drafting the next question",
  ],
  [STAGES.PARSING]: [
    "Scanning the role",
    "Matching your experience",
    "Pulling out the signals",
  ],
  [STAGES.SCORING]: [
    "Comparing against strong answers",
    "Writing the feedback",
    "Putting numbers to it",
  ],
};

/** Interviewer-role jokes only. At most one is mixed into analyzing / generating. */
export const PLAYFUL_LINES = [
  "Putting on the interviewer hat",
  "Channeling the hiring manager",
  "Thinking like a skeptical panel",
];

const URL_RE = /https?:\/\/\S+/i;

export function stageFromUserText(text) {
  const raw = String(text || "");
  const t = raw.toLowerCase();

  if (
    /\bgenerate questions\b/.test(t) ||
    /\bquiz me\b/.test(t) ||
    /\bflashcards from\b/.test(t)
  ) {
    return STAGES.GENERATING;
  }

  if (/\bfeedback\b/.test(t) || /\bgrade\b/.test(t) || /\bscore my\b/.test(t)) {
    return STAGES.SCORING;
  }

  if (
    URL_RE.test(raw) ||
    /\bjob description\b/.test(t) ||
    /\bscan my resume\b/.test(t) ||
    /\bresume\b/.test(t) ||
    /\bjd\b/.test(t)
  ) {
    return STAGES.PARSING;
  }

  if (
    /\bcoach this\b/.test(t) ||
    /\bhow did i do\b/.test(t) ||
    /\bscore\b/.test(t) ||
    raw.trim().length >= LONG_ANSWER_CHARS
  ) {
    return STAGES.ANALYZING;
  }

  return STAGES.NEUTRAL;
}

/** `phase: "fetching"` is a real URL-fetch step, not a guessed bucket. */
export function resolveThinkingStage({ userText, stage, phase } = {}) {
  if (stage && THINKING_BUCKETS[stage]) return stage;
  if (phase === "fetching") return STAGES.PARSING;
  return stageFromUserText(userText);
}

export function linesForStage(stage, rng = Math.random) {
  const key = THINKING_BUCKETS[stage] ? stage : STAGES.NEUTRAL;
  const lines = THINKING_BUCKETS[key].slice();
  if (key === STAGES.ANALYZING || key === STAGES.GENERATING) {
    const playful = PLAYFUL_LINES[Math.floor(rng() * PLAYFUL_LINES.length)];
    lines.push(playful);
  }
  return lines;
}

/** Fisher–Yates shuffle; avoids opening on `last` so rotation doesn’t stutter. */
export function shuffleLines(lines, last, rng = Math.random) {
  const order = lines.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (last && order.length > 1 && order[0] === last) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

export function advanceThinking(order, index, rng = Math.random) {
  const next = index + 1;
  if (next < order.length) {
    return { order, index: next, line: order[next] };
  }
  const reshuffled = shuffleLines(order, order[order.length - 1], rng);
  return { order: reshuffled, index: 0, line: reshuffled[0] };
}
