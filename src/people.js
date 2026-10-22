/**
 * People with your taste, at the same place, tonight, and only on their terms.
 *
 * The rules live here, not in the screens, so no client can get around them:
 * - You only ever see people checked in at the same venue as you, tonight.
 *   Never a map of strangers, never anyone's location.
 * - Everyone picks who can see them, with the same options for everyone:
 *   everyone, strong matches only, verified people only, groups only, nobody.
 * - Saying hi shows them your first name and what you both love. Nothing
 *   else. Chat opens only if they accept.
 * - Meet-up mode shares live location both ways only after both people turn
 *   it on, for 30 minutes at most, only within 1 km of the venue, and ends
 *   the moment you are within 25 m of each other or either person stops it.
 * - Check-ins expire at 6am. Blocking hides both people from each other and
 *   ends anything open between them. A report also blocks.
 */

import { get, put, list } from "./store.js";
import { buildProfile, compareProfiles, matchLine, resolveFavourites } from "./taste.js";
import { entityById, shortName } from "./places.js";
import { distanceM, localClock } from "./geo.js";
import { cleanAvatar } from "./avatar.js";
import { avatarOf } from "./auth.js";
import { zoneFor } from "./hours.js";

export class RuleError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

export const VISIBILITY = ["everyone", "strong", "verified", "groups", "nobody"];
export const STRONG_MATCH = 60;
const MEETUP_MINUTES = 30;
const MEETUP_RADIUS_M = 1000;
const ARRIVED_M = 25;
const HELLOS_PER_HOUR = 10;

/* ---------- taste ---------- */

export async function setTaste(user, items) {
  const { favourites, missing } = await resolveFavourites(items);
  if (!favourites.length) throw new RuleError(missing.length ? `Couldn't find ${missing.join(", ")}. Check the spelling?` : "Add at least one thing you love.", 400);
  const saved = await put("users", { ...user, favourites, updatedAt: new Date().toISOString() });
  return { user: saved, missing };
}

export async function setAvatar(user, avatar) {
  return put("users", { ...user, avatar: cleanAvatar(avatar) });
}

export async function setVisibility(user, visibility) {
  if (!VISIBILITY.includes(visibility)) throw new RuleError(`Visibility must be one of: ${VISIBILITY.join(", ")}.`, 400);
  return put("users", { ...user, visibility });
}

async function profileOf(user) {
  if (!user.favourites?.length) return null;
  return buildProfile(user.favourites);
}

/* ---------- check-in ---------- */

/** Minutes from now until 6am at the venue. */
function untilSixAm(now, timeZone) {
  const { hour, minute } = localClock(now, timeZone);
  const t = hour * 60 + minute;
  return t < 360 ? 360 - t : 1440 - t + 360;
}

export async function checkIn(user, venueId, now = new Date()) {
  const venue = await entityById(venueId);
  if (!venue.location) throw new RuleError("That place has no location on record, so you can't check in there.", 422);
  const expiresAt = new Date(now.getTime() + untilSixAm(now, zoneFor(venue, "UTC")) * 60_000).toISOString();
  // One check-in at a time: a new one replaces the old.
  for (const c of await list("checkins", (c) => c.userId === user.id && !c.endedAt, { userId: user.id })) await put("checkins", { ...c, endedAt: now.toISOString() });
  return put("checkins", {
    userId: user.id,
    venueId,
    venueName: shortName(venue.name),
    venueLocation: { lat: venue.location.lat, lon: venue.location.lon },
    at: now.toISOString(),
    expiresAt,
  });
}

export async function checkOut(user, now = new Date()) {
  for (const c of await activeCheckins((c) => c.userId === user.id, now, { userId: user.id })) await put("checkins", { ...c, endedAt: now.toISOString() });
}

async function activeCheckins(where, now = new Date(), match = {}) {
  return list("checkins", (c) => !c.endedAt && new Date(c.expiresAt) > now && where(c), match);
}

