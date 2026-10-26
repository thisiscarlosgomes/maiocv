// What changed between two plan versions, for the "N changes · Undo" note and the Updated tags.
import type { Locale } from "./locale.ts";
import type { PlanItem, TripPlan } from "./trip.ts";
import type { PlanStrings } from "./trip-strings.ts";
import { cardView, dayTitle } from "./trip-view.ts";

export type PlanChanges = { ids: string[]; firstDay: number; summary: string; details: string[] };

export function describeChanges(prev: TripPlan, next: TripPlan, locale: Locale, s: PlanStrings): PlanChanges | null {
  const where = (p: TripPlan) => new Map(p.days.flatMap((d, di) => d.items.map((i) => [i.id, { day: di, item: i }] as const)));
  const a = where(prev), b = where(next);
  const title = (i: PlanItem) => cardView(i, locale, s)?.title ?? i.refId;
  const ids: string[] = [], details: string[] = [], days: number[] = [];
  for (const [id, now] of b) {
    const was = a.get(id);
    if (!was) { ids.push(id); days.push(now.day); details.push(s.added(title(now.item))); continue; }
    if (was.item.refId !== now.item.refId) details.push(s.swapped(title(was.item), title(now.item)));
    else if (was.day !== now.day) details.push(s.movedDay(title(now.item), dayTitle(next.days[now.day].date, locale)));
    else if (was.item.start !== now.item.start) details.push(s.moved(title(now.item), now.item.start));
    else continue;
    ids.push(id); days.push(now.day);
  }
  for (const [id, was] of a) if (!b.has(id)) { days.push(Math.min(was.day, next.days.length - 1)); details.push(s.removed(title(was.item))); }
  if (!details.length) return null;
  const uniqueDays = [...new Set(days)];
  const dayName = uniqueDays.length === 1 ? dayTitle(next.days[uniqueDays[0]].date, locale) : s.daysN(uniqueDays.length);
  return { ids, firstDay: Math.min(...days), summary: s.changes(details.length, dayName), details };
}
