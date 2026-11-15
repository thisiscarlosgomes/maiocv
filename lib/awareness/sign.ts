import { createHmac, timingSafeEqual } from "node:crypto";
import { emptyTask, parseTask, type Task, type TaskLocale } from "./task.ts";

/**
 * HMAC key for the planner task blob. The server is the only writer.
 * Set MAIO_TASK_SECRET in the environment. Never commit a real value.
 * Production (NODE_ENV or VERCEL_ENV = production) fails closed when it is unset.
 * Local development uses DEV_TASK_SECRET, which is not a secret.
 */
export const DEV_TASK_SECRET = "dev-only-maio-task-secret-not-for-production";

export type TaskEnv = Record<string, string | undefined>;

export function isProductionEnv(env: TaskEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/** The signing key, or null when production must refuse to sign. */
export function taskSecret(env: TaskEnv = process.env): string | null {
  const configured = env.MAIO_TASK_SECRET?.trim();
  if (configured) return configured;
  if (isProductionEnv(env)) return null;
  return DEV_TASK_SECRET;
}

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function signsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Sign a task. Throws in production when MAIO_TASK_SECRET is missing. */
export function signTask(task: Task, env: TaskEnv = process.env): string {
  const secret = taskSecret(env);
  if (!secret) throw new Error("MAIO_TASK_SECRET is required in production");
  const parsed = parseTask(task);
  if (!parsed) throw new Error("Refusing to sign an invalid task");
  const body = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

/**
 * Read a server-signed blob. Tampered, unsigned, or unverifiable blobs
 * become an empty task. Nothing is stored server-side and nothing is keyed by IP.
 */
export function readTask(blob: unknown, env: TaskEnv = process.env, locale: TaskLocale = "en"): Task {
  const blank = emptyTask(locale);
  const secret = taskSecret(env);
  if (!secret || typeof blob !== "string" || blob.length > 16_000) return blank;
  const dot = blob.lastIndexOf(".");
  if (dot <= 0) return blank;
  const body = blob.slice(0, dot);
  const sig = blob.slice(dot + 1);
  if (!signsMatch(sig, signature(body, secret))) return blank;
  try {
    const json: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return parseTask(json) ?? blank;
  } catch {
    return blank;
  }
}
