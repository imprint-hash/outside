/**
 * Place card, reviews and venue (organiser) routes. Same [method, path,
 * handler(ctx)] format as the router; `publicPaths` need no signed-in user.
 */

import { HttpError } from "../http.js";
import { allEvents } from "../city-events.js";
import { dashboard } from "../organiser.js";
import { put } from "../store.js";

export const routes = [
  ["GET", "/api/organiser/dashboard", async ({ user, query }) => {
    if (user.role !== "organiser") throw new HttpError("This view is for event organisers and venues.", 403);
    const mine = (await allEvents()).filter((e) => e.ownerId === user.id || e.status === "announced");
    return dashboard({ days: Math.min(30, Number(query.get("days")) || 7), events: mine });
  }],
  ["POST", "/api/organiser/events", async ({ user, body }) => {
    if (user.role !== "organiser") throw new HttpError("Only organisers can add events.", 403);
    const title = String(body.title || "").trim().slice(0, 120);
    const lineup = (Array.isArray(body.lineup) ? body.lineup : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
    const starts = new Date(body.starts), ends = new Date(body.ends || body.starts);
    const lat = Number(body.venue?.lat), lon = Number(body.venue?.lon);
    if (!title || !lineup.length || isNaN(starts) || isNaN(ends) || ends < starts || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new HttpError("An event needs a title, a lineup, start and end times, and a venue with lat and lon.", 400);
    }
    return { event: await put("events", { title, kind: body.kind || "event", status: "listed", ownerId: user.id, starts: starts.toISOString(), ends: ends.toISOString(), venue: { name: String(body.venue.name || "Venue").slice(0, 80), lat, lon }, lineup }) };
  }],
];

export const publicPaths = [];
