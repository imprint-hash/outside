/**
 * The HTTP API. One handler, used by the local server (bin/serve.mjs) and by
 * the host's serverless function. Every failure answers JSON with a plain
 * message and the right status; nothing answers an HTML error page.
 */

import { QlooError, searchEntities, stats, prettyName } from "./qloo.js";
import { AuthError, signUp, logIn, userFromToken, selfView } from "./auth.js";
import { resolveOrigin, nearYou, translateCity, tonight, CATEGORIES } from "./places.js";
import * as people from "./people.js";
import { get, put, storeName, StoreError } from "./store.js";
import { TYPES } from "./taste.js";
import { AVATAR_OPTIONS, DEFAULT_AVATAR, AvatarError } from "./avatar.js";
import { cityOf } from "./cities.js";
import { HttpError } from "./http.js";
import * as cityMap from "./routes/city-map.js";
import * as venue from "./routes/venue.js";

const MAX_BODY = 32 * 1024;

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError("That request is too large.", 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError("The request body isn't valid JSON.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("The request body must be a JSON object.", 400);
  return body;
}

async function currentUser(req) {
  const h = req.headers.authorization || "";
  return userFromToken(h.startsWith("Bearer ") ? h.slice(7) : "");
}

const kindsFrom = (v, fallback) => {
  const ks = (Array.isArray(v) ? v : String(v || "").split(",")).map((k) => k.trim()).filter(Boolean);
  const bad = ks.filter((k) => !CATEGORIES[k]);
  if (bad.length) throw new HttpError(`Unknown kind: ${bad.join(", ").slice(0, 40)}. Use ${Object.keys(CATEGORIES).join(", ")}.`, 400);
  return ks.length ? ks : fallback;
};

/** [method, path pattern, handler(ctx)] — :name segments become ctx.params. */
const core = [
  ["GET", "/api/health", async () => ({ ok: true, store: storeName, qloo: stats })],

  ["POST", "/api/auth/signup", async ({ body }) => {
    const { user, token, returning } = await signUp(body);
    // Only a brand-new account can ask to be an organiser.
    if (returning === false && body.organiser === true) await put("users", { ...user, role: "organiser" });
    return { token, returning, user: selfView(await get("users", user.id)) };
  }],
  ["POST", "/api/auth/login", async ({ body }) => {
    const { user, token } = await logIn(body);
    return { token, returning: true, user: selfView(user) };
  }],
  ["GET", "/api/me", async ({ user }) => ({ user: selfView(user), checkin: await people.myCheckin(user) })],
  ["POST", "/api/me/taste", async ({ user, body }) => {
    if (!Array.isArray(body.items)) throw new HttpError("Send items: [{ type, name }].", 400);
    const { user: saved, missing } = await people.setTaste(user, body.items);
    return { user: selfView(saved), missing };
  }],
  ["POST", "/api/me/avatar", async ({ user, body }) => ({ user: selfView(await people.setAvatar(user, body.avatar)) })],
  ["GET", "/api/avatar-options", async () => ({ options: AVATAR_OPTIONS, default: DEFAULT_AVATAR })],
  ["POST", "/api/me/visibility", async ({ user, body }) => ({ user: selfView(await people.setVisibility(user, body.visibility)) })],

  ["GET", "/api/search", async ({ query }) => {
    const q = String(query.get("q") || "").trim();
    const type = TYPES[query.get("type")] || TYPES.artist;
    if (q.length < 2) return { results: [] };
    const found = await searchEntities(q, type, 6);
    return {
      results: found.map((e) => {
        const name = prettyName(e.name);
        const detail = e.properties?.address || e.properties?.short_description || e.disambiguation || null;
        return { id: e.entity_id, name, detail: detail && detail.toLowerCase() !== e.name.toLowerCase() ? detail : null, image: e.properties?.image?.url || null };
      }),
    };
  }],

  ["POST", "/api/places/near", async ({ user, body }) => {
    const city = cityOf(user);
    const origin = await resolveOrigin(body.stay ?? body.origin, city.name);
    const places = await nearYou({ origin, favourites: user.favourites, kinds: kindsFrom(body.kinds, ["restaurant", "lounge", "club", "bar"]), radius: Math.min(15000, Number(body.radius) || 5000), openNow: Boolean(body.openNow), timeZone: city.tz });
    return { origin, places };
  }],
  ["POST", "/api/places/translate", async ({ user, body }) => {
    const city = cityOf(user);
    const origin = body.stay ? await resolveOrigin(body.stay, city.name) : null;
    return { origin, places: await translateCity({ favourites: user.favourites, city: body.city || user.city || city.name, origin, kinds: kindsFrom(body.kinds, ["restaurant", "lounge", "bar", "club"]), timeZone: city.tz }) };
  }],
  ["GET", "/api/places/tonight", async ({ query }) => {
    const venueId = query.get("venueId");
    if (!venueId) throw new HttpError("Which venue are you at? Send venueId.", 400);
    return tonight({ venueId, kinds: kindsFrom(query.get("kinds"), ["restaurant"]) });
  }],

  ["POST", "/api/checkin", async ({ user, body }) => {
    if (!body.venueId || typeof body.venueId !== "string") throw new HttpError("Which venue? Send venueId.", 400);
    const at = body.lat == null && body.lon == null ? null : { lat: Number(body.lat), lon: Number(body.lon) };
    if (at && (!Number.isFinite(at.lat) || !Number.isFinite(at.lon) || Math.abs(at.lat) > 90 || Math.abs(at.lon) > 180)) throw new HttpError("That location doesn't look right.", 400);
    return { checkin: await people.checkIn(user, body.venueId, new Date(), at) };
  }],
  ["GET", "/api/checkin", async ({ user }) => ({ checkin: await people.myCheckin(user) })],
  ["DELETE", "/api/checkin", async ({ user }) => (await people.checkOut(user), { checkedOut: true })],
  ["GET", "/api/here", async ({ user }) => people.whoIsHere(user)],

  ["POST", "/api/hello", async ({ user, body }) => ({ hello: await people.sayHi(user, body.to) })],
  ["GET", "/api/hello/inbox", async ({ user }) => ({ hellos: await people.inbox(user) })],
  ["POST", "/api/hello/:id/answer", async ({ user, params, body }) => ({ hello: await people.answerHi(user, params.id, body.accept === true) })],
  ["GET", "/api/hello/:id/messages", async ({ user, params }) => ({ messages: await people.messages(user, params.id) })],
  ["POST", "/api/hello/:id/messages", async ({ user, params, body }) => ({ message: await people.sendMessage(user, params.id, body.text) })],
  ["POST", "/api/hello/:id/meetup", async ({ user, params }) => ({ meetup: await people.startMeetup(user, params.id) })],
  ["GET", "/api/meetup/:id", async ({ user, params }) => ({ meetup: await people.getMeetup(user, params.id) })],
  ["POST", "/api/meetup/:id/position", async ({ user, params, body }) => ({ meetup: await people.updatePosition(user, params.id, body) })],
  ["POST", "/api/meetup/:id/stop", async ({ user, params }) => people.stopMeetup(user, params.id)],

  ["POST", "/api/block", async ({ user, body }) => (await people.block(user, body.userId), { blocked: true })],
  ["POST", "/api/report", async ({ user, body }) => (await people.report(user, body.userId, body.reason), { reported: true, blocked: true })],
  ["GET", "/api/share-night", async ({ user }) => people.shareMyNight(user)],
];

const corePublic = ["/api/health", "/api/auth/signup", "/api/auth/login", "/api/search", "/api/avatar-options"];

// Core first, so GET /api/places/tonight still wins over /api/places/:id.
const routes = [...core, ...cityMap.routes, ...venue.routes];
const PUBLIC = new Set([...corePublic, ...cityMap.publicPaths, ...venue.publicPaths]);

function decodeSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    throw new HttpError("That address has a broken %-escape in it.", 400);
  }
}

