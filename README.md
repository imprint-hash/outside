# Outside

Your kind of places, events and people, wherever you land. Built on Qloo's taste graph.

Live: https://outside-tonight.vercel.app

## For judges

Open the link — no sign-up. You're a guest in London. Venue view: For venues → See the demo venue.

- The guest starts with a taste (Burna Boy, Tems, Ezra Collective, Dishoom), staying at The Hoxton, Shoreditch. Glowing places on the map are where people with that taste are tonight.
- "Make it yours" (top bar) keeps that guest's taste and city and adds a name and password.
- People and reviews marked **Demo** are seeded so the map isn't empty; guests count as demo too. Guests can say hi to demo people only, and are deleted after 48 hours.
- The demo venue (Jazz Cafe) is view-only.

## What it does

You tell Outside a few things you love (artists, places, films, shows, brands). In any of 36 cities it then shows you, on one map, tonight:

**For people**
- **Places that fit your taste**: restaurants, bars, lounges and clubs near where you're staying, ranked by Qloo for your favourites, with travel time at this hour, open now or not, price, what reviewers keep mentioning, and a "why" line that names the favourite that drove the match.
- **Events whose lineup fits you**: concerts, club nights, festivals and comedy, each lineup scored against your taste by Qloo.
- **People like you, as counts**: how many people checked in at each venue share your taste. No names, no locations. Check in yourself (within 300 m, verified by your phone) and you see first names and what you both love, and can say hi. Chat opens only if they say yes; meet-up mode shares live location both ways for 30 minutes at most.
- **Two ratings per place**: everyone's, and the rating from people with your taste (weighted by how alike you are).
- **Ride there**: Uber, Bolt and Maps links with the route filled in.

**For venues**
- **Know your crowd**: who walks in by night of the week, their top sounds and favourite artists, ratings by taste group, and who to book next (Qloo artists this crowd would love). Totals only; any group under 3 people is folded away.
- **Post events**: they reach people whose taste fits the lineup.

## Why Qloo is essential

Every "fits you" in Outside is a Qloo answer. Without Qloo there is no ranking of places by taste, no lineup scoring, no taste profile to compare two people, and no "who to book next". Outside adds what a visitor needs on top (distance, hours, check-ins, privacy rules) but never decides taste itself.

- Places are ranked with `/v2/insights`, signalled by your favourites, and Qloo's explainability scores say which favourite drove each match.
- Two people are compared on the music, place and screen genres and the city picks Qloo builds from what each loves.
- Claude (with web search) only *finds* event listings, because Qloo has none. Qloo decides which events fit you.

## Qloo calls

| Feature | Endpoint | Key params | When | Cached |
|---|---|---|---|---|
| Taste picker | `/search` | `query`, `types` | typing | 6 h in memory |
| Favourites to entities | `/search` | name, type | saving your taste | 6 h |
| Taste profile | `/v2/insights` | `filter.type=urn:tag`, `filter.tag.types=urn:tag:genre:music` / `place` / `media`, `signal.interests.entities` | first match in a city | store (`profiles`, 1 week) |
| City picks (profile) | `/v2/insights` | `filter.type=urn:entity:place`, `filter.location.query=<city>`, signals; kept only if inside the city | same | store |
| Map, near you, tonight | `/v2/insights` | `filter.location=POINT(...)`, `filter.location.radius`, `filter.tags=<category>`, signals, `feature.explainability=true` | map load | 6 h |
| Lineup scoring | `/v2/insights` | `filter.type=urn:entity:artist`, `filter.results.entities=<lineup>`, signals | events list | 6 h |
| Event venue placing | `/search` | venue name, city | daily event search | in the event record |
| Place card reviews | `/v2/insights` | `filter.results.entities=<id>` (no signal) | opening a card | 6 h |
| Check-in venue | `/entities` | `entity_ids` | check-in | 6 h |
| Who to book | `/v2/insights` | `filter.type=urn:entity:artist`, signals = the crowd's artists + the venue | venue dashboard | 6 h |
| Crowd gap | `/search` | artist name | venue dashboard | 6 h |

