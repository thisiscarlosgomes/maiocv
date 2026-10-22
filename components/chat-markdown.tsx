"use client";

import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return visibleText(node.props.children);
  return "";
}

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={plugins}
        disallowedElements={["img"]}
        components={{
          p: ({ children }) => (
            <p className={/^\s*(?:source|sources|fonte|fontes)\s*:/i.test(visibleText(children)) ? "chat-source-line" : undefined}>
              {children}
            </p>
          ),
          a: ({ href, children }) => {
            const external = /^https?:\/\//i.test(href ?? "");
            return (
              <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
