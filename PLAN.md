# PLAN.md: Outside, build plan (Mon 26 Oct to deadline)

## 0. Read this first: facts checked while planning

1. **The deadline date doesn't match its weekday.** 26 Oct 2026 is a Monday, so Thursday is **29 Oct**, not 30. "Fri 31 Oct 04:45 WAT" falls on a Saturday. Check the date on Devpost today. Until then, **plan to Thu 29 Oct, 22:00 WAT** as the latest submit time.
2. **Things that are broken right now** (Step 0 fixes them):
   - `src/router.js` imports `./lagos-events.js`, which no longer exists, so the server won't start.
   - `test/events-vetting.test.js` and `bin/find-events.mjs` import the same missing file.
   - `/api/places/near` and `/api/places/translate` call `resolveOrigin` with no city, so the city defaults to "Lagos". They also pass no `timeZone`.
3. **Where Qloo's review data lives** (checked live on Dishoom Shoreditch):
   - `/search` and `/entities` return **slim** properties: `business_rating`, `hours`, `specialty_dishes`, `good_for`, but **no `keywords` and no `*_description`**.
   - `/v2/insights` results carry the full set: `keywords [{name,count}]`, `service_description`, `ambience_description`, `customer_demographics_description`, `overall_description`, `short_description`, `cuisine_description`, `specialty_dishes`, `business_rating`. These are top-level fields in `properties`, not under a `summary` key.
   - To fetch **one** place with full data, call `insights({"filter.type":"urn:entity:place","filter.results.entities":id,take:1})` **with no signal**. This works.
   - The same call **with** `signal.interests.entities` returns `[]`. So a single place's taste match can't come from that call. A 300 m radius search with signals didn't contain the place either. **Decision:** the card gets `fit.match` from the map or list result the client already holds (the client sends `?match=`). It shows null when the client has no match. Don't spend a Qloo call on it.
   - `insights({"filter.type":"urn:entity:artist","signal.interests.entities":<placeId>})` returns sensible artists (Dishoom → Mura Masa, Stormzy). This confirms "who to book next" will work.
4. **Existing tests:** 18 offline tests (units 10, vetting 3, rules 5) plus 1 live flow test that is skipped without `LIVE=1`, so 19 in total. All must stay passing.

---

## 1. Step 0: shared groundwork (one person, about 90 minutes, before the split; these files are then FROZEN)

The lead (or Coder A) does this first. Commit it, then both coders branch from it.

| File | Change |
|---|---|
| `src/http.js` (new) | `export class HttpError extends Error { constructor(message, status = 400) }`. Router and route modules import it from here. |
| `src/router.js` | Remove the `lagos-events` import and `allEvents()`. Move these routes **out** of the router: `GET /api/events`, `GET /api/events/:id/after` and `POST /api/admin/refresh-events` go to `src/routes/city-map.js`; `GET /api/organiser/dashboard` and `POST /api/organiser/events` go to `src/routes/venue.js`. Then `const routes = [...core, ...cityMap.routes, ...venue.routes]` (core first, so `GET /api/places/tonight` still wins over `/api/places/:id`). `PUBLIC = new Set([...core, ...cityMap.publicPaths, ...venue.publicPaths])`. Extend the "needs favourites" regex to `^\/api\/(places\/(near|translate)|events|map)`. Fix `/api/places/near` and `/translate` to use `cityOf(user)`: `resolveOrigin(x, city.name)`, `timeZone: city.tz`, and translate defaults to `user.city`. Known-error check: `err instanceof HttpError` (subclasses count). |
| `src/routes/city-map.js`, `src/routes/venue.js` (new) | Each exports `routes` (same `[method, path, handler(ctx)]` format) and `publicPaths` (array). Each starts with just the moved routes, wired to the old behaviour, so everything works. |
| `src/city-events.js` | Only add `export const refreshLagosEvents = (o) => refreshCityEvents("Lagos", o)`, or temporarily keep the old names. Coder A generalises the rest. |
| `src/store.js` | Add `"reviews"`, `"searches"`, `"profiles"` to `COLLECTIONS`. |
| `src/cities.js` | Add `cc` (ISO-2: NG, GH, KE, ZA, EG, MA, GB, FR, DE, NL, PT, ES, IT, TR, AE, IN, TH, SG, JP, KR, AU, US, CA, MX, BR) and `slug` (`"new-york"`) to each city. Add `export const publicCity = (c) => ({ name, country, cc, tz, lat, lon })`. |
| `supabase/schema.sql` | Add indexes on `(data->>'venueId')`, `(data->>'placeId')`, `(data->>'city')`. Re-run it in Supabase. |
| `test/events-vetting.test.js`, `bin/find-events.mjs` | Import from `../src/city-events.js`. |
| `test/helpers/qloo-stub.js` (new; not matched by `test/*.test.js`) | `export async function startQlooStub(handler) → { url, calls, close }`. A `node:http` server where `handler(path, params)` returns JSON. Tests set `QLOO_BASE_URL=url` and `QLOO_API_KEY="test"` **before** importing `src/`. |
| `api/index.js`, `vercel.json`, `LICENSE` (MIT) | See §4. |

