import {
  getAdvisorThreads,
  createAdvisorThread,
  setActiveAdvisorThreadId,
  deleteAdvisorThread,
} from "../../lib/store.js";

export default function ChatHistory({
  threads,
  activeId,
  onSelect,
  onNewChat,
  onRefresh,
}) {
  function handleNew() {
    const thread = createAdvisorThread();
    onRefresh();
    onSelect(thread.id);
    onNewChat?.();
  }

  function handleDelete(e, threadId) {
    e.stopPropagation();
    const t = threads.find((x) => x.id === threadId);
    const label = t?.title || "this chat";
    if (!window.confirm(`Delete "${label}"?`)) return;
    deleteAdvisorThread(threadId);
    onRefresh();
    const next = getAdvisorThreads()[0]?.id || null;
    if (next) onSelect(next);
    else handleNew();
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-surface/50">
      <div className="border-b border-line p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink1">Chats</h2>
          <button
            onClick={handleNew}
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-accentHover"
          >
            + New
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink2">
          Past conversations are saved locally. Start a new chat anytime.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <p className="px-2 py-4 text-xs text-ink2">No chats yet.</p>
        ) : (
          threads.map((t) => (
            <ChatRow
              key={t.id}
              thread={t}
              active={t.id === activeId}
              onSelect={() => {
                setActiveAdvisorThreadId(t.id);
                onSelect(t.id);
              }}
              onDelete={(e) => handleDelete(e, t.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function ChatRow({ thread, active, onSelect, onDelete }) {
  const count = thread.messages?.filter((m) => !m.isSystemNote).length || 0;
  const when = thread.updatedAt
    ? new Date(thread.updatedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group mb-1 flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition ${
        active
          ? "bg-accent/15 ring-1 ring-inset ring-accent/40"
          : "hover:bg-surface2/60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-xs font-medium ${
            active ? "text-ink1" : "text-ink1"
          }`}
        >
          {thread.title || "New chat"}
        </p>
        <p className="mt-0.5 text-[10px] text-ink2">
          {count} message{count === 1 ? "" : "s"} · {when}
        </p>
      </div>
      <span
        role="button"
        tabIndex={-1}
        onClick={onDelete}
        title="Delete chat"
        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-ink2 opacity-0 transition group-hover:opacity-100 hover:bg-surface2 hover:text-red-600 dark:hover:text-red-400"
      >
        ✕
      </span>
    </button>
  );
}
