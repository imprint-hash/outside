/**
 * City, events and map routes. Same [method, path, handler(ctx)] format as
 * the router; `publicPaths` need no signed-in user.
 */

import { HttpError } from "../http.js";
import { eventsForYou, afterTheShow } from "../events.js";
import { allEvents, refreshLagosEvents } from "../city-events.js";

export const routes = [
  ["GET", "/api/events", async ({ user, query }) => ({ events: await eventsForYou({ favourites: user.favourites, events: await allEvents(), from: query.get("from"), to: query.get("to") }) })],
  ["GET", "/api/events/:id/after", async ({ user, params }) => {
    const ev = (await allEvents()).find((e) => e.id === params.id);
    if (!ev) throw new HttpError("No such event.", 404);
    return { event: ev.title, places: await afterTheShow({ event: ev, favourites: user.favourites }) };
  }],

  // The daily events search. Called by a scheduler with the admin token.
  ["POST", "/api/admin/refresh-events", async ({ req }) => {
    const want = process.env.ADMIN_TOKEN;
    if (!want || req.headers.authorization !== `Bearer ${want}`) throw new HttpError("Not allowed.", 403);
    return refreshLagosEvents();
  }],
];

export const publicPaths = ["/api/admin/refresh-events"];