Done when `npm test` passes (18 pass, 1 skipped) and `npm start` serves `/api/health`.

---

## 2. Backend work packages (run in parallel, no file overlap)

### Ownership

| Package A, "City, events, people-likeness, map" | Package B, "Card, reviews, rides, venues, demo" |
|---|---|
| `src/city-events.js`, `src/events.js`, `src/cities.js` (after Step 0), `src/geo.js`, `src/people.js`, `src/taste.js`, `src/auth.js` | `src/places.js`, `src/organiser.js` |
| new: `src/likeness.js`, `src/crowd.js`, `src/map.js`, `src/background.js` | new: `src/place-card.js`, `src/reviews.js`, `src/rides.js`, `src/demo.js` |
| `src/routes/city-map.js`, `bin/find-events.mjs` | `src/routes/venue.js`, `bin/seed-demo.mjs` |
| tests: `events-vetting`, `rules` (only if a people.js change breaks it), new `city-events`, `city`, `crowd`, `map` | tests: new `rides`, `reviews`, `place-card`, `organiser`, `demo` |

**Contracts between A and B.** Each package only imports these from the other and never edits the other's files. Each side ships its contract **first** (by Tue 12:00):

- From A, used by B:
  - `likeness.js`: `profileFor(user, cityName) → Promise<profile|null>` and `likeness(viewer, other, cityName) → Promise<{ match:number|null, because, line }>`
  - `crowd.js`: `crowdAt(viewer, venueIds|null, { now, cityName, faces }) → Promise<Map<venueId, Crowd>>`, plus `LIKE_YOU`
- From B, used by A:
  - `rides.js`: `rideLinks({ from, to, toName, cc }) → { uber, bolt, maps }` (a pure function)
- Both sides use `cityOf`/`cityNamed`/`cityNear` from `cities.js`. B only reads it.

---

### Package A

**`src/background.js`**
- `export function background(promise)`. On Vercel it hands the promise to the platform's `waitUntil`: `globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil`. This is what `@vercel/functions` does internally, so nothing needs installing. Elsewhere it attaches `.catch(console.error)` and lets the promise run.

**`src/likeness.js`** (store-backed taste profiles, so cold serverless starts don't rebuild everyone's profile)
- `profileFor(user, cityName)`:
  - Return null if the user has no favourites.
  - Key: `sha1(cityName + "|" + sortedFavouriteIds)`.
  - Look up memory, then `get("profiles", key)` (rebuild if `builtAt` is older than 7 days), then `buildProfile(...)` followed by `put("profiles", {id:key, city, builtAt, ...profile})`.
  - The key holds no user id, so stored profiles aren't personal data.
- `likeness(viewer, other, cityName)` → `compareProfiles` + `matchLine`. If either profile is null: `{match:null, because:{bothLove:[],music:[],places:[],wouldGoTo:[]}, line:"Hasn't added their taste yet"}`.
- `people.js` `profileOf` switches to `profileFor`. `taste.js` is unchanged apart from the existing in-memory cache.

**`src/people.js`**
- `checkIn` stores `city: cityOf(user).name` on the check-in.
- Export `activeCheckins`, `blocked` and `allowedToSee` for crowd.js.
- Add `setStay(user, stay)`:
  - `resolveOrigin(stay, city.name)` → `{lat, lon, label}`.
  - If `distanceM(stay, cityCentre) > 60_000`, throw `RuleError("That's outside {city}. Change your city first.", 422)`.
  - Save it as `user.stay`.
- `setCity` (already present) also clears `user.stay` when the stay is more than 60 km from the new city.

**`src/auth.js`**: `selfView` adds `stay: u.stay || null` and `role: u.role || null`.

**`src/geo.js`**: `export function nextLocalHour(now, timeZone, hour = 6) → Date`, the next 06:00 local time. Use it in `people.untilSixAm` and in map windows.

**`src/crowd.js`**
- `export const LIKE_YOU = 50;` (`STRONG_MATCH = 60` stays in people.js).
- `crowdAt(viewer, venueIds, { now = new Date(), cityName = cityOf(viewer).name, faces = false })` returns a Map from `venueId` to:
  ```
  { venueId, venueName, location, here, likeYou, strong, plumbob: "strong"|"okay"|null,
    faces?: [{ avatar, bubbles: string[≤3], match, line }] }   // no names, no ids
  ```
  Rules:
  - Look at active check-ins in the city (`c.city === cityName`, or `cityNear(c.venueLocation)` for legacy rows), restricted to `venueIds` when given.
  - Skip the viewer, blocked pairs, and anyone with visibility `nobody`.
  - `here` counts the rest. `likeYou` counts those with match ≥ `LIKE_YOU`; `strong` counts those with match ≥ `STRONG_MATCH`.
  - `plumbob` is `strong` if any strong match, else `okay` if any like-you, else null. These are the keys of `PLUMBOB` in `public/avatar.js`.
  - `faces` (at most 6) only include people `allowedToSee(viewer, …)` permits. If the viewer is `nobody`, return counts only and `faces: []`.
  - Build profiles with at most 4 running at once.
