import type { ReactNode } from "react";
import type { PlanSummary } from "../../lib/chat-flags";
import type { Locale } from "../../lib/locale";

export type ChatShellMessage = {
  role: "user" | "assistant";
  content: string;
  /** Charts that replace the text body. */
  body?: ReactNode;
  /** Trip card. Rendered above the text so the openable plan leads the reply. */
  lead?: ReactNode;
  /** Citations, PDF, and other notes. Rendered under the text. */
  extra?: ReactNode;
  /** Plan summaries and chips for a thumbs-down flag. Text comes from the transcript. */
  flag?: {
    planBefore: PlanSummary | null;
    planAfter: PlanSummary | null;
    chips?: string[];
  };
};

export type ChatSuggestion = { label: string; prompt?: string };

/**
 * Shared chat shell contract. Ask Maio and the trip planner each supply one.
 * A later single chat can switch `id` (and the send handler) on the same transcript:
 * planning utterances go to /api/plan, everything else to the portal Q&A backend.
 */
export type ChatAdapter = {
  id: "ask" | "plan";
  locale: Locale;
  welcome: string;
  logLabel: string;
  placeholder: string;
  thinking: string;
  sendLabel: string;
  sendingLabel: string;
  inputId: string;
  note?: string;
  suggestions: ChatSuggestion[];
  /** Empty-state chips, or also under the thread once a plan exists. */
  suggestionsWhen?: "empty" | "always";
  messages: ChatShellMessage[];
  draft: string;
  busy: boolean;
  error?: string;
  onDraft: (value: string) => void;
  onSend: (text: string, suggestedPrompt?: string) => void;
  /** Last assistant message can offer tappable follow-up lines. */
  onFollowUp?: (question: string) => void;
  /** Recording or another lock besides `busy`. */
  inputLocked?: boolean;
  onClear?: () => void;
  clearLabel?: string;
  clearVariant?: "icon" | "text";
  /** Hidden file input and other controls before the field. */
  composerLeading?: ReactNode;
  /** Voice and other buttons between clear and send. */
  composerExtras?: ReactNode;
  aboveComposer?: ReactNode;
  belowComposer?: ReactNode;
  /** Replaces the transcript, for the planner's trip screen. */
  stage?: ReactNode;
  /** When false, the thread is view-only. */
  composer?: boolean;
  className?: string;
  children?: ReactNode;
};
