import { useMemo, useState } from "react";
import { getActiveContextBlocks } from "../../lib/context.js";
import {
  setContextFileEnabled,
  addCustomContextEntry,
  updateCustomContextEntry,
  removeCustomContextEntry,
  getCurrentStageId,
  getDismissedSuggestions,
  setContextRecommendation,
  clearContextRecommendation,
} from "../../lib/store.js";
import {
  addProfileEntry,
  getProfileEntries,
  updateProfileEntry,
  removeProfileEntry,
} from "../../lib/profile.js";
import { attachProfileRef, detachProfileRef, getActiveJob, getJobs } from "../../lib/jobs.js";
import { fetchUrlContent, normalizeUrlInput } from "../../lib/fetchUrl.js";
import { readEntryFile, entryNameFromUrl } from "../../lib/entryFile.js";
import { isProxyReachable } from "../../lib/claude.js";
import { recommendFromNewContext } from "../prep-docs/suggestions.js";

export default function Context({ onChange }) {
  const [tick, setTick] = useState(0);
  const bump = () => {
    setTick((t) => t + 1);
    onChange?.();
  };
  const blocks = useMemo(() => getActiveContextBlocks(), [tick]);
  const enabledCount = blocks.filter((b) => b.enabled).length;

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <h2 className="text-lg font-semibold text-ink1">Context sources</h2>
          <p className="mt-1 text-sm text-ink2">
            Grounding material for prep docs, flashcards, advisor, and audio scoring.
            Shared items (stories, portfolio, overall experience) follow you to every
            job. Job-only items stay on this role — tailored resumes, the posting, recruiter notes.
          </p>
          <p className="mt-2 text-xs text-ink2">
            {enabledCount} of {blocks.length} sources active
          </p>
        </header>

        <ContextManager blocks={blocks} onChange={bump} />
      </div>
    </div>
  );
}