- Names, and the ability to say hi, come only from the existing `whoIsHere` once you're checked in at that venue. This keeps the people.js rule.

**`src/city-events.js`** (generalised; Lagos keeps its areas and its Detty December line)
- `eventPrompt(city, today)`:
  - City, country and local UTC offset (via `Intl … timeZoneName:"longOffset"`).
  - "Most of all the next 14 days; up to 120."
  - Kinds: concerts, club nights with named DJs, festivals, comedy.
  - If only the date is known, use 20:00 local time.
  - Only for Lagos: the "Detty December events matter most" line.
  - The rules section stays word for word.
- `searchCityEvents(city, { now, client })`: same loop as today, with `user_location: { type:"approximate", city: city.name, country: city.cc, timezone: city.tz }`. The schema's `area` description becomes "neighbourhood or district of {city}".
- `placeVenue(name, area, city)`:
  1. Qloo `findEntity(name, place, {city: city.name})`; accept it if within 50 km of the city centre. Returns `{lat, lon, approximate:false, qlooId}`.
  2. Lagos only: `LAGOS_AREAS`.
  3. Otherwise the city centre with `approximate: true`.
- `vetEvents(raw, sourcesSeen, now, city = cityNamed("Lagos"))` keeps its current argument order so the existing test still passes. Each kept event gets:
  - `city: city.name`
  - `artistIds: {name: qlooId|null}`, resolved once here, so map requests never re-search artists
  - id hash `${title}|${date}` for Lagos (keeps existing ids) and `${city.slug}|${title}|${date}` for other cities
- `refreshCityEvents(cityName, { now, client })` → `{ city, kept, expired, total, dropped, usage }`. Only expires `status:"found"` events of **that** city (`(e.city || "Lagos") === cityName`).
- `eventsInCity(cityName, { now })`: the old `allEvents()` moved here and filtered by city. Seeded `data/events.json` events are included **only when cityName is "Lagos"**. Organiser events have a `city` field.
- `ensureFresh(cityName, { now, waitMs = 8000, refresh = refreshCityEvents }) → { lastSearchAt, refreshing, firstSearch }`. The marker is in `searches/<slug>`: `{ city, status: "running"|"done"|"failed", startedAt, lastSearchAt, lastError, kept }`.
  - `done` and `lastSearchAt` under 24 h old: fresh, do nothing.
  - `running` and `startedAt` under 10 minutes old: `refreshing: true`, start nothing.
  - `failed` and `startedAt` under 1 hour old: back off.
  - Otherwise: write `running`, start `refresh()`, and on completion write `done`/`failed`.
  - If the city has never had events (`firstSearch`), `await Promise.race([p, sleep(waitMs)])`. Otherwise call `background(p)` and return at once.
- `activeCities({ now, days = 7 }) → string[]`: always `["London", "Lagos"]`, plus the `city` of users updated or checked in within `days`, capped at 8.

**`src/events.js`**
- `eventsForYou` uses `ev.artistIds[name]` when present and only falls back to `artistId(name)` otherwise.
- `afterTheShow` passes `timeZone`.
- Add `beforeTheShow` (same idea, at `starts − 2h`, kinds `["restaurant"]`). This is a stretch goal.

**`src/map.js`**
- Filters:
  ```js
  export const MAP_KINDS = { food:{places:["restaurant"],events:[]}, drinks:{places:["bar","lounge"],events:[]},
                             music:{places:["club"],events:["concert","festival","party","other"]}, comedy:{places:[],events:["comedy"]} };
  export function timeWindow(when, now, tz) // → { from, to, placeRule:"openNow"|"openSoon"|"any" }
  ```
  - `now`: events with `starts ≤ now < ends`; places open now (or hours unknown).
  - `tonight`: events with `ends > now` and `starts < nextLocalHour(6)`; places open now or opening within 180 minutes.
  - `week`: events with `ends > now` and `starts < now + 7d`; no hours filter on places.
