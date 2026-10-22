// Offline checks: opening hours, distances, travel times, names, matching maths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStatus } from "../src/hours.js";
import { distanceM, travel, lagosSide } from "../src/geo.js";
import { shortName } from "../src/places.js";
import { compareProfiles } from "../src/taste.js";

// Fri 23 Oct 2026 is a Friday. Lagos is UTC+1.
const lagos = (iso) => new Date(`${iso}+01:00`);
const week = (opens, closes) => Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((d) => [d, [{ opens, closes, closed: false }]]));

test("open now, closing later the same evening", () => {
  const s = openStatus(week("T10:00:00", "T22:00:00"), lagos("2026-10-23T20:30:00"));
  assert.equal(s.open, true);
  assert.equal(s.closesAt, "10pm");
  assert.equal(s.minutesLeft, 90);
});

test("a 2am close is still open at 1am the next day", () => {
  const s = openStatus(week("T18:00:00", "T02:00:00"), lagos("2026-10-24T01:15:00"));
  assert.equal(s.open, true);
  assert.equal(s.closesAt, "2am");
  assert.equal(s.closingSoon, true);
});

test("closed in the morning says when it opens", () => {
  const s = openStatus(week("T18:00:00", "T02:00:00"), lagos("2026-10-23T09:00:00"));
  assert.equal(s.open, false);
  assert.equal(s.opensAt, "6pm");
  assert.equal(s.opensDay, "today");
});

test("closed all week says so; no hours says unknown", () => {
  const allClosed = Object.fromEntries(["friday"].map((d) => [d, [{ opens: "T10:00:00", closes: "T22:00:00", closed: true }]]));
  assert.equal(openStatus(allClosed, lagos("2026-10-23T12:00:00")).closedAllWeek, true);
  assert.equal(openStatus(null).known, false);
  assert.equal(openStatus({}).known, false);
});

test("distance and Lagos sides", () => {
  const eko = { lat: 6.4266, lon: 3.4301 }, quilox = { lat: 6.438, lon: 3.4381 };
  const d = distanceM(eko, quilox);
  assert.ok(d > 1400 && d < 1700, `got ${d}`);
  assert.equal(lagosSide(eko), "island");
  assert.equal(lagosSide({ lat: 6.6018, lon: 3.3515 }), "mainland");
});

test("short trips are walks; Island to Mainland in rush hour warns", () => {
  assert.equal(travel({ lat: 6.4266, lon: 3.4301 }, { lat: 6.428, lon: 3.431 }).mode, "walk");
  const rush = travel({ lat: 6.4266, lon: 3.4301 }, { lat: 6.6018, lon: 3.3515 }, lagos("2026-10-23T18:00:00"));
  assert.equal(rush.mode, "drive");
  assert.ok(rush.warning);
  const late = travel({ lat: 6.4266, lon: 3.4301 }, { lat: 6.6018, lon: 3.3515 }, lagos("2026-10-24T01:00:00"));
  assert.equal(late.warning, null);
  assert.ok(late.minutes < rush.minutes);
});

test("short names drop menus stuffed into business names", () => {
  assert.equal(shortName("Yakoyo Abula Joint (Victoria Island Branch) - Amala and Abula | Rice | Igbo Soups"), "Yakoyo Abula Joint (Victoria Island Branch)");
  assert.equal(shortName("Alba Lounge"), "Alba Lounge");
  assert.equal(shortName("Chuku's (Tottenham)"), "Chuku's (Tottenham)");
});

test("matching: identical tastes score 100, nothing shared scores 0, it's symmetric", () => {
  const a = { favourites: ["x"], music: ["afrobeats", "r&b"], places: ["lounge"], screen: ["drama"], picks: ["Alba"] };
  const b = { favourites: ["y"], music: ["metal"], places: ["pub"], screen: ["horror"], picks: ["Rock Bar"] };
  assert.equal(compareProfiles(a, a).match, 100);
  assert.equal(compareProfiles(a, b).match, 0);
  const c = { ...b, music: ["afrobeats", "metal"] };
  assert.equal(compareProfiles(a, c).match, compareProfiles(c, a).match);
});

import { cleanAvatar, DEFAULT_AVATAR } from "../src/avatar.js";
test("avatars: only listed options are accepted; missing ones fall back to the default", () => {
  assert.deepEqual(cleanAvatar({}), { ...DEFAULT_AVATAR, extras: [] });
  assert.deepEqual(cleanAvatar({ hair: "locs", extras: ["glasses", "glasses", "cap"] }).extras, ["cap", "glasses"]);
  assert.throws(() => cleanAvatar({ hair: "<script>" }), /isn't one of the options/);
  assert.throws(() => cleanAvatar({ skin: "#000000" }), /isn't one of the options/);
  assert.throws(() => cleanAvatar({ extras: ["https://evil.example"] }), /Unknown extra/);
});

import { prettyName } from "../src/qloo.js";
test("names with stray capitals are tidied, real ones are left alone", () => {
  assert.equal(prettyName("TEms"), "Tems");
  assert.equal(prettyName("SZA"), "SZA");
  assert.equal(prettyName("AY Makun"), "AY Makun");
  assert.equal(prettyName("McDonald's"), "McDonald's");
  assert.equal(prettyName("Burna Boy"), "Burna Boy");
});
