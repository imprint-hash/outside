/**
 * Distances and travel time, in any city.
 *
 * Kilometres lie in a city: 4 km at rush hour can take far longer than 4 km at
 * midnight. So a pick says how long it takes to get there at this hour, in the
 * city's own time, as an estimate. Lagos gets one extra rule, because crossing
 * between the Island and the Mainland at the wrong hour can take an hour and
 * a half; other cities use a plain rush-hour estimate.
 */

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** Metres between two { lat, lon } points. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Areas a visitor names instead of an address, Airbnb hosts especially. */
export const LAGOS_AREAS = {
  "victoria island": { lat: 6.4281, lon: 3.4219, side: "island" },
  ikoyi: { lat: 6.4474, lon: 3.4346, side: "island" },
  oniru: { lat: 6.4344, lon: 3.45, side: "island" },
  "lekki phase 1": { lat: 6.4478, lon: 3.4723, side: "island" },
  lekki: { lat: 6.4478, lon: 3.4723, side: "island" },
  "lagos island": { lat: 6.4541, lon: 3.3947, side: "island" },
  ikeja: { lat: 6.6018, lon: 3.3515, side: "mainland" },
  "ikeja gra": { lat: 6.5788, lon: 3.35, side: "mainland" },
  yaba: { lat: 6.5095, lon: 3.3711, side: "mainland" },
  surulere: { lat: 6.5003, lon: 3.3539, side: "mainland" },
};

export function inLagos(p) {
  return p.lat > 6.35 && p.lat < 6.75 && p.lon > 3.05 && p.lon < 3.75;
}

/**
 * Island or Mainland. The lagoon runs roughly along the line from Lagos Island
 * to Ikoyi, so south of ~6.47 (east of 3.38) is Island side. Good enough to
 * warn about a bridge crossing, not a survey.
 */
export function lagosSide(p) {
  if (!inLagos(p)) return null;
  return p.lat < 6.47 && p.lon > 3.38 ? "island" : "mainland";
}

/** Hour of day (0–23) and weekday (0 = Sunday) in a time zone. */
export function localClock(now = new Date(), timeZone = "Africa/Lagos") {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday: days[get("weekday")] };
}

/**
 * The next time the local clock in `timeZone` reads `hour`:00, strictly after
 * `now` (at 06:00 exactly, that's tomorrow's 06:00). Check-ins expire then, and
 * "tonight" runs until then.
 */
export function nextLocalHour(now = new Date(), timeZone = "UTC", hour = 6) {
  const { hour: h, minute } = localClock(now, timeZone);
  const t = h * 60 + minute;
  const minutes = (hour * 60 - t + 1440) % 1440 || 1440;
  const startOfMinute = now.getTime() - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
  return new Date(startOfMinute + minutes * 60_000);
}

/**
 * Estimated minutes from a to b by car at this hour, plus a warning when the
 * trip crosses between Island and Mainland in rush hour. Under 1.2 km it is a
 * walk. Always labelled an estimate where it is shown.
 */
export function travel(a, b, now = new Date(), timeZone = "UTC") {
  const m = distanceM(a, b);
  if (m <= 1200) return { meters: m, minutes: Math.max(2, Math.round(m / 80)), mode: "walk", warning: null };

  const lagos = inLagos(a) && inLagos(b);
  const { hour, weekday } = localClock(now, lagos ? "Africa/Lagos" : timeZone);
  const weekdayRush = weekday >= 1 && weekday <= 5 && ((hour >= 7 && hour < 10) || (hour >= 16 && hour < 21));
  const lateNight = hour >= 23 || hour < 5;
  // Average door-to-door speeds, km/h, with roads twice as long as the crow flies.
  const kmh = lagos ? (weekdayRush ? 11 : lateNight ? 35 : 20) : weekdayRush ? 20 : 32;
  let minutes = Math.round(((m * 1.4) / 1000 / kmh) * 60) + 5;

  let warning = null;
  if (lagos) {
    const crossing = lagosSide(a) !== lagosSide(b);
    if (crossing) {
      minutes += weekdayRush ? 35 : lateNight ? 5 : 15;
      if (weekdayRush) warning = "Crosses between the Island and the Mainland in rush hour: expect heavy traffic.";
    }
  }
  return { meters: m, minutes, mode: "drive", warning };
}