- `mapFor(viewer, { when="tonight", kinds=Object.keys(MAP_KINDS), origin, now })`:
  1. Origin is `origin`, else `viewer.stay`, else the city centre.
  2. Call `nearYou` with the union of place categories. Radius 4 km for now/tonight, 8 km for week; `limit 40`; `timeZone: city.tz`.
  3. Append venues that have check-ins but aren't in the Qloo result. Use the check-in's `venueName`/`venueLocation`, with `match: null`. This makes sure demo venues always show.
  4. `ensureFresh(city)`, then `eventsForYou` over `eventsInCity` filtered by window and kinds, limit 20.
  5. `crowdAt(viewer, null)` once, joined onto venues by id and onto events by `venue.qlooId`.
  6. Sort venues by `likeYou` desc, then the existing `rankScore` order.

**Routes in `src/routes/city-map.js`**

| Method, path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/cities` | public | none | `{ cities: [publicCity…], default: "Lagos" }` |
| `POST /api/me/city` | user | `{ city }` or `{ lat, lon }` | `{ user: selfView, city: publicCity }`. Also `background(ensureFresh(city))` to warm events. 400 if the city isn't covered. |
| `POST /api/me/stay` | user | `{ stay: "The Hoxton Shoreditch" \| {lat,lon,label} }` | `{ user, stay: {lat,lon,label} }`. 404 if not found, 422 if too far away. |
| `GET /api/events?when=&from=&to=` | user + favourites | | `{ city, events: [eventsForYou shape + city + likeYou], status: {lastSearchAt, refreshing, firstSearch} }` |
| `GET /api/events/:id` | user + favourites | `?lat&lon` optional | `{ event (scored), crowd: Crowd\|null, ride: rideLinks(...), trip }` |
| `GET /api/events/:id/after` | user | | unchanged; uses `eventsInCity(user.city)` |
| `GET /api/map?when=now\|tonight\|week&kinds=food,drinks&lat=&lon=` | user + favourites | | see below |
| `POST /api/admin/refresh-events` | `ADMIN_TOKEN` | `{ city? }` | `{ results: [refreshCityEvents…] }` |
| `GET /api/cron/events` | `Bearer CRON_SECRET` (public path) | | runs `refreshCityEvents` on `activeCities()` with `Promise.allSettled` → `{ results }` |

`/api/map` response:
```json
{ "city": {"name","tz","lat","lon","cc"}, "origin": {"lat","lon","label"}, "when": "tonight", "kinds": ["food"],
  "venues": [{ "id","name","category","location","area","match","fit","why","rating","price","hours","trip","image",
               "crowd": { "here","likeYou","strong","plumbob" } }],
  "events": [{ "id","title","eventKind","starts","ends","venue":{"name","lat","lon","approximate","qlooId"},
               "fit","label","why","artists","source","crowd": {…}|null }],
  "eventsStatus": { "lastSearchAt","refreshing","firstSearch" }, "generatedAt": "…" }
```
Unknown `when` or `kinds` → `HttpError` 400.

**`bin/find-events.mjs`**: `node bin/find-events.mjs [City]`, default London.

**Package A tests** (offline; Qloo stub plus a fake Anthropic `client` with `beta.messages.create`):
- `events-vetting.test.js`: the 3 existing tests stay, now importing city-events.js.
- `city-events.test.js`:
  - the prompt names the city and country; Detty December appears only for Lagos
  - `user_location` carries the city's `cc` and `tz`
  - a non-Lagos venue Qloo doesn't know lands on the city centre with `approximate`
  - kept events carry `city` and `artistIds`
  - a refresh expires only the same city's events
  - `ensureFresh`: fresh means no call; stale returns at once and the refresh runs; first-time waits at most `waitMs`; a running marker stops a second run; a failure backs off for 1 hour
- `city.test.js`: `setCity` by name, GPS and unknown city; `setStay` too far gives 422; `GET /api/cities` through `handle` with a fake `req`/`res`
- `crowd.test.js`: `nobody` and blocked people aren't counted; threshold edges at 49, 50 and 60; plumbob colours; no `firstName` or `userId` anywhere in the output; `faces` respect `strong` and `verified`
- `map.test.js`: London `timeWindow` across midnight; kinds mapping; a venue with check-ins but missing from Qloo still appears; Lagos seeded events never show in London

---

### Package B

**`src/places.js`**
- Export `saying(keywords, limit = 4)`. Add a `limit` parameter; the card uses 8.
- Add `placeFull(id)`: `insights({"filter.type":"urn:entity:place","filter.results.entities":id,take:1})`, falling back to `entityById(id)` if empty. 404 if neither finds it.
- `CATEGORIES` stays as it is.

**`src/rides.js`** (pure; ship first)
- `rideLinks({ from, to, toName, cc }) → { uber: string|null, bolt: string|null, maps: string }`
- `uber`:
  ```
  https://m.uber.com/ul/?action=setPickup&pickup[latitude]=…&pickup[longitude]=…&dropoff[latitude]=…&dropoff[longitude]=…&dropoff[nickname]=<encodeURIComponent(name)>
  ```
  Use `pickup=my_location` when `from` is missing. Set it to null where Uber doesn't run: `UBER_NOT = ["MA","TH","SG"]`.
- `bolt`: only in `BOLT_CC = ["NG","GH","KE","ZA","GB","FR","DE","NL","PT","ES"]`. Use `https://bolt.eu/` (opens the app or store). The UI shows "Open Bolt, destination copied" and copies the address. Bolt has no reliable public pre-filled universal link. **Test on a phone on Wednesday**; if a verified one turns up, swap it in.
- `maps`: `https://www.google.com/maps/dir/?api=1&destination=lat,lon` (plus `&origin=` when known). Always present. It needs no key and is the fallback for TH and SG.