All Qloo calls go through one function (`src/qloo.js`): the key stays on the server, each call has a 15 s limit, a busy Qloo is retried once, and failures are shown as errors, never as "nothing matches you".

## Privacy rules

These live in the server modules (`src/people.js`, `src/crowd.js`, `src/organiser.js`, `src/reviews.js`), not in the screens, so no client can get around them.

- Only the things people love are sent to Qloo. Never names, emails or locations.
- Nobody sees a map of strangers. Crowds are counts and avatars only; names appear only to people verified at the same venue, tonight.
- Everyone picks who can see them: everyone, strong matches only, verified people only, groups only, or nobody.
- Saying hi shares your first name and what you both love. Nothing else. Chat opens only if they accept.
- Meet-up mode needs both people to turn it on, lasts 30 minutes at most, works only within 1 km of the venue, and ends when you're within 25 m of each other.
- Check-ins expire at 6 am local time. Blocking hides both people from each other and ends anything open. A report also blocks.
- Review notes never carry a name or id, and are plain text with no links.
- Venue dashboards are totals only; groups under 3 people are folded away.
- Taste profiles are stored under a hash of the city and favourite ids, never a user id.

## Architecture

- **One API handler** (`src/router.js`, served by `api/index.js` on Vercel and `bin/serve.mjs` locally). Plain Node 20, no framework.
- **Static front end** in `public/` (HTML, CSS and ES modules; a 3D MapLibre GL map on free OpenFreeMap vector tiles, restyled dark).
- **Storage**: Supabase Postgres, one table (`records`, keyed by collection and id, JSON documents) with Row Level Security on and no policies, so only the server's secret key can read or write. Schema in `supabase/schema.sql`. A local JSON file is used for tests and offline work.
- **Event finding**: Claude with web search, once a day per city (`src/city-events.js`). Every event must have a title, a date in the next 120 days, a named performer, and a source link that was really among the pages searched.
- **Crons** (Vercel): daily event refresh, and daily demo check-in renewal.

## Run locally

Needs Node 20 or newer.

```sh
npm install
# create .env with the variables below
npm start              # http://localhost:3088
```

Environment variables (names only; never commit values):

| Name | What for |
|---|---|
| `QLOO_API_KEY` | Qloo API |
| `ANTHROPIC_API_KEY` | Claude, for finding events |
| `SESSION_SECRET` | signing sign-in tokens |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | hosted store (leave unset to use a local JSON file) |
| `ADMIN_TOKEN` | `POST /api/admin/refresh-events` |
| `CRON_SECRET` | Vercel cron calls |
| `DEMO_PASSWORD` | optional: sign-in password for the demo accounts |
| `OUTSIDE_STORE` | optional: path of a local JSON store (never set on Vercel) |

Demo data: `node bin/seed-demo.mjs --city London` (create or refresh), `--renew` (check demo people back in), `--remove` (delete every demo record; real records are never touched).

## Tests

```sh
npm test           # offline: a fake Qloo, a temporary local store
npm run test:live  # end to end against the real Qloo API (makes real calls)
```

The offline suite covers the privacy rules, check-in verification, ratings maths, folding small groups, demo labelling, the map, and attack cases (spoofed check-ins, links and hidden characters in reviews, rate limits).

## Deploy

1. Import the GitHub repo in the Vercel dashboard (region `fra1`, set in `vercel.json`).
2. Set the environment variables above in Production. Don't set `OUTSIDE_STORE`.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. Check `/api/health` reports `store: "supabase"`.
5. With `ADMIN_TOKEN`, `POST /api/admin/refresh-events` for each city you want events in, then seed the demo data.

`vercel.json` also sets a Content-Security-Policy, `Referrer-Policy` and `X-Content-Type-Options` on every response.

## Demo data notice

So the map has people on it in the demo, Outside seeds ten **demo users in London**. Every one is labelled: their name starts with "Demo ·", their records are marked demo, and every screen that counts them says so ("· 2 demo"). Their reviews are labelled Demo too.

There is also a demo venue account for the venue dashboard (Jazz Cafe Camden): sign in at `/venue` with `venue@demo.outside.invalid`. For the password, ask the team or see the submission notes.

## Licence

MIT. See `LICENSE`.
