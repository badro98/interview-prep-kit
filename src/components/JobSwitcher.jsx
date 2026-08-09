import { useEffect, useRef, useState } from "react";
import { getJobs, getActiveJob, setActiveJobId } from "../lib/jobs.js";

// Header job switcher: dropdown listing non-archived jobs, plus "New job" and
// "Manage jobs…" actions. Follows CoachPasteModal's outside-click/Escape pattern,
// but renders an anchored dropdown panel instead of a full-screen overlay.
export default function JobSwitcher({ onJobChange, onManageJobs, onNewJob, onJobSettings }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const active = getActiveJob();
  const jobs = getJobs().filter((j) => j.status !== "archived");

  useEffect(() => {
    function onMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    if (open) {
      window.addEventListener("mousedown", onMouseDown);
      window.addEventListener("keydown", onKey);
    }
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  function selectJob(id) {
    if (id === active?.id) {
      close();
      return;
    }
    setActiveJobId(id);
    onJobChange?.(id);
    close();
  }

  function handleNewJob() {
    close();
    onNewJob?.();
  }

  function openManage() {
    close();
    onManageJobs?.();
  }

  function openSettings() {
    close();
    onJobSettings?.();
  }

  const label = active ? `${active.role} — ${active.company}` : "No job selected";

  return (
    <div ref={rootRef} className="relative max-w-[24rem] shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title={label}
        className="inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink1 shadow-sm transition hover:border-accent/40"
      >
        <span className="truncate">{label}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-72 max-w-[80vw] overflow-hidden rounded-lg border border-line bg-surface shadow-2xl">
          <div className="max-h-64 overflow-y-auto py-1">
            {jobs.map((j) => {
              const isActive = j.id === active?.id;
              return (
                <button
                  key={j.id}
                  onClick={() => selectJob(j.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink1 hover:bg-surface2/60"
                >
                  <span className="w-3.5 shrink-0 text-accent">
                    {isActive ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {j.role} — {j.company}
                  </span>
                </button>
              );
            })}
            {jobs.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink2">No active jobs.</p>
            )}
          </div>

          <div className="border-t border-line">
            <button
              onClick={handleNewJob}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink1 hover:bg-surface2/60"
            >
              ＋ New job
            </button>
            <button
              onClick={openSettings}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink1 hover:bg-surface2/60"
            >
              Job settings…
            </button>
            <button
              onClick={openManage}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink1 hover:bg-surface2/60"
            >
              Manage jobs…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 text-ink2 transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
