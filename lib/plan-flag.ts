/** /plan and /api/plan exist only when MAIO_PLAN=1. Production chat is untouched. */
export function planEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MAIO_PLAN === "1";
}
