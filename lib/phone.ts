/**
 * Cape Verde numbers are seven local digits. "5974467" and "00238 597 44 67"
 * both become "+238 597 44 67". Anything else is left as written.
 */
export function formatCapeVerdePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("00238")) local = local.slice(5);
  else if (local.startsWith("238") && local.length > 7) local = local.slice(3);
  if (local.length !== 7) return raw.trim();
  return `+238 ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5)}`;
}
