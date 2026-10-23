import { Section, SkipLink } from "maio-ui";
import { Footer, Header } from "./site-shell";
import { legalContent } from "../lib/legal-content";
import { t } from "../lib/i18n";
import { currentLocale } from "../lib/request-locale";

export async function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const locale = await currentLocale();
  const copy = legalContent[locale];
  const document = copy[kind];
  return (
    <>
      <SkipLink href="#conteudo">{t("skip.content", undefined, locale)}</SkipLink>
      <Header />
      <main className="legal-page wrap" id="conteudo">
        <Section className="legal-hero">
          <p className="legal-updated">{document.updated}</p>
          <h1>{document.title}</h1>
          <p className="legal-intro">{document.intro}</p>
        </Section>
        <div className="legal-sections">
          {document.sections.map((section) => (
            <Section className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </Section>
          ))}
          <Section className="legal-section legal-contact">
            <h2>{copy.contactLink}</h2>
            <p>{document.contact} <a href="https://maioazul.com/">maioazul.com</a></p>
            {kind === "privacy" ? <p><a href="https://www.cnpd.cv/direitos/" target="_blank" rel="noopener noreferrer">{copy.rightsLink} ↗</a></p> : null}
          </Section>
        </div>
      </main>
      <Footer />
    </>
  );
}
