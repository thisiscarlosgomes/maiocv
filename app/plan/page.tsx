import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SkipLink } from "maio-ui";
import { Header } from "../../components/site-shell";
import { Planner } from "../../components/plan/planner";
import { planEnabled } from "../../lib/plan-flag";
import { t } from "../../lib/i18n";
import { currentLocale } from "../../lib/request-locale";
import { planStrings } from "../../lib/trip-strings";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return { title: `${planStrings[locale].eyebrow} · maio.cv`, robots: { index: false, follow: false } };
}

export default async function PlanPage() {
  if (!planEnabled()) notFound();
  const locale = await currentLocale();
  return (
    <>
      <SkipLink href="#conteudo">{t("skip.content", undefined, locale)}</SkipLink>
      <div className="chat-screen plan-screen">
        <Header active="chat" />
        <Planner locale={locale} />
      </div>
    </>
  );
}
