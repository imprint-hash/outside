/**
 * The place card: everything one place shows when you tap it.
 *
 * - Qloo's side: star rating, what reviewers keep mentioning, and short
 *   summaries of the service, ambience and crowd (from /v2/insights).
 * - Our side: everyone's rating and the rating from people with your taste,
 *   plus a few one-line notes (no names).
 * - Who's here: counts and faces of people like you (crowd.js rules).
 * - What you can do: check in, rate, say hi once checked in, ride there.
 *
 * The match itself comes from the map or list the client already holds:
 * Qloo can't score a single place with a signal (it comes back empty), so
 * the card doesn't spend a call trying.
 */

import { placeFull, shapePlace, saying } from "./places.js";
import { list, get } from "./store.js";
import { summarize, reviewStatus } from "./reviews.js";
import { likeness } from "./likeness.js";
import { crowdAt } from "./crowd.js";
import { myCheckin } from "./people.js";
import { rideLinks } from "./rides.js";
import { cityOf, cityNear } from "./cities.js";

const MAX_REVIEWS = 60;

/** At most two sentences and 220 characters; null when there's nothing. */
export function trimSummary(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [t];
  let out = sentences.slice(0, 2).join("").trim();
  if (out.length > 220) {
    const cut = out.slice(0, 219);
    out = `${cut.slice(0, cut.lastIndexOf(" ") > 150 ? cut.lastIndexOf(" ") : 219).replace(/[\s,;:.-]+$/, "")}…`;
  }
  return out;
}

/** Qloo's review data for one place, shaped for the card. */
export function qlooSide(e) {
  const p = e?.properties || {};
  const dishes = (Array.isArray(p.specialty_dishes) ? p.specialty_dishes : []).map((d) => d?.name?.trim()).filter(Boolean).slice(0, 6);
  return {
    rating: p.business_rating ? Math.round(p.business_rating * 10) / 10 : null,
    keywords: saying(p.keywords, 8),
    summaries: {
      service: trimSummary(p.service_description),
      ambience: trimSummary(p.ambience_description),
      crowd: trimSummary(p.customer_demographics_description),
      overall: trimSummary(p.overall_description || p.short_description),
      dishes: dishes.length ? dishes : null,
    },
  };
}

/** "Loves Tems · Afrobeats": what a reviewer shares with the viewer, no name. */
function becauseLine(like) {
  const b = like?.because;
  if (!b) return null;
  const bits = [];
  if (b.bothLove?.length) bits.push(`Loves ${b.bothLove[0]}`);
  if (b.music?.length) bits.push(b.music.slice(0, 2).join(", "));
  return bits.join(" · ") || null;
}

const EMPTY_CROWD = (id) => ({ venueId: id, here: 0, likeYou: 0, strong: 0, plumbob: null, faces: [] });

export async function placeCard(viewer, placeId, { origin = null, match = null, now = new Date() } = {}) {
  const e = await placeFull(placeId);
  const id = e.entity_id || placeId;
  const loc = e.location ? { lat: e.location.lat, lon: e.location.lon } : null;
  const viewerCity = cityOf(viewer);
  const city = (loc && cityNear(loc)) || viewerCity;
  const place = shapePlace(e, { origin, now, timeZone: city.tz });

  // Our own reviews, weighted by how alike each reviewer is to the viewer.
  const reviews = (await list("reviews", (r) => r.placeId === id, { placeId: id }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_REVIEWS);
  const sims = new Map();
  await Promise.all([...new Set(reviews.map((r) => r.userId))].filter((uid) => uid !== viewer.id).map(async (uid) => {
    const reviewer = await get("users", uid);
    if (!reviewer) return;
    const like = await likeness(viewer, reviewer, viewerCity.name).catch(() => null);
    if (like) sims.set(uid, { match: like.match, because: becauseLine(like) });
  }));
  const ours = summarize(reviews, { viewerId: viewer.id, similarity: (r) => sims.get(r.userId) ?? null });

  const [crowdMap, mine, status] = await Promise.all([
    crowdAt(viewer, [id], { now, cityName: viewerCity.name, faces: true }),
    myCheckin(viewer, now),
    reviewStatus(viewer, id, now),
  ]);
  const c = crowdMap.get(id);
  const crowd = c ? { here: c.here, likeYou: c.likeYou, strong: c.strong, plumbob: c.plumbob, faces: c.faces || [] } : EMPTY_CROWD(id);
  delete crowd.venueId;
  const checkedInHere = mine?.venueId === id;

  const m = match === null || match === undefined || match === "" ? null : Number(match);
  const fitMatch = Number.isFinite(m) ? Math.max(0, Math.min(100, Math.round(m))) : null;

  return {
    place: { ...place, match: fitMatch, city: city.name },
    fit: { match: fitMatch, label: fitLabel(fitMatch) },
    qloo: qlooSide(e),
    ours,
    crowd,
    you: { checkedInHere, canSayHi: checkedInHere, canReview: status.canReview, reviewedToday: status.reviewedToday },
    ride: loc ? rideLinks({ from: origin, to: loc, toName: place.name, cc: city.cc }) : null,
  };
}

function fitLabel(m) {
  if (m == null) return null;
  if (m >= 90) return "Top match";
  if (m >= 75) return "Strong match";
  if (m >= 50) return "Good match";
  return "Different from your usual";
}
