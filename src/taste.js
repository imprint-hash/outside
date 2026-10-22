/**
 * Taste profiles, and how alike two people are.
 *
 * A person tells Outside a few things they love: artists, places, films,
 * shows, brands. Qloo turns that into a profile: the music styles, place
 * styles and screen genres people with those loves lean towards, and the
 * places in the city they would pick. Two profiles are then compared set by
 * set. Qloo's own compare endpoint was tried and dropped: it reported a metal
 * fan and an Afrobeats fan as alike on "Soul".
 *
 * Only the things people love are sent to Qloo, never names, emails or
 * locations, in line with Qloo's safe-use rules.
 */

import { qloo, insights, findEntity, QlooError } from "./qloo.js";

export const TYPES = {
  artist: "urn:entity:artist",
  place: "urn:entity:place",
  movie: "urn:entity:movie",
  show: "urn:entity:tv_show",
  brand: "urn:entity:brand",
  book: "urn:entity:book",
  podcast: "urn:entity:podcast",
};

const TAG_SETS = {
  music: "urn:tag:genre:music",
  places: "urn:tag:genre:place",
  screen: "urn:tag:genre:media",
};
// How much each part counts when comparing two people. Music carries most
// of a night out; the city picks say whether you'd end up in the same rooms.
const WEIGHTS = { music: 0.4, places: 0.15, screen: 0.1, picks: 0.35 };

/**
 * Turn typed names ("Tems", "Nobu London") into Qloo entities. Unknown names
 * are reported back, not silently dropped, so the person can fix a typo.
 */
export async function resolveFavourites(items, { city } = {}) {
  const found = [], missing = [];
  for (const it of items.slice(0, 12)) {
    const type = TYPES[it.type] || it.type;
    if (!type || !String(it.name || "").trim()) continue;
    const e = await findEntity(it.name, type, { city: it.city || (type === TYPES.place ? undefined : undefined) });
    // Keep the person's own spelling when Qloo's differs only in case ("TEms").
    const name = e && e.name.toLowerCase() === String(it.name).trim().toLowerCase() ? String(it.name).trim() : e?.name;
    if (e) found.push({ id: e.entity_id, name, type: it.type, image: e.properties?.image?.url || null });
    else missing.push(it.name);
  }
  return { favourites: found, missing };
}

const profileCache = new Map();

/** A person's taste, as sets Qloo builds from the things they love. */
export async function buildProfile(favourites, { city = "Lagos" } = {}) {
  if (!favourites?.length) throw new QlooError("Add at least one thing you love to build your taste.", 400);
  const ids = [...new Set(favourites.map((f) => f.id))].sort();
  const key = `${city}|${ids.join(",")}`;
  if (profileCache.has(key)) return profileCache.get(key);

  // If any part fails, the error goes up and nothing is cached: a half-built
  // profile would make every match that night quietly wrong.
  const tagCalls = Object.entries(TAG_SETS).map(async ([name, tagType]) => {
    const r = await insights({ "filter.type": "urn:tag", "filter.tag.types": tagType, "signal.interests.entities": ids, take: 25 });
    return [name, (r.tags || []).map((t) => t.name?.trim()).filter(Boolean)];
  });
  const picks = insights({ "filter.type": "urn:entity:place", "filter.location.query": city, "filter.tags": "urn:tag:category:place:restaurant,urn:tag:category:place:bar,urn:tag:category:place:lounge,urn:tag:category:place:night_club", "signal.interests.entities": ids, take: 30 })
    .then((r) => (r.entities || []).map((e) => e.name));

  const [sets, placePicks] = await Promise.all([Promise.all(tagCalls).then(Object.fromEntries), picks]);
  const profile = { city, favourites: ids, music: sets.music, places: sets.places, screen: sets.screen, picks: placePicks };
  profileCache.set(key, profile);
  return profile;
}

const SMALL = new Set(["and", "of", "the", "&", "n"]);
/** "rhythm & blues" -> "Rhythm & Blues", "afrobeats" -> "Afrobeats"; "R&B", "UK" kept. */
const tidy = (t) => t.split(" ").map((w, i) => (w === w.toUpperCase() || (i && SMALL.has(w)) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");

const jaccard = (a = [], b = []) => {
  const A = new Set(a.map((x) => x.toLowerCase())), B = new Set(b.map((x) => x.toLowerCase()));
  if (!A.size || !B.size) return null;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
};

/**
 * How alike two people are, 0–100, with the reasons in plain words. Parts a
 * profile lacks (someone who only named films has no music set) are left out
 * of the average instead of counting as a mismatch.
 */
export function compareProfiles(a, b, { namesA = [], namesB = [] } = {}) {
  let sum = 0, weight = 0;
  for (const [part, w] of Object.entries(WEIGHTS)) {
    const j = jaccard(a[part], b[part]);
    if (j === null) continue;
    sum += j * w;
    weight += w;
  }
  const sharedFavourites = a.favourites.filter((id) => b.favourites.includes(id)).length;
  let score = weight ? sum / weight : 0;
  score = Math.min(1, score + sharedFavourites * 0.08);

  const shared = (part, top = 25) => {
    const B = new Set((b[part] || []).slice(0, top).map((x) => x.toLowerCase()));
    return (a[part] || []).slice(0, top).filter((x) => B.has(x.toLowerCase())).map(tidy);
  };
  const lovedByBoth = namesA.filter((n) => namesB.map((x) => x.toLowerCase()).includes(n.toLowerCase()));
  return {
    match: Math.round(score * 100),
    because: {
      bothLove: lovedByBoth,
      music: shared("music").slice(0, 4),
      places: shared("places").slice(0, 3),
      // Only each person's own top picks count, so a spot everyone in town
      // would be sent to (the most popular lounge) is not a shared reason.
      wouldGoTo: score >= 0.4 ? shared("picks", 8).slice(0, 3) : [],
    },
  };
}

/** One line a person reads: "You both love Tems · Alternative R&B, Afrobeats · you'd both pick Alba Lounge". */
export function matchLine(c) {
  const bits = [];
  if (c.because.bothLove.length) bits.push(`You both love ${c.because.bothLove.slice(0, 2).join(" and ")}`);
  if (c.because.music.length) bits.push(c.because.music.slice(0, 3).join(", "));
  if (c.because.wouldGoTo.length) bits.push(`you'd both pick ${c.because.wouldGoTo[0]}`);
  return bits.join(" · ") || "Different tastes, which can be fun too";
}

/** Score a list of artists (a concert lineup) for a person's favourites. */
export async function scoreArtists(favourites, artistIds) {
  if (!artistIds.length) return {};
  const r = await insights({
    "filter.type": "urn:entity:artist",
    "signal.interests.entities": favourites.map((f) => f.id),
    "filter.results.entities": artistIds,
    take: Math.min(50, artistIds.length),
  });
  return Object.fromEntries((r.entities || []).map((e) => [e.entity_id, e.query?.affinity ?? null]));
}

export { qloo };
