import { useEffect, useMemo, useRef, useState } from "react";
import {
  ROTATE_MS,
  TEXT_DELAY_MS,
  advanceThinking,
  linesForStage,
  resolveThinkingStage,
  shuffleLines,
} from "./thinkingStatus.js";

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

export default function AdvisorThinking({ userText, stage: stageProp, phase }) {
  const stage = useMemo(
    () => resolveThinkingStage({ userText, stage: stageProp, phase }),
    [userText, stageProp, phase]
  );

  const [showLine, setShowLine] = useState(false);
  const [line, setLine] = useState("");
  const orderRef = useRef(null);
  const indexRef = useRef(0);
  const lastLineRef = useRef(null);

  useEffect(() => {
    const order = shuffleLines(linesForStage(stage), lastLineRef.current);
    orderRef.current = order;
    indexRef.current = 0;
    lastLineRef.current = order[0];
    setLine(order[0] || "");
  }, [stage]);

  useEffect(() => {
    const id = window.setTimeout(() => setShowLine(true), TEXT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!showLine || prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      const stepped = advanceThinking(orderRef.current, indexRef.current);
      orderRef.current = stepped.order;
      indexRef.current = stepped.index;
      lastLineRef.current = stepped.line;
      setLine(stepped.line);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [showLine, stage]);

  return (
    <div
      className="flex items-center gap-2.5 py-1 text-sm text-ink2"
      role="status"
      aria-live="polite"
      aria-label="Advisor is thinking"
    >
      <span className="advisor-think-dot" aria-hidden="true" />
      {showLine && line ? (
        <span key={line} className="advisor-think-line min-w-0" aria-hidden="true">
          {line}
        </span>
      ) : null}
    </div>
  );
}
