import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../../components/Markdown.jsx";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import ActionProposals from "./ActionProposals.jsx";
import SearchSources from "./SearchSources.jsx";
import ChatHistory from "./ChatHistory.jsx";
import AdvisorThinking from "./AdvisorThinking.jsx";
import { advisorChat, getMode, MODE_API, MODE_PASTE } from "../../lib/coach.js";
import { getContextSummary } from "../../lib/context.js";
import { getDeck } from "../flashcards/deck.js";
import {
  parseAdvisorActions,
  stripAdvisorActions,
  hasAdvisorActionsFence,
  executeAdvisorProposal,
} from "./actions.js";
import { extractUrls, fetchUrlContent } from "../../lib/fetchUrl.js";
import { splitSearchSources } from "./searchSources.js";
import {
  getAdvisorThreads,
  getActiveAdvisorThreadId,
  createAdvisorThread,
  saveAdvisorThreadMessages,
  setActiveAdvisorThreadId,
} from "../../lib/store.js";
import { isProxyReachable } from "../../lib/claude.js";
import { getActiveJob } from "../../lib/jobs.js";

function ensureActiveThread() {
  let id = getActiveAdvisorThreadId();
  if (!id) {
    const t = createAdvisorThread();
    id = t.id;
  }
  return id;
}

