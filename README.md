# MaioCV

A Portuguese landing page and dedicated `/mcp` experience for Maio's digital initiatives. Standalone Next.js server build with local photography, fonts, and vendored Maio UI packages. Chat is proxied to the portal.

Use Node.js 20.9 or newer (the app includes `.nvmrc` for Node 20). From this repository root:

```sh
npm run dev
npm run build
npm run typecheck
```

Development: http://localhost:3007. Production output: `.next`.

## Hosting

Set the Vercel project's root directory to the repository root. `vercel.json` installs with `npm ci` and builds with `npm run build`. Run `npm run build && npm run start` for a self-hosted production server.

Initiative URLs live in `app/page.tsx`: API at https://api.maio.cv, Portal de Dados at https://portal.maio.cv, and VisitMaio at https://visitmaio.com. These are the initiative destinations specified for MaioCV.

Images are copied into `public/slideshow/`; fonts are vendored in `packages/maio-tokens/fonts`. No external assets are fetched at runtime.

## Vercel production deployments

Production: https://maiocv.vercel.app

Project: `maiocv`, team: `forkctokcs-projects`. The project is linked to this GitHub repository. Pushing `main` deploys production. `npm run vercel:prepare` checks that `next.config.ts` is not a static export.

To verify locally with Node 20.9+:

```sh
npm ci
npm run typecheck
node --test tests/*.test.ts
npm run build
```

## UI and MCP demo

The homepage introduces VisitMaio, Portal de Dados, Open Data API and Maio in ChatGPT. Shared navigation and the footer are in `components/site-shell.tsx`; initiative URLs and the provided ChatGPT plugin URL are in `lib/content.ts`.

`/mcp` submits real questions to `/api/maio-chat`, proxied to `https://portal.maio.cv/api/chat`. This existing backend uses the same `executeMaioTool` registry as the MCP server, including open-data tools; the landing page does not directly speak MCP. Credentials stay in the backend. Requests ask for at most 60 words or three short points. The three exact preset questions return prepared answers immediately; custom questions use the API. The per-user daily quota has been removed in both shared API copies; that change requires deploying the dashboard backend. Recent conversation stays in component memory and is cleared when switching topics. Errors, timeouts and rate limits are shown without fabricated fallback answers.

`/api/maio-chat` is a Next.js rewrite to `https://portal.maio.cv/api/chat` in development and in the server build.

The opt-in OpenUI pilot is at `/chat?openui=1`. When the assistant uses the `business-demography` dataset, the client reads its published total row from `api.maio.cv` and renders a sourced metric card with OpenUI. The text answer remains the fallback if the visual data cannot be loaded. Normal `/chat` stays text-only while the pilot is evaluated.

Framer Motion powers viewport section reveals, initiative card interactions and demo transitions. Reduced-motion preferences skip movement. Content remains visible in the server-rendered HTML.

For a local development server on port 3001, run `npm run dev -- --port 3001`.
