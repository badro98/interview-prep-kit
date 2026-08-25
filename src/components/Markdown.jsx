import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components = {
  table({ children, ...props }) {
    return (
      <div className="my-4 max-w-full overflow-x-auto">
        <table {...props}>{children}</table>
      </div>
    );
  },
};

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
        prose-pre:bg-surface2 prose-pre:p-4 prose-pre:overflow-x-auto
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit
        [&_code]:whitespace-pre-wrap [&_code]:break-words
        prose-table:text-sm prose-th:px-2 prose-th:py-1.5 prose-td:px-2 prose-td:py-1.5 prose-td:align-top
        prose-hr:border-line"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
