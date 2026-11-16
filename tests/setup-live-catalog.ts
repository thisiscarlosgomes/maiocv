// Loaded with --import before every test file. Unit tests stub fetch and do not serve the tourism
// collection, so pin a listing of every bundled id. tests/live-catalog.test.ts unpins it.
import { bundledListings, primeLiveCatalog } from "../lib/live-catalog.ts";

primeLiveCatalog(bundledListings(), true);
