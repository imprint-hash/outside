/**
 * "How was it?": a 1–5 star rating and one line, from people who were there.
 *
 * Rules: you can rate a place only within 48 hours of checking in there, once
 * per local day. Notes are short, plain text, with no links. A place then
 * shows two ratings: everyone's, and people with your taste (weighted by how
 * alike you are). Notes shown to others never carry a name or an id, only
 * what the reviewer and the viewer have in common.
 */

import { HttpError } from "./http.js";
import { get, put, list } from "./store.js";
import { cityOf, cityNamed, cityNear } from "./cities.js";
import { LIKE_YOU } from "./crowd.js";

export class ReviewError extends HttpError {}

const WINDOW_MS = 48 * 3600_000;
const NOTE_MAX = 140;

/** The local calendar date, YYYY-MM-DD, in a time zone. */
export function localDay(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The time zone a check-in happened in: its city, else the venue's nearest city, else the user's. */
export function checkinZone(c, user) {
  return (cityNamed(c?.city) || (c?.venueLocation ? cityNear(c.venueLocation) : null) || cityOf(user)).tz;
}

export const reviewId = (userId, placeId, day) => `${userId}|${placeId}|${day}`;

/** This user's check-ins at `placeId` in the last 48 hours, newest first. */
async function recentCheckinsAt(user, placeId, now) {
  const since = now.getTime() - WINDOW_MS;
  const rows = await list("checkins", (c) => c.userId === user.id && c.venueId === placeId && new Date(c.at).getTime() >= since && new Date(c.at) <= now, { userId: user.id });
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

function cleanNote(note) {
  // eslint-disable-next-line no-control-regex
  const text = String(note ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > NOTE_MAX) throw new ReviewError(`Keep it to ${NOTE_MAX} characters.`, 400);
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|uk|ng|app|xyz|ly|me)\b)/i.test(text)) throw new ReviewError("No links in reviews, please.", 400);
  return text;
}

/** What `user` can do about rating `placeId` right now. */
export async function reviewStatus(user, placeId, now = new Date()) {
  const [latest] = await recentCheckinsAt(user, placeId, now);
  if (!latest) return { canReview: false, reviewedToday: false };
  const day = localDay(now, checkinZone(latest, user));
  const reviewedToday = Boolean(await get("reviews", reviewId(user.id, placeId, day)));
  return { canReview: !reviewedToday, reviewedToday };
}

export async function addReview(user, { placeId, stars, note } = {}, now = new Date()) {
  if (!placeId || typeof placeId !== "string") throw new ReviewError("Which place? Send placeId.", 400);
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new ReviewError("Stars must be a whole number from 1 to 5.", 400);
  const text = cleanNote(note);
  const [latest] = await recentCheckinsAt(user, placeId, now);
  if (!latest) throw new ReviewError("Check in there first; you can rate a place for 48 hours after.", 403);
  const zone = checkinZone(latest, user);
  const day = localDay(now, zone);
  const id = reviewId(user.id, placeId, day);
  if (await get("reviews", id)) throw new ReviewError("You've already rated it today.", 409);
  const city = (cityNamed(latest.city) || cityNear(latest.venueLocation || {}) || cityOf(user)).name;
  return put("reviews", { id, userId: user.id, placeId, placeName: latest.venueName || null, city, stars: n, note: text, day, at: now.toISOString(), demo: !!user.demo });
}

/** Places you checked in at in the last 48 hours and haven't rated yet. */
export async function pendingReviews(user, now = new Date()) {
  const since = now.getTime() - WINDOW_MS;
  const [checkins, mine] = await Promise.all([
    list("checkins", (c) => c.userId === user.id && new Date(c.at).getTime() >= since && new Date(c.at) <= now, { userId: user.id }),
    list("reviews", (r) => r.userId === user.id, { userId: user.id }),
  ]);
  const rated = new Set(mine.map((r) => r.placeId));
  const latest = new Map();
  for (const c of checkins) {
    if (rated.has(c.venueId)) continue;
    const prev = latest.get(c.venueId);
    if (!prev || c.at > prev.at) latest.set(c.venueId, c);
  }
  return [...latest.values()].sort((a, b) => b.at.localeCompare(a.at)).map((c) => ({ placeId: c.venueId, placeName: c.venueName || null, at: c.at }));
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Two ratings and a few notes, from a place's reviews. Pure.
 * `similarity(review)` gives the viewer's match with that reviewer: a number,
 * null, or { match, because } where `because` is a short shared-taste line.
 */
export function summarize(reviews, { viewerId = null, similarity = () => null } = {}) {
  const all = Array.isArray(reviews) ? reviews : [];
  const overall = all.length ? { avg: round1(all.reduce((s, r) => s + r.stars, 0) / all.length), count: all.length } : { avg: null, count: 0 };

  let sumW = 0, sumWS = 0, count = 0;
  const notes = [];
  for (const r of all) {
    if (viewerId && r.userId === viewerId) continue;
    const sim = similarity(r);
    const match = sim && typeof sim === "object" ? sim.match ?? null : sim ?? null;
    const because = sim && typeof sim === "object" ? sim.because || null : null;
    if (match != null && match >= LIKE_YOU) {
      const w = (match - 40) / 60;
      sumW += w;
      sumWS += w * r.stars;
      count++;
    }
    if (r.note) notes.push({ stars: r.stars, note: r.note, match, because, at: r.at });
  }
  notes.sort((a, b) => (b.match ?? -1) - (a.match ?? -1) || String(b.at).localeCompare(String(a.at)));

  return {
    overall,
    likeYou: { avg: count && sumW > 0 ? round1(sumWS / sumW) : null, count, enough: count >= 2 },
    notes: notes.slice(0, 5),
  };
}
