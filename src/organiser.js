/**
 * The organiser and venue view: who's in town, who walks into your venue,
 * what they love, how they rate you, and who to book next.
 *
 * Built only from totals. Any group smaller than MIN_GROUP people is folded
 * into "other" so no one can be picked out ("the one visitor from Leeds who
 * loves metal"). No names, no emails, no check-in times leave this module.
 * Artists named in "who to book" are Qloo artists, never people.
 */

import { list, get } from "./store.js";
import { profileFor } from "./likeness.js";
import { eventsForYou } from "./events.js";
import { insights, findEntity } from "./qloo.js";
import { signalSounds, isGenericSound } from "./taste.js";
import { cityNamed, cityOf } from "./cities.js";

export const MIN_GROUP = 3;
const FEWER = `fewer than ${MIN_GROUP}`;
const PRIVACY = `Totals only. Groups smaller than ${MIN_GROUP} people are folded into "other".`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function tally(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = rows.filter(([, n]) => n >= MIN_GROUP);
  const other = rows.filter(([, n]) => n < MIN_GROUP).reduce((s, [, n]) => s + n, 0);
  return { rows: shown.map(([name, people]) => ({ name, people })), other };
}

const SMALL = new Set(["and", "of", "the", "&", "n"]);
/** "rhythm & blues" → "Rhythm & Blues"; "R&B", "UK" kept. */
export const tidy = (t) => String(t).replace(/\s+/g, " ").trim().split(" ").map((w, i) => (!w || w === w.toUpperCase() || (i && SMALL.has(w)) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");

/** The weekday ("Mon"…"Sun") of an instant in a time zone. */
export function weekdayIn(date, timeZone) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(new Date(date)).slice(0, 3);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const profilesOf = async (users, cityName) => {
  const ps = await pool(users, 4, (u) => profileFor(u, cityName).catch(() => null));
  return new Map(users.map((u, i) => [u.id, ps[i]]));
};

/**
 * City-wide: visitors active in the last `days` (signed up, set their taste,
 * or checked in) in `cityName`. `events`: the organiser's events, to count
 * matched visitors.
 */
export async function cityDashboard({ days = 7, events = [], now = new Date(), cityName = null } = {}) {
  const since = now.getTime() - days * 86400_000;
  const recentCheckins = await list("checkins", (c) => new Date(c.at).getTime() >= since && (!cityName || !c.city || c.city === cityName));
  const active = new Set(recentCheckins.map((c) => c.userId));
  const users = await list("users", (u) => u.favourites?.length && (!cityName || (u.city || "Lagos") === cityName || active.has(u.id)) && (active.has(u.id) || new Date(u.updatedAt || u.createdAt).getTime() >= since));

  if (users.length < MIN_GROUP) {
    return { visitors: users.length, note: `Fewer than ${MIN_GROUP} visitors with a taste profile so far, so nothing is shown yet to protect their privacy.` };
  }

  const some = users.slice(0, 300);
  const profiles = await profilesOf(some, cityName || undefined);
  const music = tally(some.flatMap((u) => signalSounds(profiles.get(u.id)?.music).slice(0, 5).map(tidy)));
  const homeCities = tally(users.map((u) => u.homeCity));
  const venues = tally(recentCheckins.map((c) => c.venueName));

  const eventRows = [];
  for (const ev of events) {
    let strong = 0;
    for (const u of users.slice(0, 150)) {
      const [scored] = await eventsForYou({ favourites: u.favourites, events: [ev] }).catch(() => [null]);
      if ((scored?.fit ?? 0) >= 90) strong++;
    }
    eventRows.push({ id: ev.id, title: ev.title, strongMatches: strong >= MIN_GROUP ? strong : FEWER });
  }

  return {
    city: cityName,
    visitors: users.length,
    demoUsers: users.filter((u) => u.demo).length,
    days,
    homeCities,
    topSounds: { rows: music.rows.slice(0, 8), other: music.other },
    busiestVenues: venues,
    events: eventRows,
    privacy: PRIVACY,
  };
}

const isArtist = (f) => f?.type === "artist" || f?.type === "urn:entity:artist";

/**
 * One venue's crowd over the last `days`: visitors, a week of nights, ratings
 * by taste group, and who to book next. `want` (an artist name) adds the gap
 * between the crowd you have and the one you want.
 */
export async function venueDashboard({ venueId, cityName, days = 28, want = null, now = new Date() } = {}) {
  const city = cityNamed(cityName) || cityOf(null);
  const since = now.getTime() - days * 86400_000;
  const checkins = await list("checkins", (c) => c.venueId === venueId && new Date(c.at).getTime() >= since && new Date(c.at) <= now, { venueId });
  const ids = [...new Set(checkins.map((c) => c.userId))];
  const users = (await Promise.all(ids.map((id) => get("users", id)))).filter(Boolean);
  const visitors = users.length, demoUsers = users.filter((u) => u.demo).length;

  if (users.length < MIN_GROUP) {
    return { visitors, demoUsers, note: `Fewer than ${MIN_GROUP} visitors so far, so nothing is shown yet to protect their privacy.` };
  }

  const byId = new Map(users.map((u) => [u.id, u]));
  const reviews = await list("reviews", (r) => r.placeId === venueId, { placeId: venueId });
  const reviewers = [...new Set(reviews.map((r) => r.userId))];
  const reviewerUsers = (await Promise.all(reviewers.map(async (id) => byId.get(id) || (await get("users", id))))).filter(Boolean);
  const everyone = [...users, ...reviewerUsers.filter((u) => !byId.has(u.id))];
  const profiles = await profilesOf(everyone, city.name);

  // A week of nights, in the venue's local time.
  const perDay = new Map(WEEKDAYS.map((d) => [d, []]));
  for (const c of checkins) perDay.get(weekdayIn(c.at, city.tz))?.push(c);
  const byWeekday = WEEKDAYS.map((day) => {
    const cs = perDay.get(day);
    const people = [...new Set(cs.map((c) => c.userId))].map((id) => byId.get(id)).filter(Boolean);
    if (people.length < MIN_GROUP) return { day, checkins: cs.length ? FEWER : 0 };
    return {
      day,
      checkins: cs.length,
      topSounds: tally(people.flatMap((u) => signalSounds(profiles.get(u.id)?.music).slice(0, 5).map(tidy))),
      topLoves: tally(people.flatMap((u) => [...new Set((u.favourites || []).map((f) => f.name))])),
    };
  });

  // Ratings: one vote per reviewer (their average), grouped by their top 3
  // sounds, leaving out tags nearly everyone has ("trap", "beats").
  const voteOf = new Map();
  for (const r of reviews) {
    const v = voteOf.get(r.userId) || { sum: 0, n: 0 };
    v.sum += r.stars; v.n++;
    voteOf.set(r.userId, v);
  }
  const round1 = (x) => Math.round(x * 10) / 10;
  const groups = new Map();
  for (const [uid, v] of voteOf) {
    const tags = [...new Set(signalSounds(profiles.get(uid)?.music).slice(0, 3).map(tidy))];
    for (const g of tags) {
      const x = groups.get(g) || { sum: 0, count: 0 };
      x.sum += v.sum / v.n; x.count++;
      groups.set(g, x);
    }
  }
  const shownGroups = [...groups.entries()].filter(([, x]) => x.count >= MIN_GROUP).sort((a, b) => b[1].count - a[1].count);
  const foldedGroups = [...groups.values()].filter((x) => x.count < MIN_GROUP).length;
  const ratings = {
    overall: reviews.length
      ? { avg: round1(reviews.reduce((s, r) => s + r.stars, 0) / reviews.length), count: reviews.length, demo: reviews.filter((r) => r.demo).length }
      : { avg: null, count: 0, demo: 0 },
    byTaste: shownGroups.map(([group, x]) => ({ group, avg: round1(x.sum / x.count), count: x.count })),
    // How many taste groups were too small to show (not how many people).
    other: { groups: foldedGroups },
  };

  const bookNext = await whoToBook(users, venueId);
  const gap = want ? await crowdGap(users, profiles, want) : null;

  return { visitors, demoUsers, days, byWeekday, ratings, bookNext, ...(gap ? { gap } : {}), privacy: PRIVACY };
}

/** Artists this crowd would love that it doesn't already: Qloo, signalled by the crowd's favourites and the venue. */
async function whoToBook(users, venueId) {
  const loves = new Map();
  for (const u of users) {
    for (const f of new Map((u.favourites || []).filter(isArtist).map((f) => [f.id, f])).values()) {
      const x = loves.get(f.id) || { id: f.id, name: f.name, people: 0 };
      x.people++;
      loves.set(f.id, x);
    }
  }
  const ranked = [...loves.values()].sort((a, b) => b.people - a.people);
  const signal = [...ranked.slice(0, 5).map((x) => x.id), venueId].filter(Boolean);
  const r = await insights({ "filter.type": "urn:entity:artist", "signal.interests.entities": signal, take: 20 });
  const because = ranked.filter((x) => x.people >= MIN_GROUP).slice(0, 3).map((x) => x.name);
  return (r.entities || [])
    .filter((e) => !loves.has(e.entity_id))
    .slice(0, 8)
    .map((e) => ({ id: e.entity_id, name: e.name, image: e.properties?.image?.url || null, affinity: e.query?.affinity == null ? null : Math.round(e.query.affinity * 100), because }));
}

/** How much of the crowd already leans towards the sound of the artist you want. */
async function crowdGap(users, profiles, want) {
  const e = await findEntity(String(want).slice(0, 80), "urn:entity:artist");
  if (!e) return { want: String(want).slice(0, 80), found: false };
  const tags = (e.tags || []).filter((t) => String(t.id || t.tag_id || "").startsWith("urn:tag:genre:music") && !isGenericSound(t.name)).map((t) => String(t.name).toLowerCase());
  const set = new Set(tags);
  const near = users.filter((u) => (profiles.get(u.id)?.music || []).some((m) => set.has(String(m).toLowerCase()))).length;
  return { want: e.name, found: true, sounds: tags.slice(0, 5).map(tidy), share: near >= MIN_GROUP ? `${near} of ${users.length}` : `${FEWER} of ${users.length}` };
}