**`src/reviews.js`**
- `export class ReviewError extends HttpError {}`
- `addReview(user, { placeId, stars, note }, now = new Date())`:
  - `stars` must be an integer from 1 to 5. `note` is stripped of control characters and trimmed; 140 characters max (400 if longer); no URLs (400).
  - Requires a check-in by this user at `placeId` with `at ≥ now − 48h`. Otherwise 403: "Check in there first; you can rate a place for 48 hours after."
  - `day` is the local date (in the check-in city's tz). The id is `${userId}|${placeId}|${day}`; if that id exists, 409 "You've already rated it today."
  - Stores `{ id, userId, placeId, placeName, city, stars, note, day, at, demo: !!user.demo }`.
- `pendingReviews(user, now)` returns check-ins from the last 48 h with no review from this user for that place: `[{ placeId, placeName, at }]`.
- `summarize(reviews, { viewerId, similarity })`, pure, where `similarity(review) → match|null`:
  ```
  { overall: { avg, count },
    likeYou: { avg|null, count, enough: count >= 2 },   // only reviews with match ≥ LIKE_YOU;
                                                         // weight w = (match − 40) / 60, so weighted avg = Σw·stars / Σw
    notes: [{ stars, note, match, because: "Loves Tems · Afrobeats", at }] }  // ≤ 5, best match first; never a name or id
  ```
  The viewer's own review is left out of `likeYou`. `avg` is rounded to 0.1.

**`src/place-card.js`**
- `placeCard(viewer, placeId, { origin, match = null, now })`:
  1. `placeFull(id)` → `shapePlace` (with `timeZone: city.tz` and `origin`).
  2. `qloo: { rating, keywords: saying(kw, 8), summaries: { service, ambience, crowd, overall, dishes } }`. Each summary is cut to at most 2 sentences or 220 characters. `dishes` comes from `specialty_dishes[].name`. Missing fields are null.
  3. `ours: summarize(list("reviews",…,{placeId}), {similarity: r => likeness(viewer, reviewer, city).match})`.
  4. `crowd: crowdAt(viewer, [placeId], {faces:true}).get(placeId) ?? {here:0,…}`.
  5. `you: { checkedInHere, canReview, reviewedToday }`. `canSayHi` equals `checkedInHere`, which then unlocks the existing `/api/here`.
  6. `ride: rideLinks({ from: origin, to: location, toName: name, cc: city.cc })`.
  7. `fit: { match, label }`, with `match` passed in from the client (see §0.3).

**`src/organiser.js`**
- The existing city-wide `dashboard()` stays (rename it to `cityDashboard`) and switches to `profileFor(u, city)`.
- New `venueDashboard({ venueId, cityName, days = 28, want = null, now })`:
  - **visitors**: distinct users with check-ins at the venue in the last `days`, plus `demoUsers` (how many of them are demo users, so it's labelled honestly). If there are fewer than 3, return `{ visitors, note }` only.
  - **byWeekday**: Mon to Sun in the city's tz. Each day has `{ day, checkins, topSounds: tally(profile.music top 5), topLoves: tally(favourite names) }`. Days under 3 people return only `{ day, checkins: "fewer than 3" }`.
  - **ratings**: `{ overall: {avg,count}, byTaste: [{ group: tidy(music tag), avg, count }] }`. Each reviewer belongs to their top 3 music tags; groups under 3 are folded into `other: { count }`.
  - **bookNext**:
    - Signal: the crowd's 5 most-loved artist ids (any count; the output names Qloo artists, never people) plus `venueId`.
    - Call `insights({"filter.type":"urn:entity:artist", signal, take: 20})`.
    - Drop artists the crowd already loves. Keep 8: `{ id, name, image, affinity: %, because: [top crowd loves ≥3 people] }`.
  - **gap** (stretch, only if `want` is given): `findEntity(want)`, then the share of the crowd whose profile music overlaps the want's tags. Shown as "x of y", folded under 3.
  - Includes `privacy` text, as today.

**`src/demo.js`**
- `DEMO_USERS`: 10 entries `{ slug, firstName: "Demo · Amara", taste: [[type,name]…], venue: "Ronnie Scott's", visibility }`, spread over London. Taste groups:
  - Afrobeats: Burna Boy, Tems, Wizkid
  - UK rap: Stormzy, Dave
  - Jazz: Ezra Collective, Kamasi Washington
  - R&B: SZA, Jorja Smith
  - Electronic: Fred again.., Peggy Gou
  - Indie: Arctic Monkeys

  Venues: Ronnie Scott's, Jazz Cafe Camden, Dishoom Shoreditch, XOYO, Sketch, Brixton Jamm (verify each with `findEntity`). Make at least 3 people per venue for 2 venues, so the venue dashboard has something to show.
- `seedDemo({ cityName: "London", now })`:
  - Users get fixed ids `demo-<slug>`, email `<slug>@demo.outside.invalid`, `demo: true`, `city`, favourites from `resolveFavourites` (live Qloo).
  - Fresh check-ins.
  - About 12 reviews with fixed ids.
  - One organiser account `demo-venue`, "Demo · Jazz Cafe", `role: "organiser"`, `venueId`.
  - Idempotent: running it twice gives the same records.
  - Returns counts plus a **match matrix**: print the pairwise `likeness` values so `LIKE_YOU` can be tuned.
- `renewDemoCheckins(now)`: re-checks-in every `demo:true` user at their venue (expires 06:00 local).
- `removeDemo()`: deletes every record whose `id`, `userId`, `from`, `to`, `by` or `who` starts with `demo-`, and reviews with `demo:true`.

**`bin/seed-demo.mjs`**: `node bin/seed-demo.mjs [--city London] [--renew] [--remove]`. It prints what it did and the match matrix.

**Routes in `src/routes/venue.js`**

| Method, path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/places/:id` | user | `?lat&lon&match` | `placeCard` shape (above) |
| `POST /api/reviews` | user | `{ placeId, stars, note }` | `{ review }`, or 400/403/409 |
| `GET /api/reviews/pending` | user | none | `{ pending: [...] }` |
| `POST /api/organiser/venue` | organiser | `{ venueId }` | `{ venue: {id,name,location} }`; checked via `entityById` |
| `GET /api/organiser/dashboard` | organiser | `?days&want` | `{ venue: venueDashboard\|null, city: cityDashboard, events }` |
| `POST /api/organiser/events` | organiser | as today | as today, plus `city: cityNear(venue)?.name ?? user.city`, plus `artistIds` resolved |
| `GET /api/cron/demo` | `Bearer CRON_SECRET` (public path) | none | `renewDemoCheckins` → `{ renewed }` |

**Package B tests**:
- `rides.test.js`: exact Uber URL with encoding; `my_location` when no origin; Bolt only in its countries; Uber null in MA, TH and SG
- `reviews.test.js`: no check-in → 403; check-in 49 h ago → 403; second review the same day → 409; next local day OK; 141 characters → 400; URL → 400; weighted average maths; own review excluded; notes never contain names
- `place-card.test.js`, with a stub insights entity: summaries trimmed; 8 keywords with `EMPTY_WORDS` dropped; missing fields are null; falls back to `/entities`
- `organiser.test.js`: groups under 3 folded; weekday bucketing in London tz on Fri 23:30 vs Sat 00:30; ratings by taste group; `bookNext` excludes known artists; fewer than 3 visitors gives a note only
- `demo.test.js`: seeding twice gives the same record count; `removeDemo` leaves non-demo users untouched (Qloo stubbed)

---

## 3. Frontend: screens, states, data, build order (no visuals until the reference design arrives)

**Shared**
- Plain multi-page files in `public/` (`cleanUrls`) plus `public/api.js`.
- Polling instead of sockets: inbox every 20 s, chat every 4 s, meet-up position every 10 s, events-refreshing every 15 s (for at most 3 minutes).
- **Map library: Leaflet 1.9.4** from a pinned CDN (`https://unpkg.com/leaflet@1.9.4/dist/leaflet.js` and `.css`, with SRI hashes). It's a CDN script tag, not an npm install, but per the brief's rules **ask the user first**.
- Tiles, no key needed:
  - CARTO `dark_all` (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`), which suits the night theme. Attribution: "© OpenStreetMap contributors © CARTO".
  - Fallback: OSM standard tiles with "© OpenStreetMap contributors".
  - The attribution must stay visible.
- Markers are `L.divIcon` with an avatar or plumbob SVG, so there are no image assets.

| # | Screen (file) | States | Data |
|---|---|---|---|
| 1 | **City + stay** (taste.html step 3, reworked) | picking city (searchable list), GPS asking/denied/not covered, stay typing/not found/too far, saved | `GET /api/cities`, `POST /api/me/city`, `POST /api/me/stay`, `GET /api/me` |
| 2 | **Tonight map** (tonight.html) | loading, map + bottom list, filter when/kinds, events "still searching" banner, empty ("quiet near you, try This week"), error, checked-in chip, inbox badge | `GET /api/map`, `GET /api/events` (poll while `refreshing`), `GET /api/checkin`, `GET /api/hello/inbox` |
| 3 | **Place card** (sheet) | skeleton, loaded, checked-in-here, can-rate, ride sheet | `GET /api/places/:id?match=`, `POST /api/checkin`, `DELETE /api/checkin` |
| 4 | **Event card** (sheet) | loaded (lineup with per-artist fit), after-the-show, ride | `GET /api/events/:id`, `GET /api/events/:id/after` |
| 5 | **People here** | not checked in, invisible, empty, list with Say hi, sent, rate-limited, group-minded note | `GET /api/here`, `POST /api/hello`, `POST /api/me/visibility` |
| 6 | **Hellos inbox** | empty, pending items, accepted → chat | `GET /api/hello/inbox`, `POST /api/hello/:id/answer` |
| 7 | **Chat** | closed-until-accepted, chatting, blocked; menu for block/report | `GET/POST /api/hello/:id/messages`, `POST /api/block`, `POST /api/report` |
| 8 | **Meet-up** | waiting for them, live (two dots, metres apart, minutes left), ended (met / time / left area / stopped / blocked) | `POST /api/hello/:id/meetup`, `GET /api/meetup/:id`, `POST /api/meetup/:id/position`, `POST /api/meetup/:id/stop` |
| 9 | **How was it?** | prompt on app open if pending, stars + note (≤140 counter), done, already rated | `GET /api/reviews/pending`, `POST /api/reviews` |
| 10 | **Sign-up door** (index.html + signup.js, replaces the danfo) | idle night street, windows light per valid field, invalid hints, submitting, returning user, door opens → avatar walks out → `/taste` | `POST /api/auth/signup` |
| 11 | Avatar, taste (existing steps 1–2) | restyle only | existing |
| 12 | **Venue dashboard** (venue.html) | not an organiser (sign up as venue), pick venue, under-3 note, panels (weekday crowd, ratings by taste, book next, events), add-event form | `POST /api/auth/signup {organiser:true}`, `GET /api/search?type=place`, `POST /api/organiser/venue`, `GET /api/organiser/dashboard`, `POST /api/organiser/events` |
| 13 | Settings / share my night | visibility, change city, sign out, share | `POST /api/me/visibility`, `GET /api/share-night` (`navigator.share`, else copy) |

**Build order:** 1 → 2 → 3 → 5 → 6 → 7 → 9 → 4 → 10 → 12 → 8 → 13.

Screens 5–7 use APIs that exist today, so they can start before Package A/B land.

**Cut if late:** 8 (live meet-up map; keep the text version), 13 (share), plan-before, and the "gap" panel.

---

## 4. Deploy (Vercel, Frankfurt) and README

**`api/index.js`**:
```js
import { handle } from "../src/router.js";
export default (req, res) => handle(req, res);
```

**`vercel.json`**:
```json
{ "regions": ["fra1"], "cleanUrls": true, "outputDirectory": "public",
  "functions": { "api/index.js": { "maxDuration": 300, "includeFiles": "data/events.json" } },
  "rewrites": [{ "source": "/api/:path*", "destination": "/api" }],
  "crons": [{ "path": "/api/cron/events", "schedule": "0 4 * * *" },
            { "path": "/api/cron/demo",   "schedule": "0 16 * * *" }] }
```
- **Verify first** that `req.url` keeps the original `/api/...` path after the rewrite. Test `/api/health` and `/api/places/<id>`.
- If it doesn't, rewrite to `/api?__p=:path*` and rebuild `req.url` in `api/index.js`.

**Environment variables** (Production): `QLOO_API_KEY`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_TOKEN`, `CRON_SECRET`.
- Never set `OUTSIDE_STORE`, because the file system is read-only on Vercel.
- `/api/health` must report `store: "supabase"`.

**How to deploy:** import the GitHub repo in the Vercel dashboard, so nothing needs installing locally. Hobby crons run once a day within the hour; that's fine.

**After the first deploy:**
1. `ADMIN_TOKEN` → `POST /api/admin/refresh-events {city:"London"}` and `{city:"Lagos"}`
2. `node bin/seed-demo.mjs` against hosted Supabase
3. Open the London map

**README outline:**
1. One line + 30-second GIF
2. Live demo link + demo login
3. What it does (people / venues)
4. Why Qloo is essential
5. **Qloo calls table**
6. Privacy rules
7. Architecture (one handler, Supabase one table, Claude for event finding only)
8. Run locally (`.env` names, `npm start`, `npm test`, `npm run test:live`, `node bin/seed-demo.mjs`)
9. Deploy
10. Demo data notice
11. Licence (MIT)

**Qloo calls table:**

| Feature | Endpoint | Key params | When | Cached |
|---|---|---|---|---|
| Taste picker | `/search` | `query, types` | typing | 6 h memory |
| Favourites to entities | `/search` (findEntity) | | save taste | 6 h |
| Taste profile | `/v2/insights` | `filter.type=urn:tag`, `filter.tag.types=genre:music/place/media`, `signal.interests.entities` | first match in a city | store `profiles` |
| City picks (profile) | `/v2/insights` | `filter.type=place`, `filter.location.query=city`, signals | same | store |
| Map / near you / tonight | `/v2/insights` | `filter.location=POINT`, `radius`, `filter.tags=category`, signals | map load | 6 h |
| Lineup scoring | `/v2/insights` | `filter.type=artist`, `filter.results.entities=lineup`, signals | events list | 6 h |
| Event venue placing | `/search` | venue name in city | daily search | in event record |
| Place card reviews | `/v2/insights` | `filter.results.entities=<id>` (no signal) | open card | 6 h |
| Check-in venue | `/entities` | `entity_ids` | check-in | 6 h |
| Who to book | `/v2/insights` | `filter.type=artist`, signals = crowd's artists + venue | dashboard | 6 h |

---

## 5. Timeline (WAT; deadline assumed Thu 29 Oct, see §0.1)

| When | Lead / frontend | Coder A | Coder B |
|---|---|---|---|
| Mon 22:00 to 24:00 | Save the plan; confirm the deadline on Devpost | Step 0 | |
| Tue 08:00 to 12:00 | Collect the reference design | `background`, `likeness`, `crowd`, people.js changes, city/stay routes and tests (**contract by 12:00**) | `rides` (**by 10:00**), `places` exports, `place-card`, `reviews` and tests |
| Tue 12:00 to 19:00 | Start screens 5–7 on existing APIs | `city-events` generalised, `ensureFresh`, `map`, events routes, cron | `organiser` venue dashboard, `demo.js`, seed script, venue routes |
| Tue 19:00 to 22:00 | **Integration:** `npm test` green, live London smoke, first Vercel deploy, seed hosted DB, tune `LIKE_YOU` from the match matrix | fixes | fixes |
| Wed | Screens 1, 2, 3, 9 (needs the design) | Event detail, plan-before, bug fixes, performance (map under 4 s warm) | Bolt phone check, dashboard polish, flow.test additions (reviews, map, card) |
| Thu 08:00 to 14:00 | Screens 4, 10, 12 (8 and 13 if time) | Freeze backend at 12:00 | README, Qloo table, LICENSE |
| Thu 14:00 to 18:00 | Re-seed demo, record the London video (land → map glow → card with two ratings → check in → hi → how was it → venue dashboard) | | |
| Thu 18:00 to 22:00 | Devpost text, links, submit (aim for 20:00) | | |

---

## 6. Top risks and what to do about them

1. **Wrong deadline** (§0.1). Confirm it today and plan to the earlier date.
2. **Event search is slow or the first visit shows nothing.**
   - A Claude web search takes 60–180 s.
   - Pre-warm London and Lagos (cron + admin call). Keep `ensureFresh` from blocking for long (8 s). Show a "still searching" banner while the client polls.
   - Watch the cost: one search per active city per day.
3. **Serverless background work gets cut off.**
   - Use `background()`/`waitUntil` with `maxDuration` 300.
   - The marker's 10-minute `running` timeout stops a hung search from blocking the next one.
4. **Cold Qloo caches on Vercel.** Profiles and artist ids are persisted in the store, and the map makes at most about 6 Qloo calls when warm. Watch for 429s; there's one retry already.
5. **Match scores too low for anyone to look "like you" in the demo.** Jaccard-based scores can sit low. Tune `LIKE_YOU` and `STRONG_MATCH` from the seed's match matrix and keep the thresholds in one place.
6. **Vercel rewrite and `req.url`.** Verify on the first deploy; the fallback is in §4.
7. **Frontend time.** The UI waits on the reference design, so it's on the critical path. Keep the cut list and start the API-ready screens (5–7) on Tuesday.
8. **Privacy optics.**
   - Map counts only, never people's locations.
   - No names until you're checked in at the same venue.
   - Folding under 3 on dashboards.
   - Demo users carry the "Demo ·" label and are counted separately in `demoUsers`.
9. **Ride deep links.** Bolt's pre-filled link isn't verified; it ships as "open Bolt + copied address", and the Maps link always works.
10. **Tile usage.** Keep the attribution visible and low traffic; switch to OSM tiles if CARTO refuses.

### Critical Files for Implementation
- /home/imprint/qloo-hackathon/src/router.js
- /home/imprint/qloo-hackathon/src/city-events.js
- /home/imprint/qloo-hackathon/src/people.js
- /home/imprint/qloo-hackathon/src/places.js
- /home/imprint/qloo-hackathon/src/organiser.js