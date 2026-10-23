"use client";

import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkChatFollowUps } from "../lib/chat-followups";
import { remarkVisitMaioLinks } from "../lib/chat-visitmaio";

const plugins = [remarkGfm, remarkVisitMaioLinks];
const interactivePlugins = [remarkGfm, remarkVisitMaioLinks, remarkChatFollowUps];

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return visibleText(node.props.children);
  return "";
}

export function ChatMarkdown({ content, onFollowUp, disabled = false }: {
  content: string;
  onFollowUp?: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={onFollowUp ? interactivePlugins : plugins}
        disallowedElements={["img"]}
        components={{
          li: ({ node, children }) => {
            const question = node?.properties["data-follow-up"];
            if (typeof question !== "string" || !onFollowUp) return <li>{children}</li>;
            return (
              <li>
                <button type="button" className="chat-followup" disabled={disabled}
                  onClick={() => onFollowUp(question)}>
                  <span>{question}</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14m-6-6 6 6-6 6" />
                  </svg>
                </button>
              </li>
            );
          },
          p: ({ children }) => (
            <p className={/^\s*(?:source|sources|fonte|fontes)\s*:/i.test(visibleText(children)) ? "chat-source-line" : undefined}>
              {children}
            </p>
          ),
          a: ({ href, children }) => {
            const external = /^https?:\/\//i.test(href ?? "");
            const visitMaio = /^https:\/\/(?:www\.)?visitmaio\.com\/?$/i.test(href ?? "");
            return (
              <a href={href} className={visitMaio ? "chat-visitmaio-link" : undefined}
                target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
                {children}
                {visitMaio ? <><span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></> : null}
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
