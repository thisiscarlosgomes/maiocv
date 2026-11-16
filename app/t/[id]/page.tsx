import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { SkipLink } from "maio-ui";
import { Header } from "../../../components/site-shell";
import { Planner } from "../../../components/plan/planner";
import { planEnabled } from "../../../lib/plan-flag";
import { t } from "../../../lib/i18n";
import { isLocale, localize, type Locale } from "../../../lib/locale";
import { pageMetadata, SITE_URL } from "../../../lib/seo";
import { loadSharedTrip, tripShareStore } from "../../../lib/trip-share-store";
import { planStrings } from "../../../lib/trip-strings";
import { dateRange } from "../../../lib/trip-view";

type Props = { params: Promise<{ id: string }> };

// One read per request, shared by the metadata and the page.
const load = cache(async (id: string) => {
  try { return await loadSharedTrip(await tripShareStore(), id); } catch { return null; }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const shared = await load(id);
  if (!shared) return { title: "maio.cv", robots: { index: false, follow: false } };
  const { plan } = shared;
  const locale = await viewLocale(shared.locale);
  const s = planStrings[locale];
  const stops = plan.days.reduce((sum, day) => sum + day.items.filter((item) => item.kind !== "transport").length, 0);
  const title = `${plan.title} · maio.cv`;
  const summary = `${dateRange(plan.days, locale)} · ${stops} ${s.stops}`;
  const base = pageMetadata(title, summary, "/plan", locale);
  const url = `${SITE_URL}/t/${id}`;
  return {
    ...base,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: { ...base.openGraph, url },
  };
}

/** /en/t/<id> shows that language. The bare /t/<id> link uses the language the trip was shared in. */
async function viewLocale(fallback: Locale): Promise<Locale> {
  const header = (await headers()).get("x-maio-lang");
  return isLocale(header) ? header : fallback;
}

/** Short share link: the stored plan in the same read-only view the long ?trip=…&view=1 link opens. */
export default async function SharedTripPage({ params }: Props) {
  if (!planEnabled()) notFound();
  const { id } = await params;
  const shared = await load(id);
  if (!shared) notFound();
  const prefixed = (await headers()).get("x-maio-lang");
  // Bare maio.cv/t/<id>: move to the trip's language so the site chrome matches the plan.
  if (!isLocale(prefixed)) redirect(localize(shared.locale, `/t/${id}`));
  const locale = prefixed;
  return (
    <>
      <SkipLink href="#conteudo">{t("skip.content", undefined, locale)}</SkipLink>
      <div className="chat-screen plan-screen">
        <Header active="chat" />
        <Planner locale={locale} sharedPlan={shared.plan} />
      </div>
    </>
  );
}
