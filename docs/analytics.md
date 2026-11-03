# Private analytics

`/pt/analytics` (also `/analytics`, redirected to Portuguese) is a private, dynamic admin dashboard. It requires HTTP Basic authentication: username `admin`, password `ANALYTICS_ADMIN_KEY`. Use HTTPS outside localhost. The server checks authentication both in the proxy and in the page; missing or short keys fail closed. No credentials are sent to the browser bundle. To rotate access, replace the environment key. The browser remembers Basic credentials for its session; close the browser session to discard them.

## Configuration

- `ANALYTICS_ADMIN_KEY`: a random key of at least 32 characters; generate with `openssl rand -hex 32`. The local key is already in ignored `.env.local`.
- `ANALYTICS_MONGODB_URI`: server-only MongoDB connection with read/write/index permissions on the analytics database.
- `ANALYTICS_MONGODB_DB`: defaults to `maiocv_analytics`; local development uses `maiocv_analytics_dev` to keep QA traffic separate.

Provision these in the target deployment environment before releasing. Never commit credentials. The application creates a TTL index on `expiresAt` and a day index. MongoDB removes aggregate rows after approximately 90 days (TTL deletion is asynchronous).

## Metrics

First-party `POST /api/analytics` accepts an allowlisted event and a known pathname only. It requires a matching Origin, bounds request size and does not retain IPs, user agents, user identifiers, query strings, questions, answers, referrers or recordings. Dimensions: UTC day, canonical page, language and event. Atomic increments keep concurrent visits accurate.

- `pageview`: each browser route change or reload, excluding private/unknown routes.
- `chat_answer`: an API-backed answer presented in Ask Maio; local example/greeting shortcuts are excluded.
- `voice_connected`: the provider reports a connected session, not completed calls or successful answers.
- `plan_generated`: a newly accepted structured plan, not a clarification response.

These browser signals are approximate, not an audited server ledger. Bots or forged events can inflate counts; blockers and privacy signals can reduce them. Do not interpret views as unique visitors. No pre-installation backfill. Historic chat/call logs are not imported or mixed into this dataset.

Vercel Web Analytics is also installed for its own traffic dashboard. Its totals are separate. Query strings/fragments and private paths are excluded via `beforeSend`. Both collectors respect Do Not Track and Global Privacy Control. The local dashboard links to Vercel rather than relying on an undocumented data export API.

## Verification

Run `node --test tests/analytics.test.ts`, `npm run typecheck`, and `npm run build`. Verify unauthenticated `/pt/analytics` returns 401 with a Basic challenge; authenticated requests return the dashboard. Invalid/cross-origin collection requests are rejected. Check an accepted event increments its matching daily row. Keep QA traffic in the development database.
