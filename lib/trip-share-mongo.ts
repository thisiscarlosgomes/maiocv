import { MongoClient, MongoServerError, type Collection } from "mongodb";
import type { TripShare, TripShareStore } from "./trip-share-store.ts";

type ShareDoc = Omit<TripShare, "id"> & { _id: string };

let connection: Promise<MongoClient> | undefined;
let indexes: Promise<unknown> | undefined;

async function collection(): Promise<Collection<ShareDoc>> {
  const uri = process.env.ANALYTICS_MONGODB_URI;
  if (!uri) throw new Error("unconfigured");
  connection ??= new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 5000 }).connect().catch((error) => {
    connection = undefined;
    throw error;
  });
  const client = await connection;
  const col = client.db(process.env.ANALYTICS_MONGODB_DB || "maiocv_analytics").collection<ShareDoc>("trip_shares");
  indexes ??= col.createIndex({ hash: 1 }, { unique: true }).catch((error) => {
    indexes = undefined;
    throw error;
  });
  await indexes;
  return col;
}

function toShare(doc: ShareDoc | null): TripShare | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

export function mongoTripShareStore(): TripShareStore {
  return {
    async byHash(hash) { return toShare(await (await collection()).findOne({ hash })); },
    async byId(id) { return toShare(await (await collection()).findOne({ _id: id })); },
    async insert(share) {
      const { id, ...rest } = share;
      try {
        await (await collection()).insertOne({ _id: id, ...rest });
        return null;
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          return JSON.stringify(error.keyPattern ?? {}).includes("hash") ? "hash" : "id";
        }
        throw error;
      }
    },
  };
}
