import { useEffect, useState } from "react";
import { STAGES as SEED_STAGES } from "../../interview.config.js";
import { getActiveJob, updateJob, updateJobStages } from "../lib/jobs.js";
import { getProfileEntries } from "../lib/profile.js";
import {
  getDocOverride,
  hasRecording,
  setStageProgress,
  ensureStageProgressDefaults,
} from "../lib/store.js";
import StageEditor from "./StageEditor.jsx";

// Overlay modal for editing everything about the ACTIVE job: role/company,
// the stage list (via the shared StageEditor), and attached profile entries.
// JD/notes stay in the Context tab (link out, don't duplicate). Structure
// follows ManageJobsModal (overlay + panel + Escape/backdrop close).
export default function JobSettingsModal({ open, onClose, onSaved, onGoToContext }) {
  const [jobId, setJobId] = useState(null);
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [stages, setStages] = useState([]);
  const [originalStages, setOriginalStages] = useState([]);
  const [profileRefs, setProfileRefs] = useState([]);
  const [snapshot, setSnapshot] = useState("");
  const [error, setError] = useState("");
  const [removedConfirm, setRemovedConfirm] = useState(null);
  const [saving, setSaving] = useState(false);

  // Seeding is keyed on [open] only — App passes an inline onClose (new
  // identity every render), so keying this on onClose too would re-seed from
  // storage (wiping unsaved edits) on any unrelated App re-render while open.
  useEffect(() => {
    if (!open) return;
    const job = getActiveJob();
    const seededRole = job?.role || "";
    const seededCompany = job?.company || "";
    const seededStages = (job?.stages || []).map((s) => ({ ...s }));
    const seededRefs = [...(job?.profileRefs || [])];
    setJobId(job?.id || null);
    setRole(seededRole);
    setCompany(seededCompany);
    setStages(seededStages);
    setOriginalStages(seededStages);
    setProfileRefs(seededRefs);
    setSnapshot(
      JSON.stringify({
        role: seededRole,
        company: seededCompany,
        stages: seededStages,
        profileRefs: seededRefs,
      })
    );
    setError("");
    setRemovedConfirm(null);
    setSaving(false);
  }, [open]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const profileEntries = getProfileEntries();

  const current = JSON.stringify({
    role: role.trim(),
    company: company.trim(),
    stages,
    profileRefs,
  });
  const dirty = current !== snapshot;
  const hasStages = stages.length > 0;
  const hasEmptyTitle = stages.some((s) => !s.title?.trim());
  const canSave =
    !!role.trim() && !!company.trim() && dirty && hasStages && !hasEmptyTitle;

  function toggleProfileRef(id) {
    setProfileRefs((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  }

  function handleStagesChange(next) {
    setStages(next);
    setRemovedConfirm(null);
  }

  /** Merge any seed-config stages that aren't already on this job (by id). */
  function handleAddSeedStages() {
    const existing = new Set(stages.map((s) => s.id));
    const additions = SEED_STAGES.filter((s) => !existing.has(s.id)).map((s) => ({
      ...s,
    }));
    if (!additions.length) {
      setError("All seed stages are already on this job.");
      return;
    }
    setError("");
    setStages((prev) => [...prev, ...additions]);
    setRemovedConfirm(null);
  }

  // Drop a blank/whitespace-only regenTask so Regenerate doesn't inherit a
  // dead prompt; leave subtitle alone (renders fine empty).
  function normalizeStages(list) {
    return list.map((s) => {
      if (s.regenTask != null && !s.regenTask.trim()) {
        const { regenTask, ...rest } = s;
        return rest;
      }
      return s;
    });
  }

  function proceedSave() {
    if (!jobId) return;
    setSaving(true);
    setError("");
    try {
      // Stages save first: updateJobStages is the only validated/throwing
      // write here (invalid stage shape), so saving it first means a throw
      // never leaves a half-committed job (role/company/profileRefs already
      // persisted with stages left invalid).
      const normalized = normalizeStages(stages);
      updateJobStages(jobId, normalized);
      updateJob(jobId, { role: role.trim(), company: company.trim(), profileRefs });
      // Keep pipeline checklist sensible after seed imports: recruiter done, next current.
      const ids = normalized.map((s) => s.id);
      ensureStageProgressDefaults(ids);
      if (ids.includes("recruiter") && ids.length > 1) {
        setStageProgress("recruiter", "complete");
        const next = ids.find((id) => id !== "recruiter");
        if (next) setStageProgress(next, "in-progress");
      }
      setRemovedConfirm(null);
      onSaved?.(jobId);
    } catch (err) {
      setError(err?.message || "Could not save job settings.");
      setSaving(false);
    }
  }

  function handleSave() {
    if (!canSave || !jobId) return;

    const nextIds = new Set(stages.map((s) => s.id));
    const removed = originalStages
      .filter((s) => !nextIds.has(s.id))
      .map((s) => ({
        ...s,
        hasDoc: getDocOverride(s.id) != null,
        hasRec: hasRecording(s.id),
      }))
      .filter((s) => s.hasDoc || s.hasRec);

    if (removed.length) {
      setRemovedConfirm(removed);
      return;
    }
    proceedSave();
  }

  function removalCopy(stage) {
    if (stage.hasDoc && stage.hasRec) {
      return `Removing ${stage.title} deletes its prep doc edits and detaches its interview recording.`;
    }
    if (stage.hasDoc) {
      return `Removing ${stage.title} deletes its prep doc edits.`;
    }
    return `Removing ${stage.title} detaches its interview recording.`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink1">Job settings</h3>
            <p className="mt-0.5 text-xs text-ink2">
              Edit role, company, stages, and attached profile entries.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-ink2 transition hover:bg-surface2 hover:text-ink1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink2">Role</label>
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Role"
                className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink1 focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink2">Company</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company"
                className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink1 focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas/40 px-3 py-2.5">
            <p className="text-xs text-ink2">
              Job description and notes live in the Context tab
            </p>
            <button
              onClick={() => onGoToContext?.()}
              className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-ink1 hover:bg-surface2"
            >
              Open Context
            </button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink2">
                Stages
              </h4>
              <button
                type="button"
                onClick={handleAddSeedStages}
                className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink1 transition hover:border-accent/40 hover:bg-surface2 hover:text-ink1"
              >
                Add stages from seed
              </button>
            </div>
            <p className="mb-2 text-[11px] leading-snug text-ink2">
              After a recruiter call, click <span className="text-ink2">Add stages from seed</span> then{" "}
              <span className="text-ink2">Save</span>. Prep docs load from the repo; ask Advisor to refresh a stage from your latest context.
            </p>
            <StageEditor stages={stages} onChange={handleStagesChange} />
            {!hasStages && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-300">
                At least one stage is required.
              </p>
            )}
            {hasStages && hasEmptyTitle && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-300">
                Stage titles can't be empty.
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink2">
              Shared profile
            </h4>
            {profileEntries.length === 0 ? (
              <p className="text-[11px] leading-snug text-ink2">
                Stories, portfolio, and overall experience live on your local profile.
                Add them from Context as “shared across jobs”, then attach them here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {profileEntries.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex items-center gap-2 rounded-md border border-line bg-canvas/40 px-3 py-2 text-sm text-ink1 hover:bg-canvas/70"
                  >
                    <input
                      type="checkbox"
                      checked={profileRefs.includes(entry.id)}
                      onChange={() => toggleProfileRef(entry.id)}
                      className="h-3.5 w-3.5 rounded border-line bg-canvas text-accent focus:ring-accent"
                    />
                    {entry.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-line px-5 py-4">
          {error && (
            <p className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          {removedConfirm ? (
            <div className="space-y-2">
              {removedConfirm.map((s) => (
                <p key={s.id} className="text-xs text-red-600 dark:text-red-300">
                  {removalCopy(s)}
                </p>
              ))}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRemovedConfirm(null)}
                  className="rounded-md px-2.5 py-1 text-xs text-ink2 hover:bg-surface2 hover:text-ink1"
                >
                  Cancel
                </button>
                <button
                  onClick={proceedSave}
                  disabled={saving}
                  className="rounded-md bg-red-500/90 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Confirm"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md px-2.5 py-1 text-xs text-ink2 hover:bg-surface2 hover:text-ink1"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave || saving}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-accentHover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
