import { useMemo } from "react";
import { ORIGINAL_ID, sourceLabel } from "../../lib/docHistory.js";

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayHeading(ts) {
  if (!ts) return "Original";
  const day = startOfDay(ts);
  const today = startOfDay(Date.now());
  const yesterday = today - 86400000;
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function whenLabel(ts) {
  if (!ts) return "Bundled template";
  const diff = Date.now() - ts;
  if (diff < 45_000) return "Just now";
  if (diff < 3_600_000) {
    const m = Math.max(1, Math.round(diff / 60_000));
    return `${m} min ago`;
  }
  if (startOfDay(ts) === startOfDay(Date.now())) {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupByDay(versions) {
  const groups = [];
  for (const v of versions) {
    const heading = dayHeading(v.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.items.push(v);
    else groups.push({ heading, items: [v] });
  }
  return groups;
}

export default function VersionHistory({
  versions = [],
  selectedId,
  onSelect,
  onRestore,
  onName,
  onClose,
}) {
  const groups = useMemo(() => groupByDay(versions), [versions]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
        <h3 className="text-sm font-semibold text-ink1">Version history</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs font-medium text-ink2 hover:bg-surface2 hover:text-ink1"
        >
          Back
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.map((group) => (
          <div key={group.heading} className="mb-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink2">
              {group.heading}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((v) => {
                const on = selectedId === v.id;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(v.id)}
                      className={`w-full rounded-md px-2 py-1.5 text-left transition ${
                        on ? "bg-accent/10 text-ink1" : "text-ink1 hover:bg-surface2"
                      }`}
                    >
                      <span className="block text-xs font-medium">{sourceLabel(v)}</span>
                      <span className="block text-[11px] text-ink2">{whenLabel(v.createdAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {versions.length === 0 && (
          <p className="px-2 py-4 text-xs text-ink2">No versions yet. Edits will show up here.</p>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t border-line px-3 py-3">
        {selectedId && selectedId !== ORIGINAL_ID && (
          <button
            type="button"
            onClick={() => onName?.(selectedId)}
            className="w-full rounded-md px-3 py-1.5 text-xs font-medium text-ink1 hover:bg-surface2"
          >
            Name this version
          </button>
        )}
        {selectedId && (
          <button
            type="button"
            onClick={() => onRestore?.(selectedId)}
            className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accentHover"
          >
            Restore this version
          </button>
        )}
      </div>
    </aside>
  );
}
