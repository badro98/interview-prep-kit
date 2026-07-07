import { useMemo, useState } from "react";
import { getActiveContextBlocks, getContextFiles } from "../../lib/context.js";
import {
  setContextFileEnabled,
  setContextOverride,
  clearContextOverride,
  addCustomContextEntry,
  updateCustomContextEntry,
  removeCustomContextEntry,
} from "../../lib/store.js";
import { fetchUrlContent, normalizeUrlInput } from "../../lib/fetchUrl.js";
import { readEntryFile, entryNameFromUrl } from "../../lib/entryFile.js";
import { isProxyReachable } from "../../lib/claude.js";

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
          <h2 className="text-lg font-semibold text-white">Context sources</h2>
          <p className="mt-1 text-sm text-slate-400">
            Grounding material for prep docs, flashcards, advisor, and audio scoring.
            Use the optional files in <code className="text-slate-300">context/</code>, paste
            notes, upload a file (.md/.txt/.pdf), or pull in a page by URL — you do not
            need every starter template.
          </p>
          <p className="mt-2 text-xs text-slate-500">
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

  const builtin = blocks.filter((b) => b.source === "builtin");
  const profile = blocks.filter((b) => b.source === "profile");
  const custom = blocks.filter((b) => b.source === "custom");

  function openEditBuiltin(block) {
    const original = getContextFiles().find((f) => f.name === block.name);
    setEditing({
      type: "builtin",
      name: block.name,
      label: block.label,
      content: block.content,
      originalContent: original?.content || block.content,
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
    if (editing.type === "builtin") {
      setContextOverride(editing.name, editing.content);
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
    addCustomContextEntry({ name: newName, content: newContent });
    setNewName("");
    setNewContent("");
    setAdding(false);
    onChange();
  }

  async function handleUploadFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadBusy(true);
    setUploadError("");
    try {
      const entry = await readEntryFile(file);
      addCustomContextEntry(entry);
      onChange();
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
      addCustomContextEntry({ name: entryNameFromUrl(url, title), content: text });
      setSourceUrl("");
      onChange();
    } catch (e) {
      setUrlError(e.message || "Could not fetch that URL.");
    } finally {
      setUrlBusy(false);
    }
  }

  return (
    <>
      <section className="mb-8">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          From context/ (optional templates)
        </h3>
        <div className="space-y-1 rounded-xl border border-ink-700 bg-ink-800/40 p-2">
          {builtin.map((b) => (
            <ContextRow
              key={b.name}
              label={b.label}
              sub={b.name}
              enabled={b.enabled}
              badge={b.hasOverride ? "edited" : null}
              onToggle={(on) => {
                setContextFileEnabled(b.name, on);
                onChange();
              }}
              onEdit={() => openEditBuiltin(b)}
            />
          ))}
        </div>
      </section>

      {profile.length > 0 && (
        <section className="mb-8">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            From your profile
          </h3>
          <div className="space-y-1 rounded-xl border border-ink-700 bg-ink-800/40 p-2">
            {profile.map((b) => (
              <ContextRow
                key={b.name}
                label={b.label}
                enabled={b.enabled}
                profileBadge
                onToggle={(on) => {
                  setContextFileEnabled(b.name, on);
                  onChange();
                }}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Custom
        </h3>
        <div className="space-y-1 rounded-xl border border-ink-700 bg-ink-800/40 p-2">
          {custom.length === 0 && !adding && (
            <p className="px-2 py-3 text-sm text-slate-500">No custom notes yet.</p>
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
              onRemove={() => {
                if (window.confirm(`Remove "${b.label}"?`)) {
                  removeCustomContextEntry(b.customId);
                  onChange();
                }
              }}
            />
          ))}
        </div>

        {adding ? (
          <div className="mt-3 space-y-2 rounded-xl border border-ink-600 bg-ink-900 p-4">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Title (e.g. Recruiter follow-up 6/25)"
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={6}
              placeholder="Markdown notes…"
              className="w-full resize-none rounded-lg border border-ink-600 bg-ink-800 p-3 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setAdding(false)}
                className="text-sm text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustom}
                className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white"
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setAdding(true)}
              className="flex-1 rounded-xl border border-dashed border-ink-600 py-3 text-sm text-slate-400 transition hover:border-ink-500 hover:text-white"
            >
              + Paste custom context
            </button>
            <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink-600 py-3 text-sm text-slate-400 transition hover:border-ink-500 hover:text-white">
              {uploadBusy ? "Converting…" : "Upload .md / .txt / .pdf"}
              <input
                type="file"
                accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf"
                className="hidden"
                disabled={uploadBusy}
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
            className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
          />
          <button
            onClick={handleAddFromUrl}
            disabled={urlBusy}
            className="shrink-0 rounded-md border border-ink-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-ink-500 disabled:opacity-50"
          >
            {urlBusy ? "Fetching…" : "Add from URL"}
          </button>
        </div>
        {(uploadError || urlError) && (
          <p className="mt-1 text-xs text-red-300">{uploadError || urlError}</p>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-ink-600 bg-ink-800 shadow-2xl">
            <div className="border-b border-ink-600 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Edit — {editing.label}</h3>
              {editing.type === "builtin" && (
                <p className="text-[11px] text-slate-400">
                  Override saved locally. Use Reset to restore the original file.
                </p>
              )}
            </div>
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              className="min-h-[240px] flex-1 resize-none border-0 bg-ink-900 p-4 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-ink-600 px-4 py-3">
              {editing.type === "builtin" ? (
                <button
                  onClick={() => {
                    clearContextOverride(editing.name);
                    setEditing({
                      ...editing,
                      content: editing.originalContent,
                    });
                    onChange();
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Reset to file original
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="rounded px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-700"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="rounded bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ContextRow({ label, sub, enabled, badge, profileBadge, onToggle, onEdit, onRemove }) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-700/50">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 accent-indigo-500"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <span className="truncate">{label}</span>
          {profileBadge && (
            <span className="shrink-0 rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-inset ring-slate-500/30">
              profile
            </span>
          )}
        </p>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
        {badge && <span className="text-xs text-emerald-400">{badge}</span>}
      </div>
      {(onEdit || onRemove) && (
        <div className="flex shrink-0 gap-1">
          {onEdit && (
            <button
              onClick={onEdit}
              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-ink-600 hover:text-white"
            >
              Edit
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-ink-600 hover:text-red-400"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
