import "server-only";
import { MongoClient } from "mongodb";
import { summarizeAnalytics, type MetricRow, type parseAnalyticsEvent } from "./analytics-model";
type StoredMetric = MetricRow & { _id: string; expiresAt: Date; firstSeenAt: Date };
let connection: Promise<MongoClient> | undefined;
let indexes: Promise<unknown> | undefined;
async function collection() {
  const uri = process.env.ANALYTICS_MONGODB_URI;
  if (!uri) throw new Error("Analytics storage not configured");
  connection ??= new MongoClient(uri, { maxPoolSize: 3, serverSelectionTimeoutMS: 5000 }).connect().catch(error => { connection = undefined; throw error; });
  const client = await connection;
  const col = client.db(process.env.ANALYTICS_MONGODB_DB || "maiocv_analytics").collection<StoredMetric>("daily_metrics");
  indexes ??= Promise.all([
    col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    col.createIndex({ day: 1 }),
  ]).catch(error => { indexes = undefined; throw error; });
  await indexes;
  return col;
}
export async function recordAnalytics(event: NonNullable<ReturnType<typeof parseAnalyticsEvent>>) {
  const now = new Date();
  const day = now.toISOString().slice(0,10);
  const col = await collection();
  await col.updateOne({ _id: `${day}:${event.event}:${event.page}:${event.locale}` }, {
    $inc: { count: 1 },
    $setOnInsert: { ...event, day, firstSeenAt: now, expiresAt: new Date(Date.parse(day) + 90 * 86400000) },
  }, { upsert: true });
}
export async function readAnalytics(length: number) {
  const today = new Date().toISOString().slice(0,10);
  const days = Array.from({ length }, (_, i) => new Date(Date.parse(today) - (length-1-i)*86400000).toISOString().slice(0,10));
  const col = await collection();
  const [rows, first] = await Promise.all([
    col.find({ day: { $gte: days[0], $lte: today } }).limit(20000).toArray(),
    col.findOne({}, { sort: { firstSeenAt: 1 } }),
  ]);
  return { ...summarizeAnalytics(rows, days), firstSeenAt: first?.firstSeenAt.toISOString() ?? null };
}