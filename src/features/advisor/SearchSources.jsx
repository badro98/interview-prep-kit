import { useState } from "react";
import { uniqueSourceHosts } from "./searchSources.js";

export default function SearchSources({ sources }) {
  const unique = uniqueSourceHosts(sources);
  const [open, setOpen] = useState(false);
  if (unique.length === 0) return null;

  const preview = unique.slice(0, 3);
  const label =
    unique.length === 1 ? unique[0].host : `${unique.length} sources`;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-medium text-ink2 ring-1 ring-inset ring-line transition hover:bg-surface hover:text-ink1"
      >
        <span className="flex -space-x-1" aria-hidden="true">
          {preview.map((s) => (
            <HostMark key={s.host} host={s.host} />
          ))}
        </span>
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {unique.map((s) => (
            <li key={s.host}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                title={s.title}
                className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-ink1 ring-1 ring-inset ring-line transition hover:text-accent hover:ring-accent/40"
              >
                <HostMark host={s.host} />
                <span className="max-w-[12rem] truncate">{s.host}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HostMark({ host }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[9px] font-bold uppercase text-accent ring-1 ring-surface">
      {host.slice(0, 1)}
    </span>
  );
}
