/**
 * The organiser and venue view: who's in town and what they love.
 *
 * Built only from totals. Any group smaller than MIN_GROUP people is folded
 * into "other" so no one can be picked out ("the one visitor from Leeds who
 * loves metal"). No names, no emails, no check-in times leave this module.
 */

import { list } from "./store.js";
import { buildProfile } from "./taste.js";
import { eventsForYou } from "./events.js";

const MIN_GROUP = 3;

function tally(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = rows.filter(([, n]) => n >= MIN_GROUP);
  const other = rows.filter(([, n]) => n < MIN_GROUP).reduce((s, [, n]) => s + n, 0);
  return { rows: shown.map(([name, people]) => ({ name, people })), other };
}

/**
 * `days`: visitors active in the last N days (signed up, set their taste, or
 * checked in). `events`: the organiser's events, to count matched visitors.
 */
export async function dashboard({ days = 7, events = [], now = new Date() }) {
  const since = now.getTime() - days * 86400_000;
  const recentCheckins = await list("checkins", (c) => new Date(c.at).getTime() >= since);
  const active = new Set(recentCheckins.map((c) => c.userId));
  const users = await list("users", (u) => u.favourites?.length && (active.has(u.id) || new Date(u.updatedAt || u.createdAt).getTime() >= since));

  if (users.length < MIN_GROUP) {
    return { visitors: users.length, note: `Fewer than ${MIN_GROUP} visitors with a taste profile so far, so nothing is shown yet to protect their privacy.` };
  }

  const profiles = await Promise.all(users.slice(0, 300).map((u) => buildProfile(u.favourites).catch(() => null)));
  const music = tally(profiles.flatMap((p) => (p?.music || []).slice(0, 5)));
  const homeCities = tally(users.map((u) => u.homeCity));
  const venues = tally(recentCheckins.map((c) => c.venueName));

  const eventRows = [];
  for (const ev of events) {
    let strong = 0;
    for (const u of users.slice(0, 150)) {
      const [scored] = await eventsForYou({ favourites: u.favourites, events: [ev] }).catch(() => [null]);
      if ((scored?.fit ?? 0) >= 90) strong++;
    }
    eventRows.push({ id: ev.id, title: ev.title, strongMatches: strong >= MIN_GROUP ? strong : `fewer than ${MIN_GROUP}` });
  }

  return {
    visitors: users.length,
    days,
    homeCities,
    topSounds: { rows: music.rows.slice(0, 8), other: music.other },
    busiestVenues: venues,
    events: eventRows,
    privacy: `Totals only. Groups smaller than ${MIN_GROUP} people are folded into "other".`,
  };
}
