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

## Planner task memory

`/plan` stays off unless `MAIO_PLAN=1`. When it is on, the concierge keeps a task (objective, scope, constraints, pending question, last places) apart from the chat transcript. The browser tab stores only a blob the server signed with HMAC-SHA256 (`sessionStorage` on www.maio.cv). The server is the only writer. A missing, tampered, or wrongly signed blob starts an empty task. The blob is not put in the URL; `?trip=` remains the shareable plan. Nothing about the task is stored on the server, and it is not keyed by IP.

Set `MAIO_TASK_SECRET` to a long random string in every deployed environment (`NODE_ENV=production`, including Vercel preview and production). Do not commit a value. If the variable is unset in production, signing fails closed and `/api/plan` will not return a task. In local development only, an unset variable uses the built-in marker `dev-only-maio-task-secret-not-for-production`, which is not a secret.

## Visitor guide (planner chat)

Visitor questions in `/plan` (what to do, where to eat near X, beaches, getting here, no-car days) go to one agent in `lib/visitor/`. The planner's plan building, plan edits, the car question for a plan, ferry/flight timetable answers, stays lists, emergency numbers and business phones keep their scripted, data-built answers (`lib/visitor/route.ts` decides).

- `background.ts`: hand-written Maio background, always first in the system prompt (cacheable prefix). Facts come from api.maio.cv or a named source; anything uncertain is marked "(unverified)".
- `places.ts`: every place the guide may name, read from api.maio.cv (tourism + businesses collections; 10-minute cache, 1-hour stale fallback, nothing bundled). Each place gets a village from its coordinates, or from its location text when it has none (`approx`).
- `geo.ts`: haversine distance, rough walking/driving minutes, village anchors from the API settlements.
- `agent.ts`: one `generateText` loop with `places_nearby` (distance-ranked, radius 3 km without a car, 6 km unknown, island-wide with a car), `place_details`, `get_transport`, `get_maio_weather`, `find_business`. The reply comes back with `cards` for the listed places it names; `/plan` shows them above the text.

Evals: `npm run eval:visitor` runs ~100 visitor questions in-process (needs `OPENAI_API_KEY`); `npm run eval:visitor:url -- https://<preview>` runs them against a deployment (`VERCEL_BYPASS_SECRET` for protected previews). Each case checks the reply answers the question (LLM judge), does not lead with a question or the car question, does not start a plan, names only places in the Maio API, and keeps nearby answers in the guest's area. `VISITOR_TURN_MS` (default 9000) bounds the guide turn; on timeout the planner's scripted answers reply.

## Chat and data

`/api/maio-chat` answers Ask Maio in this app. It reads boats, flights, businesses, accommodation, and experiences from `https://api.maio.cv/api/v1`, and uses the Vercel AI Gateway model the planner uses for open questions. It does not call portal.maio.cv. Recent conversation remains in component memory. Follow-up buttons send the selected prompt with conversation context; answers can be saved as branded PDFs. Voice questions are transcribed by `/api/transcribe` through Vercel AI Gateway. API errors are displayed without invented fallback answers.

Flagged planner and Ask Maio turns are stored in MongoDB collection `chat_flags` (same `ANALYTICS_MONGODB_URI` / `ANALYTICS_MONGODB_DB`, 30-day TTL). Only failed checks, thumbs-down, and failed judge grades are written. Nothing is stored for a clean turn. The record has no IP, user agent, cookie, or user id. `FLAGS_ADMIN_KEY` (Bearer, at least 16 characters) guards `GET /api/flags` and `PATCH /api/flags/:id`. `MAIO_JUDGE=1` turns the grader on (`0` turns it off; production defaults to on). `MAIO_JUDGE_RATE` defaults to `1`. `MAIO_JUDGE_DAILY_CAP` defaults to `2000`. `MAIO_JUDGE_MODEL` defaults to `openai/gpt-5-nano`. The grader runs after the reply via Next.js `after()` and stores a row only when it returns `ok: false`.

The `/sources` page reads the live registry at `https://api.maio.cv/api/v1/sources`. Initiative destinations are in `lib/content.ts`: VisitMaio, Portal de Dados, the Open Data API, and Maio in ChatGPT.

Framer Motion animations honor reduced-motion preferences. Above-the-fold photography is responsive through Next image optimization; PDF and optional OpenUI components load on demand.