export async function myCheckin(user, now = new Date()) {
  return (await activeCheckins((c) => c.userId === user.id, now, { userId: user.id }))[0] ?? null;
}

/* ---------- blocking ---------- */

async function blocked(a, b) {
  const [mine, theirs] = await Promise.all([list("blocks", (x) => x.who === b, { by: a }), list("blocks", (x) => x.who === a, { by: b })]);
  return mine.length + theirs.length > 0;
}

export async function block(user, otherId, now = new Date()) {
  if (otherId === user.id) throw new RuleError("You can't block yourself.", 400);
  if (!(await blocked(user.id, otherId))) await put("blocks", { by: user.id, who: otherId, at: now.toISOString() });
  // End everything open between the two of them.
  const between = (await Promise.all([list("hellos", () => true, { from: user.id, to: otherId }), list("hellos", () => true, { from: otherId, to: user.id })])).flat();
  for (const h of between.filter((h) => h.status !== "closed")) await put("hellos", { ...h, status: "closed", closedAt: now.toISOString() });
  for (const h of between) {
    for (const m of await list("meetups", (m) => !m.endedAt, { helloId: h.id })) await put("meetups", { ...m, endedAt: now.toISOString(), endedReason: "blocked" });
  }
}

export async function report(user, otherId, reason, now = new Date()) {
  await put("reports", { by: user.id, who: otherId, reason: String(reason || "").slice(0, 500), at: now.toISOString() });
  await block(user, otherId, now);
}

const pair = (h, a, b) => (h.from === a && h.to === b) || (h.from === b && h.to === a);

/* ---------- who's here ---------- */

/** Can `viewer` see `target` in the one-to-one list, given their match? */
function allowedToSee(viewer, target, match) {
  switch (target.visibility || "everyone") {
    case "everyone": return true;
    case "strong": return match >= STRONG_MATCH;
    case "verified": return Boolean(viewer.verified);
    default: return false; // "groups" and "nobody" never appear one-to-one
  }
}

/**
 * People checked in at the same venue as you, tonight, best match first.
 * Shows first names and shared tastes only. Also counts people who prefer
 * groups, so a group plan can be offered without naming them.
 */
export async function whoIsHere(viewer, now = new Date()) {
  const mine = await myCheckin(viewer, now);
  if (!mine) throw new RuleError("Check in somewhere first to see who's there.", 409);
  if (viewer.visibility === "nobody") return { venue: mine.venueName, people: [], groupMinded: 0, note: "You're invisible tonight, so you can't see others either." };
  const myProfile = await profileOf(viewer);
  const others = await activeCheckins((c) => c.venueId === mine.venueId && c.userId !== viewer.id, now, { venueId: mine.venueId });

  const people = [];
  let groupMinded = 0;
  for (const c of others) {
    const u = await get("users", c.userId);
    if (!u || (await blocked(viewer.id, u.id))) continue;
    const theirs = await profileOf(u);
    const cmp = myProfile && theirs ? compareProfiles(myProfile, theirs, { namesA: viewer.favourites.map((f) => f.name), namesB: u.favourites.map((f) => f.name) }) : { match: null, because: { bothLove: [], music: [], places: [], wouldGoTo: [] } };
    if (u.visibility === "groups" && (cmp.match ?? 0) >= 50) groupMinded++;
    if (!allowedToSee(viewer, u, cmp.match ?? 0)) continue;
    people.push({ userId: u.id, firstName: u.firstName, avatar: avatarOf(u), bubbles: [...cmp.because.bothLove, ...cmp.because.music].slice(0, 3), match: cmp.match, line: cmp.match == null ? "Hasn't added their taste yet" : matchLine(cmp), verified: u.verified });
  }
  people.sort((a, b) => (b.match ?? -1) - (a.match ?? -1));
  return { venue: mine.venueName, people, groupMinded };
}

