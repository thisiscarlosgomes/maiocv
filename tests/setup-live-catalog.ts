// Loaded with --import before every test file. Unit tests stub fetch and do not serve the tourism
// collection, so pin a listing of every bundled id. tests/live-catalog.test.ts unpins it.
import { bundledListings, primeLiveCatalog } from "../lib/live-catalog.ts";

primeLiveCatalog(bundledListings(), true);

// Unit tests never reach a real model. A developer shell with OPENAI_API_KEY set would otherwise
// send the intent classifier to OpenAI. eval:plan:live keeps the key.
if (process.env.PLAN_EVAL_LIVE !== "1") delete process.env.OPENAI_API_KEY;

// Nor do they reach Google Places or Parallel: outside lookups are tested with an explicit env.
if (process.env.PLAN_EVAL_LIVE !== "1") { delete process.env.GOOGLE_PLACES_API_KEY; delete process.env.PARALLEL_API_KEY; }
