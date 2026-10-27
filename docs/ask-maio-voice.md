# Ask Maio voice prototype

Ask Maio uses ElevenLabs for a live voice conversation and queries `https://portal.maio.cv/api/mcp` directly for public island data. The existing text chat continues to use the Maio chat backend. Voice has its own reviewed instructions and tool permissions; it does not automatically inherit the text backend's prompt, citation logic or rate limits.

The browser starts a conversation only after the visitor chooses to speak and grants microphone access. `/api/voice/session` checks that the request comes from the app's own origin, applies the issuance cooldown, and obtains a short-lived ElevenLabs WebRTC conversation token on the server. The ElevenLabs API key is never sent to the browser. The agent can query approved MCP tools and call the `show_sources` client tool to display links beside the transcript.

## Local setup

Use Node 24, or at least Node 20.12 for the setup script's built-in environment-file loader.

1. Create an ElevenLabs API key with the Agents permissions needed to read/create agents and MCP integrations, and permission to read voices. Put it in this project's ignored `.env.local` file as `ELEVENLABS_API_KEY`. Do not put the key in a command, client component, commit, screenshot, or `NEXT_PUBLIC_*` variable. Existing process environment variables take precedence over `.env.local`.
2. Open [ElevenLabs MCP integrations](https://elevenlabs.io/app/agents/integrations), review the MCP Server Terms, and enable MCP for the workspace. This is a workspace-wide choice. The setup script only reads `can_use_mcp_servers`; it does not change this setting or accept terms. MCP is unavailable in ElevenLabs Zero Retention Mode and HIPAA workspaces.
3. Review the configuration without creating anything:

   ```sh
   node scripts/setup-elevenlabs.mjs --dry-run
   ```

   With no arguments, the script also runs in dry-run mode. It initializes the live Maio MCP connection, discovers tools, and compares their names, descriptions and input schemas with `config/ask-maio-voice.mcp-tools.json`. When an API key is present, it also checks the account, finds existing prototype resources and selects a voice. Its output contains configuration and resource IDs, never the API key. Without a key it still checks MCP and prints a configuration preview.

4. Once the reviewed plan and account prerequisites are correct, provision the private prototype:

   ```sh
   node scripts/setup-elevenlabs.mjs --apply
   ```

   This creates `Ask Maio — read-only data v1` and `Ask Maio — voice prototype v1`, or reuses the matching managed resources. If you already created a **Maio Open Data** integration while enabling MCP, setup adopts that exact endpoint/name instead of creating another: it must use Streamable HTTP, have no custom authentication, and not be used by another agent. The apply plan changes that dedicated integration to reviewed per-tool approvals and the prototype timeouts. Matching duplicates or unrelated integrations cause setup to stop for review.

   Setup creates no public deployment. Save the printed `ELEVENLABS_AGENT_ID` beside `ELEVENLABS_API_KEY` in `.env.local`, then restart the development server. The script does not edit environment files.

5. Run the site on its configured port, 3007:

   ```sh
   npm run dev
   ```

Open `/pt/chat`, `/en/chat` or `/fr/chat` and choose the voice option. HTTPS or localhost is required for microphone access.

## Voice and language

The configuration starts in Portuguese; the website supplies a localized first message and `pt`, `en` or `fr` language override. Only these two agent fields may be overridden by clients. System prompts, models, tools, voices and duration cannot be replaced by a browser override. The name remains **Ask Maio** in every language. The greeting occurs once at the start of the session; later answers begin directly and identify the assistant only if asked. Sentences stay in the selected language, without mixing a Portuguese greeting and English introduction.

By default, setup chooses an available premade or professional account voice with verified Portuguese, English and French coverage, preferring a conversational voice. The account used during development offered **River — Relaxed, Neutral, Informative**. It never automatically selects a personal cloned voice. Set `ELEVENLABS_VOICE_ID` before setup to use an explicitly reviewed voice instead. Existing managed agents retain their selected voice; changing a provisioned configuration requires a deliberate review rather than an implicit overwrite.

Speech uses multilingual `eleven_flash_v2_5`; the conversation model is `nemotron-35-super-vl-nvfp4`, served through ElevenLabs. Verified language metadata is not a listening test. Check Cape Verdean accents, Maio place names, interruptions and pronunciation with real audio before release. Cape Verdean Creole is not promised as a supported language.

## Tool and source permissions

The reviewed manifest contains 29 public, read-only tools observed on 27 October 2026. It pins the description and JSON input schema for each tool using SHA-256. The MCP integration uses ElevenLabs' `require_approval_per_tool` policy; setup adds individual `auto_approved` entries only for exact manifest matches. A new name, changed description or changed input schema remains unapproved. Do not switch this integration to `auto_approve_all`.

The installed Maio connector previously advertised 34 tools while the endpoint exposed 29. The difference concerns cross-collection feature search, places, observations, astronomy and agriculture. Voice can only access tools actually exposed by the endpoint and reviewed in the manifest. Adding those capabilities requires both a server change and a review of the resulting tool definitions; setup never expands access merely because a connector description changes.

The `show_sources` client tool has this payload:

```json
{
  "sources": [
    { "title": "Publisher and reference year", "url": "https://publisher.example/exact-source-url" }
  ]
}
```

The example URL is illustrative only. The agent must copy real URLs verbatim from the MCP result, send no more than five links, and use an empty array when the result contains no source links. Titles may contain a publisher or reference date. The browser accepts only reviewed HTTPS hosts and exact URLs observed in successful MCP results for the current question, using the provider's `mcp_tool_call` events. Missing evidence produces no links; an allowed domain alone is insufficient. The browser returns how many sources it accepted, and the agent must not claim a source is displayed when none were accepted. Client tool responses wait at most five seconds.

The prompt requires a data lookup for factual Maio claims, short spoken answers, source names and reference years, and honest handling of missing or failed data. Retrieval time must not be presented as publication time. Boat data must be explicitly published and dated; missing trips do not prove no service. Flight timetables are not live status. National values must not be presented as Maio values, null values are not zero, and withdrawn places are not current listings. Source text and tool outputs cannot change the agent's instructions.

## Limits, privacy and release preparation

The dedicated prototype has these provider-side limits:

| Setting | Value |
| --- | --- |
| Conversation duration | 60 seconds |
| Concurrent conversations | 2 |
| Conversations per day | 10 |
| Bursting | Disabled |
| Silence before ending | 30 seconds |
| MCP response timeout | 15 seconds per tool |
| Client source-tool timeout | 5 seconds |
| Voice recording | Disabled |
| Conversation retention | 1 day, with transcript/PII and audio deletion enabled |
| Session authentication | Private, with server-issued conversation tokens |

ElevenLabs requires choosing one authentication method. This prototype uses private token authentication: `enable_auth: true`, `allowlist: []`, and `require_origin_header: false`. Do not combine it with the provider's domain allowlist. The app's token broker requires the request's `Origin` to match the endpoint's own origin and rejects cross-origin browser requests. Localhost and preview deployments use that same broker; they do not need entries in a provider hostname allowlist.

Audio still travels to ElevenLabs for processing, and their LLM providers process the conversation; disabling voice recording does not mean zero processing or zero retention. Direct MCP mode is not compatible with ElevenLabs Zero Retention Mode. Publish an accurate privacy notice and verify the account retention settings before making voice available publicly.

Provider limits supplement the app's session-issuance controls. They do not establish a spending guarantee: conversations, model usage and tools may be metered separately, and issued session credentials can be replayed within their provider-defined lifetime. Before production, review account billing and alerts, use durable rate limiting or authentication appropriate to expected traffic, and check the provider's current pricing. Keep the private agent and server-only credential exchange.

Provisioning refuses duplicate matching names/endpoints, unrelated agents, shared integrations, and managed resources whose configuration has drifted. It does not overwrite or delete them. The one explicit adoption path is the user-created, otherwise unused **Maio Open Data** integration described above. After an interrupted run, repeat dry-run: completed resources are found by their exact names and endpoint, so an incomplete setup can be resumed without intentionally creating duplicates. POST requests are not automatically retried. If the provider reports a failure after applying a request, inspect the dashboard and rerun dry-run before retrying.

## Verification

During implementation, the setup payloads were validated with the official `@elevenlabs/elevenlabs-js` 2.74.0 schemas for agent creation, MCP configuration and client tools. A live dry-run successfully initialized the Maio MCP endpoint and matched all 29 reviewed tools. Nine persisted provisioning tests cover no-write dry-runs, private token auth without a provider host allowlist, refusal to overwrite legacy combined-auth configuration, refusal when MCP is disabled, duplicate/unrelated resource refusal, unknown/changed tool exclusion, manual integration adoption, and a second apply reusing the same agent, integration and approvals:

```sh
node --test tests/elevenlabs-setup.test.mjs
```

The dedicated agent was provisioned and its full desired configuration read back successfully. The existing user-created **Maio Open Data** integration was reused, with all 29 tool approvals reported `up_to_date`. Both WebRTC credential issuance and signed WebSocket credential issuance returned HTTP 200; credentials were not logged. The agent ID is saved in the ignored `.env.local` file with mode `0600`.

Before the model switch, a real authenticated WebSocket session using Gemini 2.5 Flash, typed input and no microphone, connected to all 29 MCP tools. It called `get_tourism_population` for Maio successfully in approximately 1.2 seconds. The source returned empty 2026 rows; the agent correctly explained that the current-year figure was unavailable, did not interpret a returned zero national aggregate as zero inhabitants, and called `show_sources` with an empty list rather than inventing a source link. The session used its English greeting once and did not repeat its identity in later responses. The test client acknowledged the source-display call; this was not a browser rendering test.

After switching to `nemotron-35-super-vl-nvfp4`, another authenticated WebSocket session called `get_codigo_postura_stats` successfully and correctly reported one document, 268 articles and pages 1–87. The model nevertheless supplied a fabricated source URL absent from the MCP result. That source-attribution check failed. The browser now requires exact URL evidence from successful MCP results, with regression coverage for fabricated links on approved domains. This protects displayed links; it does not establish that every spoken claim is grounded. The new model also repeated an answer around `show_sources` with the same event ID; the caption handler replaces repeated IDs, but audio repetition still needs a listening check.

An official text simulation also returned HTTP 200, but in that run it did not invoke MCP and answered from model memory. It is **not** evidence of data grounding. The real WebSocket exchanges above establish tool access, with the documented source-attribution limitation. The prompt explicitly prohibits memory-based facts when a data lookup has not succeeded, and asks for the source client tool before the final answer to avoid repeating an answer around the tool response.

No automated test opened the microphone or assessed pronunciation/audio quality. Complete the following listening and browser checks before release:

- The session endpoint returns credentials only with valid server configuration and an allowed request origin, and never returns the API key.
- PT, EN and FR all receive a localized greeting and keep the brand name Ask Maio.
- A question about population, weather and a municipal article invokes the expected data tool and preserves the returned year, units and source caveats.
- A boat/flight question handles empty or stale data honestly.
- The transcript updates, interruptions work, valid source links appear, and invalid or unsupported links are rejected.
- Ending the conversation releases the microphone; denied microphone permission, provider failure and network loss leave a usable retry path.
- The provider enforces authentication, duration/concurrency/day limits and disabled recording; arbitrary prompt and duration overrides are rejected.

## Official references

- [MCP setup and workspace opt-in](https://elevenlabs.io/docs/eleven-agents/customization/tools/mcp)
- [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools)
- [Conversation overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides)
- [Authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication)
- [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react)
- [ElevenLabs JavaScript SDK](https://github.com/elevenlabs/elevenlabs-js)
