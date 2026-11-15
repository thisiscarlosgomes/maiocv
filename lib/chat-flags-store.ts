import { applyFlagIndexes, publicFlag, type FlagRecord, type FlagStatus } from "./chat-flags.ts";

export type FlagStore = {
  insert(record: FlagRecord): Promise<void>;
  list(since: Date, limit: number): Promise<FlagRecord[]>;
  update(id: string, patch: { status: FlagStatus; prUrl?: string }): Promise<boolean>;
};

let override: FlagStore | null = null;

export function setFlagStore(store: FlagStore | null) {
  override = store;
}

export function memoryFlagStore(): FlagStore & { rows: FlagRecord[] } {
  const rows: FlagRecord[] = [];
  return {
    rows,
    async insert(record) { rows.push(publicFlag(record)); },
    async list(since, limit) {
      return rows
        .filter((row) => Date.parse(row.createdAt) >= since.getTime())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map((row) => publicFlag(row));
    },
    async update(id, patch) {
      const row = rows.find((item) => item.id === id);
      if (!row) return false;
      row.status = patch.status;
      if (patch.prUrl) row.prUrl = patch.prUrl;
      return true;
    },
  };
}

async function store(): Promise<FlagStore> {
  if (override) return override;
  if (!process.env.ANALYTICS_MONGODB_URI) throw new Error("unconfigured");
  const mongo = await import("./chat-flags-mongo.ts");
  return mongo.mongoFlagStore();
}

/** Fire-and-forget. Missing config and write errors are ignored. */
export function recordFlag(record: FlagRecord, target?: FlagStore | null): void {
  const next = publicFlag(record);
  const chosen = target === undefined ? override : target;
  if (chosen) {
    void chosen.insert(next).catch(() => {});
    return;
  }
  if (!process.env.ANALYTICS_MONGODB_URI) return;
  void store().then((active) => active.insert(next)).catch(() => {});
}

export async function listFlags(since: Date, limit: number): Promise<FlagRecord[]> {
  const active = await store();
  return (await active.list(since, limit)).map((row) => publicFlag(row));
}

export async function updateFlag(id: string, patch: { status: FlagStatus; prUrl?: string }): Promise<boolean> {
  return (await store()).update(id, patch);
}

export { applyFlagIndexes };
