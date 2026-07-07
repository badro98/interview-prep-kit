import { useEffect, useState } from "react";
import {
  getJobs,
  getActiveJobId,
  setActiveJobId,
  updateJob,
  deleteJobWithData,
  exportJob,
  importJob,
} from "../lib/jobs.js";

// Overlay modal for managing the full jobs collection: rename, archive/unarchive,
// delete (two-step confirm), export to JSON, import from JSON. Structure follows
// CoachPasteModal (overlay + panel + Escape/backdrop close).
export default function ManageJobsModal({ open, onClose, onJobChange }) {
  const [jobs, setJobs] = useState(() => getJobs());
  const [editingId, setEditingId] = useState(null);
  const [editRole, setEditRole] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [confirmingId, setConfirmingId] = useState(null);
  const [importError, setImportError] = useState("");
  const [busyId, setBusyId] = useState(null);

  // Seeding is keyed on [open] only — App passes an inline onClose (new
  // identity every render), so keying this on onClose too would re-seed from
  // storage on any unrelated App re-render while open (see JobSettingsModal).
  useEffect(() => {
    if (!open) return;
    setJobs(getJobs());
    setImportError("");
    setEditingId(null);
    setConfirmingId(null);
    setEditRole("");
    setEditCompany("");
  }, [open]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function refresh() {
    setJobs(getJobs());
  }

  function startEdit(job) {
    setEditingId(job.id);
    setEditRole(job.role);
    setEditCompany(job.company);
    setConfirmingId(null);
  }

  function saveEdit(id) {
    if (!editRole.trim() || !editCompany.trim()) return;
    updateJob(id, { role: editRole.trim(), company: editCompany.trim() });
    setEditingId(null);
    refresh();
    if (id === getActiveJobId()) onJobChange?.(id);
  }

  function toggleArchive(job) {
    const nextStatus = job.status === "archived" ? "active" : "archived";
    updateJob(job.id, { status: nextStatus });

    // If the active job ends up archived (it was just archived, or the only
    // non-archived job got unarchived while some other archived job was
    // somehow active), re-point activeJobId to the first non-archived job.
    const updatedJobs = getJobs();
    const activeId = getActiveJobId();
    const activeJob = updatedJobs.find((j) => j.id === activeId);
    if (activeJob?.status === "archived") {
      const nextActive = updatedJobs.find((j) => j.status !== "archived");
      if (nextActive) {
        setActiveJobId(nextActive.id);
        onJobChange?.(nextActive.id);
      }
    }

    refresh();
  }

  function handleExport(job) {
    const data = exportJob(job.id);
    const filename = sanitizeFilename(`iprep-job-${job.role}-${job.company}.json`);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(job) {
    setBusyId(job.id);
    try {
      await deleteJobWithData(job.id);
      setConfirmingId(null);
      refresh();
      onJobChange?.(getActiveJobId());
    } finally {
      setBusyId(null);
    }
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setImportError("Invalid job export file");
        return;
      }
      try {
        importJob(parsed);
        setImportError("");
        refresh();
      } catch {
        setImportError("Invalid job export file");
      }
    };
    reader.onerror = () => setImportError("Could not read that file.");
    reader.readAsText(file);
    e.target.value = "";
  }

  const canDelete = jobs.length > 1;
  const activeCount = jobs.filter((j) => j.status !== "archived").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">Manage jobs</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Rename, archive, export, or delete jobs. Export before deleting if you
              want to keep a copy.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-400 transition hover:bg-ink-700 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              isEditing={editingId === job.id}
              editRole={editRole}
              editCompany={editCompany}
              onEditRole={setEditRole}
              onEditCompany={setEditCompany}
              onStartEdit={() => startEdit(job)}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={() => saveEdit(job.id)}
              onToggleArchive={() => toggleArchive(job)}
              onExport={() => handleExport(job)}
              isConfirming={confirmingId === job.id}
              onRequestDelete={() => setConfirmingId(job.id)}
              onCancelDelete={() => setConfirmingId(null)}
              onConfirmDelete={() => handleDelete(job)}
              canDelete={canDelete}
              // Archiving this job must never leave zero non-archived jobs.
              canArchive={job.status === "archived" || activeCount > 1}
              busy={busyId === job.id}
            />
          ))}
        </div>

        <div className="border-t border-ink-600 px-5 py-4">
          {importError && (
            <p className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {importError}
            </p>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-ink-600 py-3 text-xs text-slate-400 transition hover:border-ink-500 hover:text-white">
            Import job (.json)
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function JobRow({
  job,
  isEditing,
  editRole,
  editCompany,
  onEditRole,
  onEditCompany,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleArchive,
  onExport,
  isConfirming,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  canDelete,
  canArchive,
  busy,
}) {
  const archived = job.status === "archived";

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/40 px-3 py-2.5">
      <div className="flex items-center gap-3">
        {isEditing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              autoFocus
              value={editRole}
              onChange={(e) => onEditRole(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
              placeholder="Role"
            />
            <input
              value={editCompany}
              onChange={(e) => onEditCompany(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
              placeholder="Company"
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-200">
              {job.role} — {job.company}
            </p>
          </div>
        )}

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            archived
              ? "bg-slate-500/15 text-slate-400 ring-1 ring-inset ring-slate-500/30"
              : "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
          }`}
        >
          {archived ? "archived" : "active"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {isEditing ? (
          <>
            <button
              onClick={onCancelEdit}
              className="rounded-md px-2.5 py-1 text-xs text-slate-400 hover:bg-ink-700 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={onSaveEdit}
              disabled={!editRole.trim() || !editCompany.trim()}
              className="rounded-md bg-accent-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </>
        ) : isConfirming ? (
          <>
            <span className="mr-1 text-xs text-red-300">
              Delete {job.role} — {job.company}? This removes all its data.
            </span>
            <button
              onClick={onCancelDelete}
              className="rounded-md px-2.5 py-1 text-xs text-slate-400 hover:bg-ink-700 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmDelete}
              disabled={busy}
              className="rounded-md bg-red-500/90 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onStartEdit}
              className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-ink-700 hover:text-white"
              aria-label="Rename"
              title="Rename"
            >
              <PencilIcon />
            </button>
            <button
              onClick={onToggleArchive}
              disabled={!canArchive}
              title={canArchive ? undefined : "Can't archive the last remaining active job"}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-ink-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
            >
              {archived ? "Unarchive" : "Archive"}
            </button>
            <button
              onClick={onExport}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-ink-700"
            >
              Export
            </button>
            <button
              onClick={onRequestDelete}
              disabled={!canDelete}
              title={canDelete ? "Delete this job" : "Can't delete the last remaining job"}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9.\-]+/gi, "-").replace(/-+/g, "-");
}

function PencilIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
