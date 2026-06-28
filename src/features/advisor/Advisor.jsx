import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../../components/Markdown.jsx";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import ActionProposals from "./ActionProposals.jsx";
import ChatHistory from "./ChatHistory.jsx";
import { advisorChat, getMode, MODE_API, MODE_PASTE } from "../../lib/coach.js";
import { getContextSummary } from "../../lib/context.js";
import { getDeck } from "../flashcards/deck.js";
import {
  parseAdvisorActions,
  stripAdvisorActions,
  executeAdvisorProposal,
} from "./actions.js";
import { extractUrls, fetchUrlContent } from "../../lib/fetchUrl.js";
import {
  getAdvisorThreads,
  getActiveAdvisorThreadId,
  createAdvisorThread,
  saveAdvisorThreadMessages,
  setActiveAdvisorThreadId,
} from "../../lib/store.js";
import { isProxyReachable } from "../../lib/claude.js";
import { ADVISOR_STARTERS } from "../../../interview.config.js";

const STARTERS = ADVISOR_STARTERS;

function ensureActiveThread() {
  let id = getActiveAdvisorThreadId();
  if (!id) {
    const t = createAdvisorThread();
    id = t.id;
  }
  return id;
}

export default function Advisor({ onContextChange }) {
  const [threadTick, setThreadTick] = useState(0);
  const refreshThreads = () => setThreadTick((t) => t + 1);

  const threads = useMemo(() => getAdvisorThreads(), [threadTick]);
  const [activeId, setActiveId] = useState(() => ensureActiveThread());
  const activeThread = threads.find((t) => t.id === activeId) || null;
  const [messages, setMessages] = useState(() => activeThread?.messages || []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null);
  const [deckTick, setDeckTick] = useState(0);
  const bumpDeck = () => setDeckTick((t) => t + 1);
  const bottomRef = useRef(null);
  const skipSaveRef = useRef(false);

  const ctx = useMemo(() => getContextSummary(), [threadTick]);
  const deck = useMemo(() => getDeck(), [deckTick]);

  // Load messages when switching threads (skip the next save — avoid overwriting).
  useEffect(() => {
    skipSaveRef.current = true;
    const thread = getAdvisorThreads().find((t) => t.id === activeId);
    setMessages(thread?.messages || []);
    setInput("");
    setErr("");
  }, [activeId]);

  // Persist messages for the active thread.
  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (!activeId) return;
    saveAdvisorThreadMessages(activeId, messages);
    refreshThreads();
  }, [messages, activeId]);

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
        "\n\n(Note: URL fetch needs npm run dev:api — paste the page text directly if fetch fails.)"
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

      let modelContent = trimmed;
      try {
        modelContent = await buildModelContent(trimmed);
      } catch (e) {
        setErr(e.message || "Could not prepare message.");
        setBusy(false);
        return;
      }

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
              "Proxy not reachable. Run npm run dev:api and open http://localhost:5175"
            );
          }
        }

        const result = await advisorChat({ messages: nextMessages });

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
    [messages, busy, buildModelContent, activeId]
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
      prev.map((m) => (m.at === at ? { ...m, ...patch } : m))
    );
  }

  function handleApplyProposal(message, proposal) {
    const result = executeAdvisorProposal(proposal);
    const applied = [...(message.appliedProposalIds || []), proposal.id];
    patchMessage(message.at, { appliedProposalIds: applied });

    if (result.kind === "flashcards") bumpDeck();
    if (result.kind === "context") onContextChange?.();

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

  function handleDismissProposal(message, proposalId) {
    const dismissed = [...(message.dismissedProposalIds || []), proposalId];
    patchMessage(message.at, { dismissedProposalIds: dismissed });
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
        <div className="border-b border-ink-700 px-6 py-3">
          <h2 className="text-sm font-semibold text-white">
            {activeThread?.title || "Prep advisor"}
          </h2>
          <p className="text-xs text-slate-400">
            {ctx.count} context sources · {deck.length} flashcards ·{" "}
            {getMode() === MODE_API ? "Gemini API" : "paste mode"}
          </p>
        </div>

        {err && (
          <div className="mx-6 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {err}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl pt-8">
              <p className="mb-4 text-sm text-slate-400">
                Ask about readiness, interview questions, recruiter updates, or paste a
                link to generate flashcards and context — the advisor will ask you to
                confirm before adding anything. Manage context in the Context tab.
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={busy}
                    className="rounded-full border border-ink-600 bg-ink-800 px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-accent-500/50 hover:text-white disabled:opacity-50"
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
                  onApplyProposal={(p) => handleApplyProposal(m, p)}
                  onDismissProposal={(id) => handleDismissProposal(m, id)}
                />
              ))}
              {busy && (
                <div className="text-sm italic text-slate-500">Thinking…</div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-ink-700 p-4">
          <form
            className="mx-auto flex max-w-2xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
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
              className="min-h-[52px] flex-1 resize-none rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-accent-500 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="shrink-0 self-end rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-400 disabled:opacity-40"
            >
              Send
            </button>
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

function MessageBubble({ message, onApplyProposal, onDismissProposal }) {
  const isUser = message.role === "user";
  const isNote = message.isSystemNote;

  if (isNote) {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
          {message.content}
        </p>
      </div>
    );
  }

  const display = isUser
    ? message.content
    : stripAdvisorActions(message.content);
  const proposals = isUser ? [] : parseAdvisorActions(message.content);
  const appliedIds = [
    ...(message.appliedProposalIds || []),
    ...(message.dismissedProposalIds || []),
  ];

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-accent-500/20 text-slate-100 ring-1 ring-inset ring-accent-500/30"
            : "bg-ink-800 text-slate-200 ring-1 ring-inset ring-ink-600"
        }`}
      >
        {isUser ? (
          <div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{display}</p>
            {message.modelContent && (
              <p className="mt-2 text-[11px] text-accent-300/80">
                ↳ Linked page content fetched and included for the advisor
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-p:text-sm prose-li:text-sm">
              <Markdown>{display}</Markdown>
            </div>
            <ActionProposals
              proposals={proposals}
              appliedIds={appliedIds}
              onApply={onApplyProposal}
              onDismiss={onDismissProposal}
            />
          </>
        )}
      </div>
    </div>
  );
}
