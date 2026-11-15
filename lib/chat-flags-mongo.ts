import { MongoClient, type Collection } from "mongodb";
import { applyFlagIndexes, publicFlag, type FlagRecord, type FlagStatus } from "./chat-flags.ts";
import type { FlagStore } from "./chat-flags-store.ts";

type FlagDoc = Omit<FlagRecord, "createdAt" | "id"> & { _id: string; createdAt: Date };

let connection: Promise<MongoClient> | undefined;
let indexes: Promise<unknown> | undefined;

async function collection(): Promise<Collection<FlagDoc>> {
  const uri = process.env.ANALYTICS_MONGODB_URI;
  if (!uri) throw new Error("unconfigured");
  connection ??= new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 5000 }).connect().catch((error) => {
    connection = undefined;
    throw error;
  });
  const client = await connection;
  const col = client.db(process.env.ANALYTICS_MONGODB_DB || "maiocv_analytics").collection<FlagDoc>("chat_flags");
  indexes ??= applyFlagIndexes(col).catch((error) => {
    indexes = undefined;
    throw error;
  });
  await indexes;
  return col;
}

function toRecord(doc: FlagDoc): FlagRecord {
  const { _id, createdAt, ...rest } = doc;
  return publicFlag({ ...rest, id: _id, createdAt: createdAt.toISOString() });
}

export function mongoFlagStore(): FlagStore {
  return {
    async insert(record) {
      const col = await collection();
      const stored = publicFlag(record);
      const { id, createdAt, ...rest } = stored;
      await col.updateOne({ _id: id }, { $setOnInsert: { _id: id, createdAt: new Date(createdAt), ...rest } }, { upsert: true });
    },
    async list(since, limit) {
      const col = await collection();
      const docs = await col.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(limit).toArray();
      return docs.map((doc) => toRecord(doc));
    },
    async update(id, patch) {
      const col = await collection();
      const set: { status: FlagStatus; prUrl?: string } = { status: patch.status };
      if (patch.prUrl) set.prUrl = patch.prUrl;
      const result = await col.updateOne({ _id: id }, { $set: set });
      return result.matchedCount > 0;
    },
  };
}

type BudgetDoc = {
  _id: string;
  count: number;
  createdAt: Date;
  calls?: number;
  failures?: number;
  flags?: number;
  skips?: number;
  lastError?: string | null;
};

export type JudgeDayStats = { calls: number; failures: number; flags: number; skips?: number; lastError: string | null };

let budgetIndexes: Promise<unknown> | undefined;

async function budgetCollection() {
  const uri = process.env.ANALYTICS_MONGODB_URI;
  if (!uri) throw new Error("unconfigured");
  connection ??= new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 5000 }).connect().catch((error) => {
    connection = undefined;
    throw error;
  });
  const client = await connection;
  const col = client.db(process.env.ANALYTICS_MONGODB_DB || "maiocv_analytics").collection<BudgetDoc>("chat_flag_budget");
  budgetIndexes ??= col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 }).catch((error) => {
    budgetIndexes = undefined;
    throw error;
  });
  await budgetIndexes;
  return col;
}

function duplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
}

/** Shared daily counter so the judge cap holds across serverless isolates. */
export async function consumeJudgeBudget(day: string, cap: number): Promise<boolean> {
  if (cap < 1) return false;
  const col = await budgetCollection();
  const id = `judge:${day}`;
  const updated = await col.findOneAndUpdate({ _id: id, count: { $lt: cap } }, { $inc: { count: 1 } }, { returnDocument: "after" });
  if (updated) return true;
  try {
    await col.insertOne({ _id: id, count: 1, createdAt: new Date(`${day}T00:00:00.000Z`) });
    return true;
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    const again = await col.findOneAndUpdate({ _id: id, count: { $lt: cap } }, { $inc: { count: 1 } }, { returnDocument: "after" });
    return Boolean(again);
  }
}

/** Daily judge counters shared by every instance. Missing fields count as zero. */
export async function readJudgeHealth(day: string): Promise<JudgeDayStats | null> {
  if (!process.env.ANALYTICS_MONGODB_URI) return null;
  const col = await budgetCollection();
  const doc = await col.findOne({ _id: `judge:${day}` });
  if (!doc) return { calls: 0, failures: 0, flags: 0, skips: 0, lastError: null };
  return { calls: doc.calls ?? 0, failures: doc.failures ?? 0, flags: doc.flags ?? 0, skips: doc.skips ?? 0, lastError: doc.lastError ?? null };
}

export async function bumpJudgeHealth(day: string, event: "call" | "failure" | "flag" | "skip", errorType?: string | null): Promise<void> {
  const col = await budgetCollection();
  const inc = event === "call" ? { calls: 1 } : event === "failure" ? { failures: 1 } : event === "skip" ? { skips: 1 } : { flags: 1 };
  await col.updateOne(
    { _id: `judge:${day}` },
    {
      $inc: inc,
      ...(event === "failure" && errorType ? { $set: { lastError: errorType.slice(0, 40) } } : {}),
      $setOnInsert: { createdAt: new Date(`${day}T00:00:00.000Z`), count: 0 },
    },
    { upsert: true },
  );
}
