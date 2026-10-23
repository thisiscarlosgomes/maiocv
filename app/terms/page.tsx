import { LegalPage } from "../../components/legal-page";
import { legalContent } from "../../lib/legal-content";
import { currentLocale } from "../../lib/request-locale";
import { localize } from "../../lib/locale";
import { pageMetadata } from "../../lib/seo";

export async function generateMetadata() {
  const locale = await currentLocale();
  const { title, description } = legalContent[locale].terms;
  return pageMetadata(`${title} | MaioCV`, description, localize(locale, "/terms"), locale);
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