function match(method, path) {
  for (const [m, pattern, fn] of routes) {
    if (m !== method) continue;
    const a = pattern.split("/"), b = path.split("/");
    if (a.length !== b.length) continue;
    const params = {};
    if (a.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = decodeSegment(b[i])), true) : seg === b[i]))) return { fn, params, pattern };
  }
  return null;
}

export async function handle(req, res) {
  const url = new URL(req.url, "http://local");
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };
  try {
    const hit = match(req.method, url.pathname.replace(/\/$/, ""));
    if (!hit) return send(404, { error: "No such endpoint." });
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJson(req) : {};
    const user = PUBLIC.has(hit.pattern) ? null : await currentUser(req);
    if (user && !PUBLIC.has(hit.pattern) && /^\/api\/(places\/(near|translate)|events|map)/.test(hit.pattern) && !user.favourites?.length) {
      throw new HttpError("Add a few things you love first, so picks can match your taste.", 409);
    }
    return send(200, await hit.fn({ req, body, user, params: hit.params, query: url.searchParams }));
  } catch (err) {
    const known = err instanceof HttpError || err instanceof QlooError || err instanceof AuthError || err instanceof people.RuleError || err instanceof StoreError || err instanceof AvatarError;
    if (!known) console.error(err);
    return send(known ? err.status || 400 : 500, { error: known ? err.message : "Something went wrong on our side. Please try again." });
  }
}
