/**
 * "Open now", "closes at 2am", "opens at 6pm", from Qloo's opening hours.
 *
 * Qloo gives, per weekday, intervals like { opens: "T10:00:00", closes:
 * "T02:00:00" }. A close earlier than the open means past midnight, so a place
 * open until 2am on Friday is still open at 1am on Saturday. When a place has
 * no hours, it says so rather than guessing.
 */

import { localClock } from "./geo.js";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const mins = (t) => {
  const m = String(t || "").match(/T?(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (m) => {
  const h = Math.floor((m % 1440) / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${h % 12 || 12}${mm === "00" ? "" : `:${mm}`}${h < 12 ? "am" : "pm"}`;
};

/** Time zone for a place when the caller doesn't know the city: Lagos for Nigeria, else UTC. */
export function zoneFor(place, fallback = "UTC") {
  return place?.properties?.geocode?.country_code === "NG" ? "Africa/Lagos" : fallback;
}

export function openStatus(hours, now = new Date(), timeZone = "Africa/Lagos") {
  if (!hours || typeof hours !== "object" || !Object.keys(hours).length) return { known: false };
  const { hour, minute, weekday } = localClock(now, timeZone);
  const t = hour * 60 + minute;

  const spans = (day) =>
    (hours[DAYS[(day + 7) % 7]] || [])
      .filter((s) => !s.closed)
      .map((s) => {
        const o = mins(s.opens), c = mins(s.closes);
        if (o === null || c === null) return null;
        return { o, c: c <= o ? c + 1440 : c };
      })
      .filter(Boolean);

  // Still open from yesterday's late session?
  for (const s of spans(weekday - 1)) {
    if (s.c > 1440 && t < s.c - 1440) return status(true, s.c - 1440 - t, s.c);
  }
  for (const s of spans(weekday)) {
    if (t >= s.o && t < s.c) return status(true, s.c - t, s.c);
  }
  // Closed: when does it next open, today or in the coming week?
  for (let d = 0; d < 7; d++) {
    const later = spans(weekday + d).filter((s) => d > 0 || s.o > t).sort((a, b) => a.o - b.o)[0];
    if (later) return { known: true, open: false, opensAt: clock(later.o), opensIn: d === 0 ? later.o - t : null, opensDay: d === 0 ? "today" : d === 1 ? "tomorrow" : DAYS[(weekday + d) % 7] };
  }
  return { known: true, open: false, opensAt: null, closedAllWeek: true };

  function status(open, left, closeMin) {
    return { known: true, open, closesAt: clock(closeMin), minutesLeft: left, closingSoon: left <= 45 };
  }
}