export default function Advisor({ onContextChange, onStagesChange }) {
  const [threadTick, setThreadTick] = useState(0);
  const refreshThreads = () => setThreadTick((t) => t + 1);

  const threads = useMemo(() => getAdvisorThreads(), [threadTick]);
  const [activeId, setActiveId] = useState(() => ensureActiveThread());
  const activeThread = threads.find((t) => t.id === activeId) || null;
  const [messages, setMessages] = useState(() => activeThread?.messages || []);
  const [input, setInput] = useState("");
  const [webSearch, setWebSearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [busyPhase, setBusyPhase] = useState("thinking");
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null);
  const [deckTick, setDeckTick] = useState(0);
  const bumpDeck = () => setDeckTick((t) => t + 1);
  const bottomRef = useRef(null);
  const skipSaveRef = useRef(false);

  const ctx = useMemo(() => getContextSummary(), [threadTick]);
  const deck = useMemo(() => getDeck(), [deckTick]);
  const starters = getActiveJob()?.advisorStarters || [];

  // Load messages when switching threads (skip the next save — avoid overwriting).
  useEffect(() => {
    skipSaveRef.current = true;
    const thread = getAdvisorThreads().find((t) => t.id === activeId);
    setMessages(thread?.messages || []);
    setInput("");
    setErr("");
  }, [activeId]);

  // Persist messages for the active thread. Skip the hydration write after a
  // thread switch so merely opening a chat does not count as activity.
  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (!activeId) return;
    saveAdvisorThreadMessages(activeId, messages);
    refreshThreads();
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, activeId]);

  const buildModelContent = useCallback(async (text) => {
    const urls = extractUrls(text);
    if (urls.length === 0) return text;

    const proxyOk = await isProxyReachable();
    if (!proxyOk) {
      return (
        text +
        "\n\n(Note: URL fetch needs npm run dev — paste the page text directly if fetch fails.)"
      );
    }

    const parts = [text];
    for (const url of urls.slice(0, 3)) {
      try {
        const { title, text: pageText, url: finalUrl } = await fetchUrlContent(url);
        parts.push(
          `\n\n---\n[Fetched webpage: ${title}]\nURL: ${finalUrl || url}\n\n${pageText}\n---`
        );
      } catch (e) {
        parts.push(`\n\n(Could not fetch ${url}: ${e.message})`);
      }
    }
    return parts.join("");
  }, []);

  const send = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setErr("");
      setBusy(true);
      setBusyText(trimmed);
      setBusyPhase(extractUrls(trimmed).length > 0 ? "fetching" : "thinking");

      let modelContent = trimmed;
      try {
        modelContent = await buildModelContent(trimmed);
      } catch (e) {
        setErr(e.message || "Could not prepare message.");
        setBusy(false);
        return;
      }

      setBusyPhase("thinking");

      const userMsg = {
        role: "user",
        content: trimmed,
        modelContent: modelContent !== trimmed ? modelContent : undefined,
        at: Date.now(),
      };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");

      try {
        if (getMode() === MODE_API) {
          const ok = await isProxyReachable();
          if (!ok) {
            throw new Error(
              "Proxy not reachable. Run npm run dev and open http://localhost:5175"
            );
          }
        }

        const result = await advisorChat({ messages: nextMessages, webSearch });

        if (result.mode === MODE_PASTE) {
          setModal({
            prompt: result.prompt,
            pendingMessages: nextMessages,
            threadId: activeId,
          });
        } else {
          setMessages([
            ...nextMessages,
            {
              role: "assistant",
              content: result.text,
              at: Date.now(),
              appliedProposalIds: [],
              dismissedProposalIds: [],
            },
          ]);
        }
      } catch (e) {
        setErr(e.message || "Could not reach the advisor.");
        setMessages(messages);
        setInput(trimmed);
      } finally {
        setBusy(false);
      }
    },
    [messages, busy, buildModelContent, activeId, webSearch]
  );

  function savePasteReply(text) {
    if (modal?.pendingMessages && modal.threadId === activeId) {
      setMessages([
        ...modal.pendingMessages,
        {
          role: "assistant",
          content: text,
          at: Date.now(),
          appliedProposalIds: [],
          dismissedProposalIds: [],
        },
      ]);
    }
    setModal(null);
  }

  function patchMessage(at, patch) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.at !== at) return m;
        const extra = typeof patch === "function" ? patch(m) : patch;
        return { ...m, ...extra };
      })
    );
  }

  function handleApplyProposal(message, proposal, { keepOpen = false, quiet = false } = {}) {
    const result = executeAdvisorProposal(proposal);
    if (!keepOpen) {
      patchMessage(message.at, (m) => {
        const applied = m.appliedProposalIds || [];
        if (applied.includes(proposal.id)) return {};
        return { appliedProposalIds: [...applied, proposal.id] };
      });
    }

    if (result.kind === "flashcards") bumpDeck();
    if (result.kind === "context") onContextChange?.();
    if (result.kind === "stage" || result.kind === "prepdoc") onStagesChange?.();

    if (!quiet) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message,
          at: Date.now() + 1,
          isSystemNote: true,
        },
      ]);
    }
  }

  function handleReviewItems(message, proposalId, updates, summary) {
    setMessages((prev) => {
      const current = prev.find((m) => m.at === message.at);
      if (!current) return prev;
      const nextStatus = {
        ...(current.proposalItemStatus || {}),
        [proposalId]: {
          ...((current.proposalItemStatus || {})[proposalId] || {}),
          ...updates,
        },
      };
      const applied = current.appliedProposalIds || [];
      const settling = Boolean(summary) && !applied.includes(proposalId);
      const next = prev.map((m) =>
        m.at === message.at
          ? {
              ...m,
              proposalItemStatus: nextStatus,
              appliedProposalIds: settling ? [...applied, proposalId] : applied,
            }
          : m
      );
      return next;
    });
  }

  function handleDismissProposal(message, proposalId) {
    patchMessage(message.at, (m) => {
      const dismissed = m.dismissedProposalIds || [];
      if (dismissed.includes(proposalId)) return {};
      return { dismissedProposalIds: [...dismissed, proposalId] };
    });
  }

  function selectThread(id) {
    if (busy) return;
    setActiveAdvisorThreadId(id);
    setActiveId(id);
  }

  return (
    <div className="flex h-full min-h-0">
      <ChatHistory
        threads={threads}
        activeId={activeId}
        onSelect={selectThread}
        onRefresh={refreshThreads}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line px-6 py-3">
          <h2 className="text-sm font-semibold text-ink1">
            {activeThread?.title || "Prep advisor"}
          </h2>
          <p className="text-xs text-ink2">
            {ctx.count} context sources · {deck.length} flashcards ·{" "}
            {getMode() === MODE_API ? "API" : "Paste (fallback)"}
          </p>
        </div>

        {err && (
          <div className="mx-6 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-300">
            {err}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl pt-8">
              <p className="mb-4 text-sm text-ink2">
                Ask about readiness, interview questions, recruiter updates, or paste a
                link to generate flashcards and context — the advisor will ask you to
                confirm before adding anything. Manage context in the Context tab.
              </p>
              <div className="flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={busy}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-xs text-ink1 transition hover:border-accent/50 hover:text-ink1 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-4">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.at ?? i}
                  message={m}
                  onApplyProposal={(p, opts) => handleApplyProposal(m, p, opts)}
                  onDismissProposal={(id) => handleDismissProposal(m, id)}
                  onRecordProposalStatus={(proposalId, updates, summary) =>
                    handleReviewItems(m, proposalId, updates, summary)
                  }
                />
              ))}
              {busy && <AdvisorThinking userText={busyText} phase={busyPhase} />}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-line p-4">
          <form
            className="mx-auto flex max-w-2xl flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={2}
                placeholder="Ask anything, paste recruiter intel, or drop a URL to ingest…"
                disabled={busy}
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink1 placeholder:text-ink2 focus:border-accent focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="shrink-0 self-end rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accentHover disabled:opacity-40"
              >
                Send
              </button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 self-start text-xs text-ink2">
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(e) => setWebSearch(e.target.checked)}
                disabled={busy}
                className="rounded border-line bg-canvas text-accent focus:ring-accent disabled:opacity-50"
              />
              Web search
              <span className="text-ink2">
                {getMode() === MODE_API
                  ? "(Google grounding via Gemini)"
                  : "(API mode only — paste has no live search)"}
              </span>
            </label>
          </form>
        </div>
      </div>

      <CoachPasteModal
        open={!!modal}
        title="Advisor — paste mode"
        prompt={modal?.prompt || ""}
        saveLabel="Add reply to chat"
        replyHint="Paste the advisor's reply here…"
        onSave={savePasteReply}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

