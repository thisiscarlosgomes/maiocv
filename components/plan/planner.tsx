"use client";

import type { Locale } from "../../lib/locale";

export function Planner({ locale }: { locale: Locale }) {
  return (
    <main id="conteudo" className="plan-main" lang={locale}>
      <h1 className="plan-title">Plan your days on Maio</h1>
      <p className="plan-lede">Test build. Tell the concierge how many days you have.</p>
    </main>
  );
}
