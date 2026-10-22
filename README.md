# MaioCV

Maio’s digital initiatives, FAQ, sources and conversational guide in Portuguese, English and French. Built with Next.js, local photography/fonts, and vendored Maio UI packages.

## Development

Use a Node.js version supported by Next.js (20.9 or newer; Node 24 supports the TypeScript test runner used below).

```sh
npm ci
npm run dev
node --test tests/*.test.ts
npm run build
```

Development runs at http://localhost:3007. To check the production build, run `npm run start -- --port 3017` after building. Browser installation and service-worker behavior should be checked against the production build or HTTPS deployment; registration is disabled in development.

## Deployment

Production: https://www.maio.cv

Vercel project: `maiocv`, team: `forkctokcs-projects`. Pushing the GitHub production branch `main` deploys production. The project root is this repository. `vercel.json` uses `npm ci` and `npm run build`.

## Routes and SEO

Pages use `/pt`, `/en` and `/fr` prefixes. `/` selects the saved or browser language. The FAQ is `/faq` within each language; the previous `/mcp` URL redirects there.

`lib/seo.ts` generates canonical links, language alternates, social cards and sitemap entries. Search pages remain crawlable with `noindex, follow` and are excluded from the sitemap. FAQ structured data uses the same translated questions shown on the page. Branded share images live in `public/social` and can be regenerated with `node scripts/generate-social-cards.mjs`.

## Home-screen installation and iOS

The footer has a localized Add to Home Screen control. Supported browsers open their installation prompt; other browsers show instructions. On iPhone/iPad, use Safari’s Share menu → Add to Home Screen. Installed mode uses the maio.cv touch icon, standalone display, theme color and safe-area spacing. Chat follows the visual viewport so its composer stays within the visible area when the keyboard opens; pinch zoom remains available.

`public/manifest.webmanifest` declares the app and its PNG/maskable icons. `components/service-worker-registration.tsx` registers `public/sw.js` in production. The worker caches only the offline message’s HTML, CSS and JavaScript. Pages, conversations and API responses are never cached. When disconnected, navigation shows a localized explanation that chat and live data need internet. Updates do not force-reload an active conversation. Bump the worker cache version when updating offline assets.

Before release, check small phone/landscape layouts, menu keyboard focus, locale switching, install guidance, and offline fallback. An actual iPhone/iPad is needed to verify native installation and keyboard behavior fully.

## Chat and data

`/api/maio-chat` proxies to `https://portal.maio.cv/api/chat`. Recent conversation remains in component memory. Follow-up buttons send the selected prompt with conversation context; answers can be saved as branded PDFs. Voice questions are transcribed by `/api/transcribe` through Vercel AI Gateway. API errors are displayed without invented fallback answers.

The `/sources` page reads the live registry at `https://api.maio.cv/api/v1/sources`. Initiative destinations are in `lib/content.ts`: VisitMaio, Portal de Dados, the Open Data API, and Maio in ChatGPT.

Framer Motion animations honor reduced-motion preferences. Above-the-fold photography is responsive through Next image optimization; PDF and optional OpenUI components load on demand.