function MessageBubble({
  message,
  onApplyProposal,
  onDismissProposal,
  onRecordProposalStatus,
}) {
  const isUser = message.role === "user";
  const isNote = message.isSystemNote;

  if (isNote) {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
          {message.content}
        </p>
      </div>
    );
  }

  const proposals = isUser ? [] : parseAdvisorActions(message.content);
  const rawDisplay = isUser
    ? message.content
    : stripAdvisorActions(message.content);
  const { body: display, sources } = isUser
    ? { body: rawDisplay, sources: [] }
    : splitSearchSources(rawDisplay);
  const parseFailed =
    !isUser && proposals.length === 0 && hasAdvisorActionsFence(message.content);
  const appliedIds = [
    ...(message.appliedProposalIds || []),
    ...(message.dismissedProposalIds || []),
  ];

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-accent/15 text-ink1 ring-1 ring-inset ring-accent/30"
            : "bg-surface text-ink1 ring-1 ring-inset ring-line"
        }`}
      >
        {isUser ? (
          <div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{display}</p>
            {message.modelContent && (
              <p className="mt-2 text-[11px] text-accent">
                ↳ Linked page content fetched and included for the advisor
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-2 prose-p:text-sm prose-li:text-sm">
              <Markdown>{display}</Markdown>
            </div>
            <SearchSources sources={sources} />
            {parseFailed && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                A kit-change proposal was included, but it could not be read. Ask the advisor to resend a tiny{" "}
                <code>advisor-actions</code> JSON block
                {/prep-doc|update_prep_doc|add_stage/i.test(message.content) ? (
                  <>
                    {" "}
                    and a separate <code>&lt;prep-doc&gt;</code> tag for each document
                  </>
                ) : null}
                .
              </p>
            )}
            <ActionProposals
              proposals={proposals}
              appliedIds={appliedIds}
              itemStatus={message.proposalItemStatus || {}}
              onApply={onApplyProposal}
              onDismiss={onDismissProposal}
              onRecordStatus={onRecordProposalStatus}
            />
          </>
        )}
      </div>
    </div>
  );
}
