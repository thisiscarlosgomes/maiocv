import { createHash, timingSafeEqual } from "node:crypto";
export function analyticsAuthorized(authorization: string | null, secret = process.env.ANALYTICS_ADMIN_KEY) {
  if (!secret || secret.length < 32 || !authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(decoded), digest(`admin:${secret}`));
  } catch { return false; }
}