/* ---------- saying hi ---------- */

export async function sayHi(user, toId, now = new Date()) {
  if (toId === user.id) throw new RuleError("That's you.", 400);
  const here = await whoIsHere(user, now);
  const target = here.people.find((p) => p.userId === toId);
  if (!target) throw new RuleError("They're not here, or they've chosen not to be seen.", 404);
  const lastHour = await list("hellos", (h) => h.from === user.id && now - new Date(h.at) < 3600_000, { from: user.id });
  if (lastHour.length >= HELLOS_PER_HOUR) throw new RuleError("That's a lot of hellos for one hour. Try again a bit later.", 429);
  const open = (await Promise.all([list("hellos", () => true, { from: user.id, to: toId }), list("hellos", () => true, { from: toId, to: user.id })])).flat().filter((h) => h.status === "pending" || h.status === "accepted");
  if (open.length) return open[0];
  const mine = await myCheckin(user, now);
  return put("hellos", { from: user.id, to: toId, venueId: mine.venueId, venueName: mine.venueName, match: target.match, line: target.line, status: "pending", at: now.toISOString() });
}

/** Hellos waiting for you: their first name, the match, and why. Nothing more. */
export async function inbox(user) {
  const hs = await list("hellos", (h) => h.to === user.id && h.status === "pending", { to: user.id, status: "pending" });
  return Promise.all(hs.map(async (h) => {
    const from = await get("users", h.from);
    return { helloId: h.id, firstName: from?.firstName, avatar: avatarOf(from), match: h.match, line: h.line, venue: h.venueName, at: h.at };
  }));
}

export async function answerHi(user, helloId, accept, now = new Date()) {
  const h = await get("hellos", helloId);
  if (!h || h.to !== user.id) throw new RuleError("That hello isn't for you.", 404);
  if (h.status !== "pending") throw new RuleError("You've already answered that one.", 409);
  return put("hellos", { ...h, status: accept ? "accepted" : "declined", answeredAt: now.toISOString() });
}

/* ---------- chat ---------- */

async function acceptedHello(user, helloId) {
  const h = await get("hellos", helloId);
  if (!h || (h.from !== user.id && h.to !== user.id)) throw new RuleError("That conversation isn't yours.", 404);
  if (h.status !== "accepted") throw new RuleError("Chat opens only after they say yes.", 403);
  return h;
}

export async function sendMessage(user, helloId, text, now = new Date()) {
  const h = await acceptedHello(user, helloId);
  // eslint-disable-next-line no-control-regex
  const clean = String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  if (!clean) throw new RuleError("Say something first.", 400);
  return put("messages", { helloId: h.id, from: user.id, text: clean, at: now.toISOString() });
}

export async function messages(user, helloId) {
  const h = await acceptedHello(user, helloId);
  const all = await list("messages", (m) => m.helloId === h.id, { helloId: h.id });
  return all.sort((a, b) => a.at.localeCompare(b.at)).map((m) => ({ mine: m.from === user.id, text: m.text, at: m.at }));
}

/* ---------- meet-up mode ---------- */

/**
 * Turn on meet-up mode for an accepted hello. Location is shared only once
 * both people have turned it on, and for MEETUP_MINUTES from that moment.
 */
export async function startMeetup(user, helloId, now = new Date()) {
  const h = await acceptedHello(user, helloId);
  let m = (await list("meetups", (x) => x.helloId === h.id && !x.endedAt, { helloId: h.id }))[0];
  if (!m) m = { helloId: h.id, users: [h.from, h.to], venueId: h.venueId, consent: {}, positions: {} };
  m.consent = { ...m.consent, [user.id]: now.toISOString() };
  if (m.users.every((u) => m.consent[u]) && !m.activeAt) {
    m.activeAt = now.toISOString();
    m.expiresAt = new Date(now.getTime() + MEETUP_MINUTES * 60_000).toISOString();
  }
  return meetupView(user, await put("meetups", m), now);
}