function ContextManager({ blocks, onChange }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [editing, setEditing] = useState(null);
  const [addScope, setAddScope] = useState("job");
  const [pending, setPending] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(null);

  const job = getActiveJob();
  const profileEntries = getProfileEntries();
  const attached = new Set(job?.profileRefs || []);
  const custom = blocks.filter((b) => b.source === "custom");

  function queuePending({ name, content }) {
    const trimmedName = String(name || "").trim();
    const trimmedContent = String(content || "").trim();
    if (!trimmedName || !trimmedContent) return;
    setSavedNote(null);
    setPending((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName,
        content: trimmedContent,
        scope: addScope,
      },
    ]);
  }

  function removePending(id) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  async function savePendingContext() {
    if (!pending.length || saving) return;
    setSaving(true);
    setSavedNote(null);
    const started = Date.now();
    try {
      const snapshot = pending;
      for (const item of snapshot) {
        if (item.scope === "profile") {
          const entry = addProfileEntry({ name: item.name, content: item.content });
          if (job) attachProfileRef(job.id, entry.id);
        } else {
          addCustomContextEntry({ name: item.name, content: item.content });
        }
      }
      const jobNow = getActiveJob();
      const stageIds = (jobNow?.stages || []).map((s) => s.id);
      const rec = recommendFromNewContext(snapshot, {
        existingStageIds: stageIds,
        dismissedIds: getDismissedSuggestions(),
        currentStageId: getCurrentStageId(stageIds),
      });
      if (rec) setContextRecommendation(rec);
      else clearContextRecommendation();
      const wait = 600 - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setPending([]);
      setSavedNote(
        rec
          ? "Saved. Prep Docs has a suggested next step based on this context."
          : "Saved. Advisor and prep docs will use this context."
      );
      onChange();
    } finally {
      setSaving(false);
    }
  }

  function openEditProfile(entry) {
    setEditing({
      type: "profile",
      profileId: entry.id,
      label: entry.name,
      content: entry.content,
    });
  }

  function openEditCustom(block) {
    setEditing({
      type: "custom",
      customId: block.customId,
      label: block.label,
      content: block.content,
    });
  }

  function saveEdit() {
    if (!editing) return;
    if (editing.type === "profile") {
      updateProfileEntry(editing.profileId, {
        name: editing.label,
        content: editing.content,
      });
    } else {
      updateCustomContextEntry(editing.customId, {
        name: editing.label,
        content: editing.content,
      });
    }
    setEditing(null);
    onChange();
  }

  function handleAddCustom() {
    if (!newName.trim() || !newContent.trim()) return;
    queuePending({ name: newName, content: newContent });
    setNewName("");
    setNewContent("");
    setAdding(false);
  }

  async function handleUploadFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadBusy(true);
    setUploadError("");
    try {
      queuePending(await readEntryFile(file));
    } catch (err) {
      setUploadError(err.message || "Could not read that file.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleAddFromUrl() {
    const url = normalizeUrlInput(sourceUrl);
    if (!url) {
      setUrlError("Enter a URL to fetch.");
      return;
    }
    setUrlBusy(true);
    setUrlError("");
    try {
      const proxyOk = await isProxyReachable();
      if (!proxyOk) {
        setUrlError("Proxy is offline (run npm run dev) — paste the content manually instead.");
        return;
      }
      const { title, text } = await fetchUrlContent(url);
      queuePending({ name: entryNameFromUrl(url, title), content: text });
      setSourceUrl("");
    } catch (e) {
      setUrlError(e.message || "Could not fetch that URL.");
    } finally {
      setUrlBusy(false);
    }
  }

  function promoteCustomToProfile(block) {
    const entry = addProfileEntry({ name: block.label, content: block.content });
    if (job) attachProfileRef(job.id, entry.id);
    removeCustomContextEntry(block.customId);
    onChange();
  }

  function makeProfileJobOnly(entry) {
    const others = getJobs().filter(
      (j) => j.id !== job?.id && (j.profileRefs || []).includes(entry.id)
    );
    const extra = others.length
      ? ` It will also be removed from ${others.length} other job${others.length === 1 ? "" : "s"}.`
      : "";
    if (
      !window.confirm(
        `Move "${entry.name}" to this job only? It leaves your shared library.${extra}`
      )
    ) {
      return;
    }
    addCustomContextEntry({ name: entry.name, content: entry.content });
    removeProfileEntry(entry.id);
    onChange();
  }

  function toggleShared(entryId, on) {
    if (!job) return;
    if (on) attachProfileRef(job.id, entryId);
    else detachProfileRef(job.id, entryId);
    onChange();
  }

  return (
    <>
      <section className="mb-8">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink2">
          Shared across every role
        </h3>
        <p className="mb-3 text-xs text-ink2">
          Stories, metrics, portfolio, overall experience. Check an item to use it on
          this job.
        </p>
        <div className="space-y-1 rounded-xl border border-line bg-surface/40 p-2">
          {profileEntries.length === 0 && (
            <p className="px-2 py-3 text-sm text-ink2">
              Nothing shared yet. Choose “Shared across jobs” below when adding, or
              move a job-only item.
            </p>
          )}
          {profileEntries.map((entry) => (
            <ContextRow
              key={entry.id}
              label={entry.name}
              enabled={attached.has(entry.id)}
              onToggle={(on) => toggleShared(entry.id, on)}
              onEdit={() => openEditProfile(entry)}
              onMakeJobOnly={() => makeProfileJobOnly(entry)}
              onRemove={() => {
                if (
                  window.confirm(
                    `Remove "${entry.name}" from your shared library? Other jobs will lose it too.`
                  )
                ) {
                  removeProfileEntry(entry.id);
                  onChange();
                }
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink2">
          This job only
        </h3>
        <p className="mb-3 text-xs text-ink2">
          Tailored resume, job description, and notes that stay on this role.
        </p>
        <div className="space-y-1 rounded-xl border border-line bg-surface/40 p-2">
          {custom.length === 0 && !adding && (
            <p className="px-2 py-3 text-sm text-ink2">No job-only notes yet.</p>
          )}
          {custom.map((b) => (
            <ContextRow
              key={b.name}
              label={b.label}
              enabled={b.enabled}
              onToggle={(on) => {
                setContextFileEnabled(b.name, on);
                onChange();
              }}
              onEdit={() => openEditCustom(b)}
              onShare={() => {
                if (
                  window.confirm(
                    `Save "${b.label}" to your shared profile so every job can use it?`
                  )
                ) {
                  promoteCustomToProfile(b);
                }
              }}
              onRemove={() => {
                if (window.confirm(`Remove "${b.label}"?`)) {
                  removeCustomContextEntry(b.customId);
                  onChange();
                }
              }}
            />
          ))}
        </div>

        <fieldset className="mt-3">
          <legend className="sr-only">Where to save new context</legend>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink1">
              <input
                type="radio"
                name="context-add-scope"
                checked={addScope === "job"}
                onChange={() => setAddScope("job")}
                className="accent-accent"
              />
              This job only
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink1">
              <input
                type="radio"
                name="context-add-scope"
                checked={addScope === "profile"}
                onChange={() => setAddScope("profile")}
                className="accent-accent"
              />
              Shared across jobs
            </label>
          </div>
        </fieldset>

        {adding ? (
          <div className="mt-3 space-y-2 rounded-xl border border-line bg-canvas p-4">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Title (e.g. Recruiter follow-up 6/25)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink1 focus:border-accent focus:outline-none"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={6}
              placeholder="Markdown notes…"
              className="w-full resize-none rounded-lg border border-line bg-surface p-3 text-sm text-ink1 focus:border-accent focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setAdding(false)}
                className="text-sm text-ink2 hover:text-ink1"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustom}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
              >
                Add to list
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setAdding(true)}
              disabled={saving}
              className="flex-1 rounded-xl border border-dashed border-line py-3 text-sm text-ink2 transition hover:border-line hover:text-ink1 disabled:opacity-50"
            >
              + Paste context
            </button>
            <label className={`flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line py-3 text-sm text-ink2 transition hover:border-line hover:text-ink1 ${saving || uploadBusy ? "opacity-50" : ""}`}>
              {uploadBusy ? "Converting…" : "Upload .md / .txt / .pdf"}
              <input
                type="file"
                accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf"
                className="hidden"
                disabled={uploadBusy || saving}
                onChange={handleUploadFile}
              />
            </label>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://... page to pull in (portfolio, docs, posting)"
            disabled={saving}
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs text-ink1 focus:border-accent focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleAddFromUrl}
            disabled={urlBusy || saving}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink1 transition hover:border-line disabled:opacity-50"
          >
            {urlBusy ? "Fetching…" : "Add from URL"}
          </button>
        </div>
        {(uploadError || urlError) && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-300">{uploadError || urlError}</p>
        )}

        {pending.length > 0 && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
            <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink2">
              Ready to save · {pending.length}
            </p>
            <ul className="mt-1">
              {pending.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink1">{item.name}</span>
                  <span className="shrink-0 text-[11px] text-ink2">
                    {item.scope === "profile" ? "Shared" : "This job"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePending(item.id)}
                    disabled={saving}
                    className="shrink-0 rounded px-2 py-1 text-xs text-ink2 hover:bg-surface2 hover:text-ink1 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={savePendingContext}
              disabled={saving}
              className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:bg-accentHover disabled:cursor-wait disabled:opacity-80"
            >
              {saving ? "Saving context…" : "Save context"}
            </button>
          </div>
        )}
        {savedNote && !pending.length && (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {savedNote}
          </p>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-line bg-surface shadow-2xl">
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold text-ink1">Edit — {editing.label}</h3>
            </div>
            <input
              value={editing.label}
              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              className="border-b border-line bg-canvas px-4 py-2 text-sm text-ink1 focus:outline-none"
            />
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              className="min-h-[240px] flex-1 resize-none border-0 bg-canvas p-4 font-mono text-xs leading-relaxed text-ink1 focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <button
                onClick={() => setEditing(null)}
                className="rounded px-3 py-1.5 text-xs text-ink1 hover:bg-surface2"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ContextRow({
  label,
  sub,
  enabled,
  badge,
  onToggle,
  onEdit,
  onShare,
  onMakeJobOnly,
  onRemove,
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-surface2/50">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 accent-accent"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-ink1">
          <span className="truncate">{label}</span>
        </p>
        {sub && <p className="text-xs text-ink2">{sub}</p>}
        {badge && <span className="text-xs text-emerald-600 dark:text-emerald-400">{badge}</span>}
      </div>
      {(onEdit || onShare || onMakeJobOnly || onRemove) && (
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {onEdit && (
            <button
              onClick={onEdit}
              className="rounded px-2 py-1 text-xs text-ink2 hover:bg-surface2 hover:text-ink1"
            >
              Edit
            </button>
          )}
          {onShare && (
            <button
              onClick={onShare}
              className="rounded px-2 py-1 text-xs text-ink2 hover:bg-surface2 hover:text-ink1"
            >
              Share across jobs
            </button>
          )}
          {onMakeJobOnly && (
            <button
              onClick={onMakeJobOnly}
              className="rounded px-2 py-1 text-xs text-ink2 hover:bg-surface2 hover:text-ink1"
            >
              Make job-only
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="rounded px-2 py-1 text-xs text-ink2 hover:bg-surface2 hover:text-red-600 dark:hover:text-red-400"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
