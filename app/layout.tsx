import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "../packages/maio-ui/maio-ui.css";
import { currentLocale } from "../lib/request-locale";
import { localeHtmlLang } from "../lib/locale";
import { SITE_URL, siteSchemaFor } from "../lib/seo";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";
const sans = localFont({
  src: [
    { path: "../packages/maio-tokens/fonts/PPNeueMontreal-Regular.woff2", weight: "400", style: "normal" },
    { path: "../packages/maio-tokens/fonts/PPNeueMontreal-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-pp",
  display: "swap",
});
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "maio.cv",
  appleWebApp: { capable: true, title: "maio.cv", statusBarStyle: "default" },
  icons: {
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  other: { "mobile-web-app-capable": "yes" },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  colorScheme: "light",
  themeColor: "#fbfbf8",
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await currentLocale();
  return (
    <html lang={localeHtmlLang(locale)} className={sans.variable}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteSchemaFor(locale)).replace(/</g, "\\u003c") }} />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
