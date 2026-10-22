import { Section, SkipLink } from "maio-ui";
import { Footer, Header } from "../../components/site-shell";
import { t } from "../../lib/i18n";
import { currentLocale } from "../../lib/request-locale";
import { localize } from "../../lib/locale";
import { pageMetadata } from "../../lib/seo";

type Source = {
  id: string;
  title: string;
  attribution?: string;
  classification?: string;
  provenanceStatus?: string;
};

async function openDataSources(): Promise<Source[] | null> {
  try {
    const response = await fetch("https://api.maio.cv/api/v1/sources", {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { sources?: unknown };
    if (!Array.isArray(data.sources)) return null;
    return data.sources.filter((item): item is Source =>
      !!item && typeof item === "object" &&
      typeof item.id === "string" && typeof item.title === "string",
    );
  } catch {
    return null;
  }
}

export async function generateMetadata() {
  const locale = await currentLocale();
  return pageMetadata(
    t("meta.title.sources", undefined, locale),
    t("meta.description.sources", undefined, locale),
    localize(locale, "/sources"),
    locale,
  );
}

export default async function SourcesPage() {
  const locale = await currentLocale();
  const copy = (key: Parameters<typeof t>[0]) => t(key, undefined, locale);
  const sources = await openDataSources();
  const statusKeys: Record<string, Parameters<typeof t>[0]> = {
    "publication-link-missing": "sources.status.missing",
    "needs-review": "sources.status.review",
    "linked-source": "sources.status.linked",
  };
  const others = [
    { name: "INE Cabo Verde", url: "https://ine.cv/", description: copy("sources.ine") },
    { name: "CV Interilhas", url: "https://www.cvinterilhas.cv/routesschedules", description: copy("sources.ferry") },
    { name: "FlightMapper", url: "https://info.flightmapper.net/", description: copy("sources.flight") },
  ];

  return (
    <>
      <SkipLink href="#conteudo">{copy("skip.content")}</SkipLink>
      <Header />
      <main id="conteudo" className="source-page">
        <Section className="wrap source-intro">
          <p className="source-eyebrow">maio.cv</p>
          <h1>{copy("sources.title")}</h1>
          <p>{copy("sources.intro")}</p>
          <p className="source-caveat">{copy("sources.caveat")}</p>
        </Section>
        <Section className="wrap source-section">
          <div className="source-heading">
            <h2>{copy("sources.catalog")}</h2>
            <a href="https://api.maio.cv/api/v1/sources" target="_blank" rel="noopener noreferrer">{copy("sources.fullCatalog")} ↗</a>
          </div>
          {sources === null ? (
            <p>{copy("sources.unavailable")}</p>
          ) : (
            <div className="source-list">
              {sources.map(source => (
                <article className="source-item" key={source.id}>
                  <div>
                    <h3>{source.title}</h3>
                    {source.attribution && <p>{source.attribution}</p>}
                    {source.provenanceStatus && source.provenanceStatus !== "reviewed" &&
                      <small>{copy(statusKeys[source.provenanceStatus] ?? "sources.status.other")}</small>}
                  </div>
                  <a href={`https://api.maio.cv/api/v1/sources/${encodeURIComponent(source.id)}`}
                    target="_blank" rel="noopener noreferrer">{copy("sources.details")} ↗</a>
                </article>
              ))}
            </div>
          )}
        </Section>
        <Section className="wrap source-section source-section-last">
          <h2>{copy("sources.other")}</h2>
          <div className="source-list">
            {others.map(source => (
              <article className="source-item" key={source.name}>
                <div><h3>{source.name}</h3><p>{source.description}</p></div>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{copy("sources.visit")} ↗</a>
              </article>
            ))}
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}