export async function stopMeetup(user, meetupId, now = new Date()) {
  const m = await get("meetups", meetupId);
  if (!m || !m.users.includes(user.id)) throw new RuleError("That meet-up isn't yours.", 404);
  if (!m.endedAt) await put("meetups", { ...m, endedAt: now.toISOString(), endedReason: "stopped", positions: {} });
  return { ended: true };
}

async function expireIfDue(m, now) {
  if (!m.endedAt && m.expiresAt && new Date(m.expiresAt) <= now) {
    return put("meetups", { ...m, endedAt: m.expiresAt, endedReason: "time", positions: {} });
  }
  return m;
}

export async function updatePosition(user, meetupId, pos, now = new Date()) {
  let m = await get("meetups", meetupId);
  if (!m || !m.users.includes(user.id)) throw new RuleError("That meet-up isn't yours.", 404);
  m = await expireIfDue(m, now);
  if (m.endedAt) throw new RuleError("Meet-up mode has ended.", 410);
  if (!m.activeAt) throw new RuleError("Waiting for them to turn on meet-up mode too.", 409);
  const lat = Number(pos?.lat), lon = Number(pos?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new RuleError("That location doesn't look right.", 400);
  const checkin = (await list("checkins", (c) => c.venueId === m.venueId, { userId: user.id, venueId: m.venueId })).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const venue = checkin?.venueLocation;
  if (venue && distanceM(venue, { lat, lon }) > MEETUP_RADIUS_M) {
    await put("meetups", { ...m, endedAt: now.toISOString(), endedReason: "left the area", positions: {} });
    throw new RuleError("You're more than 1 km from the venue, so meet-up mode has ended.", 410);
  }
  m.positions = { ...m.positions, [user.id]: { lat, lon, at: now.toISOString() } };
  const [a, b] = m.users.map((u) => m.positions[u]);
  if (a && b && distanceM(a, b) <= ARRIVED_M) {
    m = await put("meetups", { ...m, endedAt: now.toISOString(), endedReason: "met", positions: {} });
    return meetupView(user, m, now);
  }
  return meetupView(user, await put("meetups", m), now);
}

/** What one person sees: the other's spot only while live and fresh. */
export async function meetupView(user, m, now = new Date()) {
  m = await expireIfDue(m, now);
  const other = m.users.find((u) => u !== user.id);
  const theirs = m.positions?.[other];
  const mine = m.positions?.[user.id];
  const fresh = theirs && now - new Date(theirs.at) < 120_000;
  const live = !m.endedAt && Boolean(m.activeAt);
  return {
    meetupId: m.id,
    status: m.endedAt ? "ended" : live ? "live" : "waiting",
    endedReason: m.endedReason ?? null,
    waitingFor: live || m.endedAt ? null : m.consent?.[other] ? null : "them",
    minutesLeft: live ? Math.max(0, Math.round((new Date(m.expiresAt) - now) / 60_000)) : null,
    them: live && fresh ? { lat: theirs.lat, lon: theirs.lon, at: theirs.at } : null,
    metersApart: live && fresh && mine ? distanceM(mine, theirs) : null,
  };
}

export async function getMeetup(user, meetupId, now = new Date()) {
  const m = await get("meetups", meetupId);
  if (!m || !m.users.includes(user.id)) throw new RuleError("That meet-up isn't yours.", 404);
  return meetupView(user, m, now);
}

/* ---------- share my night ---------- */

/** A message the person sends a trusted friend themselves. Outside sends nothing. */
export async function shareMyNight(user, now = new Date()) {
  const c = await myCheckin(user, now);
  if (!c) throw new RuleError("Check in somewhere first.", 409);
  const at = new Date(c.at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  return { text: `I'm at ${c.venueName} tonight (since ${at}). Checking in with you via Outside.`, venue: c.venueName, location: c.venueLocation };
}
