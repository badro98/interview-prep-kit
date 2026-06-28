import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared markdown renderer with a tuned dark "prose" theme.
export default function Markdown({ children }) {
  return (
    <div
      className="prose prose-invert max-w-none
        prose-headings:font-semibold prose-headings:tracking-tight
        prose-h1:text-2xl prose-h1:mb-2 prose-h1:text-white
        prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-accent-400
        prose-h3:text-base prose-h3:mt-6 prose-h3:text-white
        prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-slate-300
        prose-li:text-[15px] prose-li:text-slate-300 prose-li:my-1
        prose-strong:text-white
        prose-a:text-accent-400 prose-a:no-underline hover:prose-a:underline
        prose-blockquote:border-l-accent-500 prose-blockquote:bg-ink-700/40
        prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md
        prose-blockquote:not-italic prose-blockquote:text-slate-300
        prose-code:text-accent-400 prose-code:bg-ink-700 prose-code:px-1.5
        prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-['']
        prose-hr:border-ink-600"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
