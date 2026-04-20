import ReactMarkdown, { type Components } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const mdComponents: Components = {
  code({ className, children, ...props }) {
    return (
      <code
        className={`${className ?? ""} bg-muted text-foreground rounded px-1 py-0.5 text-sm font-mono`}
        {...props}
      >
        {children}
      </code>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="border-collapse text-sm w-full">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="border border-border bg-muted px-3 py-1.5 text-center font-semibold text-foreground">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border border-border px-3 py-1.5 text-center text-foreground">
        {children}
      </td>
    );
  },
};

export default function MathMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeKatex]}
      components={mdComponents}
    >
      {text}
    </ReactMarkdown>
  );
}
