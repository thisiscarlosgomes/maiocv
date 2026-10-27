import { notFound } from "next/navigation";
import { SkipLink } from "maio-ui";
import { Header } from "../../components/site-shell";
import { Planner } from "../../components/plan/planner";
import { planEnabled } from "../../lib/plan-flag";
import { t } from "../../lib/i18n";
import { currentLocale } from "../../lib/request-locale";

export const metadata = { title: "Trip planner (test) · maio.cv", robots: { index: false, follow: false } };

export default async function PlanPage() {
  if (!planEnabled()) notFound();
  const locale = await currentLocale();
  return (
    <>
      <SkipLink href="#conteudo">{t("skip.content", undefined, locale)}</SkipLink>
      <div className="plan-screen">
        <Header active="chat" />
        <Planner locale={locale} />
      </div>
    </>
  );
}
