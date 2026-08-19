import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { markdownToHtml } from "../../lib/markdownHtml.js";

const PROSE =
  "prose dark:prose-invert max-w-none min-h-[16rem] px-4 py-3 focus:outline-none " +
  "prose-headings:font-semibold prose-headings:tracking-tight " +
  "prose-h1:text-2xl prose-h1:mb-2 prose-h1:text-ink1 " +
  "prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-accent " +
  "prose-h3:text-base prose-h3:mt-6 prose-h3:text-ink1 " +
  "prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-ink1 " +
  "prose-li:text-[15px] prose-li:text-ink1 prose-li:my-1 " +
  "prose-strong:text-ink1 " +
  "prose-a:text-accent prose-a:no-underline hover:prose-a:underline " +
  "prose-blockquote:border-l-accent prose-blockquote:bg-surface2/40 " +
  "prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md " +
  "prose-blockquote:not-italic prose-blockquote:text-ink1 " +
  "prose-code:text-accent prose-code:bg-surface2 prose-code:px-1.5 " +
  "prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-[''] " +
  "prose-hr:border-line";

function extensions(placeholder) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Underline,
    Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
    Placeholder.configure({ placeholder: placeholder || "Start writing…" }),
  ];
}

function initialHtml({ html, markdown }) {
  if (typeof html === "string" && html.trim()) return html;
  return markdownToHtml(markdown || "");
}

/**
 * Always-on Google Docs–style editor. Autosaves HTML (+ markdown fallback)
 * through onChange after a short debounce.
 */
export default function RichDocEditor({
  html,
  markdown,
  onChange,
  placeholder,
  toolbarHost,
}) {
  const timer = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const ready = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: extensions(placeholder),
    content: initialHtml({ html, markdown }),
    editorProps: {
      attributes: { class: PROSE },
    },
    onCreate: () => {
      requestAnimationFrame(() => {
        ready.current = true;
      });
    },
    onUpdate: ({ editor: ed }) => {
      if (!ready.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        onChangeRef.current?.({
          html: ed.getHTML(),
          markdown: ed.getText(),
        });
      }, 400);
    },
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  // Reload when the parent swaps documents (stage / subpage / regenerate).
  const contentKey = `${html || ""}::${markdown || ""}`;
  const prevKey = useRef(contentKey);
  useEffect(() => {
    if (!editor) return;
    if (prevKey.current === contentKey) return;
    prevKey.current = contentKey;
    const next = initialHtml({ html, markdown });
    const current = editor.getHTML();
    if (next.replace(/\s/g, "") === current.replace(/\s/g, "")) return;
    ready.current = false;
    editor.commands.setContent(next, { emitUpdate: false });
    requestAnimationFrame(() => {
      ready.current = true;
    });
  }, [contentKey, editor, html, markdown]);

  if (!editor) return null;

  return (
    <>
      {toolbarHost ? createPortal(<Toolbar editor={editor} />, toolbarHost) : null}
      <div className="rounded-lg border border-line bg-canvas">
        <EditorContent editor={editor} />
      </div>
    </>
  );
}

function Toolbar({ editor }) {
  const btn = (active) =>
    `rounded px-1.5 py-1 text-xs font-semibold transition ${
      active ? "bg-accent/15 text-accent" : "text-ink1 hover:bg-surface2"
    }`;

  function setLink() {
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("Link URL", prev);
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-0.5">
      <ToolBtn
        className={btn(editor.isActive("heading", { level: 1 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        label="H1"
      />
      <ToolBtn
        className={btn(editor.isActive("heading", { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="H2"
      />
      <ToolBtn
        className={btn(editor.isActive("heading", { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="H3"
      />
      <Sep />
      <ToolBtn
        className={btn(editor.isActive("bold"))}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="B"
        title="Bold"
      />
      <ToolBtn
        className={`${btn(editor.isActive("italic"))} italic`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="I"
        title="Italic"
      />
      <ToolBtn
        className={`${btn(editor.isActive("underline"))} underline`}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        label="U"
        title="Underline"
      />
      <ToolBtn
        className={`${btn(editor.isActive("strike"))} line-through`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="S"
        title="Strikethrough"
      />
      <Sep />
      <ToolBtn
        className={btn(editor.isActive("bulletList"))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="• List"
      />
      <ToolBtn
        className={btn(editor.isActive("orderedList"))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="1. List"
      />
      <ToolBtn
        className={btn(editor.isActive("blockquote"))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Quote"
      />
      <Sep />
      <ToolBtn
        className={btn(editor.isActive("link"))}
        onClick={setLink}
        label="Link"
      />
      <Sep />
      <ToolBtn
        className={btn(false)}
        onClick={() => editor.chain().focus().undo().run()}
        label="Undo"
      />
      <ToolBtn
        className={btn(false)}
        onClick={() => editor.chain().focus().redo().run()}
        label="Redo"
      />
    </div>
  );
}

export function ToolbarToggle({ open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? "Collapse formatting toolbar" : "Expand formatting toolbar"}
      title={open ? "Collapse formatting" : "Expand formatting"}
      className="shrink-0 rounded p-1 text-ink2 transition hover:bg-surface2 hover:text-ink1"
    >
      <CollapseIcon open={open} />
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-4 w-px bg-line" />;
}

function CollapseIcon({ open }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition ${open ? "" : "rotate-180"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function ToolBtn({ className, onClick, label, title }) {
  return (
    <button type="button" title={title || label} onClick={onClick} className={className}>
      {label}
    </button>
  );
}
