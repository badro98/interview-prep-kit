import { useEffect, useRef, useState } from "react";
import { getJobs, getActiveJob, setActiveJobId, createJob } from "../lib/jobs.js";
import { STAGE_PRESETS, ADVISOR_STARTERS } from "../../interview.config.js";

// Header job switcher: dropdown listing non-archived jobs, plus "New job" and
// "Manage jobs…" actions. Follows CoachPasteModal's outside-click/Escape pattern,
// but renders an anchored dropdown panel instead of a full-screen overlay.
export default function JobSwitcher({ onJobChange, onManageJobs }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
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
    setCreating(false);
    setRole("");
    setCompany("");
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

  function handleCreate() {
    if (!role.trim() || !company.trim()) return;
    const job = createJob({
      role: role.trim(),
      company: company.trim(),
      stages: STAGE_PRESETS,
      advisorStarters: ADVISOR_STARTERS,
    });
    setActiveJobId(job.id);
    onJobChange?.(job.id);
    close();
  }

  function openManage() {
    close();
    onManageJobs?.();
  }

  const label = active ? `${active.role} — ${active.company}` : "No job selected";

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[24ch] items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-ink-500"
      >
        <span className="truncate">{label}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-72 max-w-[80vw] overflow-hidden rounded-lg border border-ink-600 bg-ink-800 shadow-2xl">
          <div className="max-h-64 overflow-y-auto py-1">
            {jobs.map((j) => {
              const isActive = j.id === active?.id;
              return (
                <button
                  key={j.id}
                  onClick={() => selectJob(j.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-ink-700/60"
                >
                  <span className="w-3.5 shrink-0 text-accent-400">
                    {isActive ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {j.role} — {j.company}
                  </span>
                </button>
              );
            })}
            {jobs.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-500">No active jobs.</p>
            )}
          </div>

          <div className="border-t border-ink-600">
            {creating ? (
              <div className="space-y-2 p-3">
                <input
                  autoFocus
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Role (e.g. Senior QA Engineer)"
                  className="w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
                />
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company"
                  className="w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setCreating(false)}
                    className="rounded-md px-2.5 py-1.5 text-xs text-slate-400 hover:bg-ink-700 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!role.trim() || !company.trim()}
                    className="rounded-md bg-accent-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Create
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-ink-700/60"
              >
                ＋ New job
              </button>
            )}
            <button
              onClick={openManage}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-300 hover:bg-ink-700/60"
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
      className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
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
