import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared markdown renderer — semantic prose colors; invert in dark theme.
export default function Markdown({ children }) {
  return (
    <div
      className="prose dark:prose-invert max-w-none
        prose-headings:font-semibold prose-headings:tracking-tight
        prose-h1:text-2xl prose-h1:mb-2 prose-h1:text-ink1
        prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-accent
        prose-h3:text-base prose-h3:mt-6 prose-h3:text-ink1
        prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-ink1
        prose-li:text-[15px] prose-li:text-ink1 prose-li:my-1
        prose-strong:text-ink1
        prose-a:text-accent prose-a:no-underline hover:prose-a:underline
        prose-blockquote:border-l-accent prose-blockquote:bg-surface2/40
        prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md
        prose-blockquote:not-italic prose-blockquote:text-ink1
        prose-code:text-accent prose-code:bg-surface2 prose-code:px-1.5
        prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-['']
        prose-hr:border-line"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
