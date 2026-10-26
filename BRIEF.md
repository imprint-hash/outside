# Outside: the build brief (Qloo Agentic Hackathon)

**Deadline:** Fri 30 Oct 2026 (Devpost, Pacific time) = Sat 31 Oct 04:45 WAT. Aim to submit Fri 30 Oct evening WAT. Needs: live public demo, public repo with an open-source licence, demo video.
**Judges** (last edition): Qloo's CEO, investors, entertainment people. Last time 3 of 4 winners were business tools; the 4th was a clever consumer twist. No itinerary/travel planner won.
**Prizes this time:** $15k / $6k / $4k.

## One line
**Outside connects people by taste, and shows venues who's walking in.**
Consumer hook: *"Land anywhere, and see where your people are tonight."*

## Why it's different from the crowded lane
~8 entries plan days/evenings ("where should I go?"). Outside answers **"where are the people like me tonight?"**:
1. **Live events with real lineups** (Qloo has no event listings; we search the web daily per city, Qloo scores the lineup against your taste).
2. **People:** who's out tonight that shares your taste; say hi; safe meet-up.
3. **Who's in the room:** live check-ins + Qloo taste = "12 people here share your taste".
4. **Rated by people like you:** two ratings on every place: everyone's, and people with your taste.
5. **Venues see their crowd's taste** (the business side).

## Who it's for
- **People:** travellers, expats, students, remote workers, anyone new in a city or out on a free night. Any city (36 to start).
- **Venues and promoters (pay):** bars, clubs, restaurants, event organisers.

## Features
### A. For people
1. **Sign up: "Step outside".** A front door on a night street; windows light up as you type; tap **Outside**, the door opens and your avatar walks out into the city. (Replaces the Lagos danfo.)
2. **Make your avatar** (Bitmoji/Sims style, plumbob). Already built.
3. **Your taste:** 3+ artists, places, shows you love from anywhere. Qloo turns them into a taste profile. Already built.
4. **Where are you?** City picker (36 cities) or GPS, then where you're staying (hotel, area or GPS).
5. **Tonight (the main screen): a live map of your city.**
   - Events tonight/this week, ranked by who's playing vs your taste (Qloo).
   - Venues, each with a **"people like you" glow**: how many checked-in people share your taste, plumbob colour.
   - Filter: Now / Tonight / This week; Food / Drinks / Music / Comedy.
6. **Place / event card**
   - Why it fits you ("people who love Burna Boy and Nobu go here"), match label.
   - **Reviews:** Qloo star rating, what reviewers mention (keyword counts), short summaries (service, ambience, crowd); plus **★ from people with your taste** with one-line notes.
   - Open now / closes at (local time), travel time estimate.
   - **People here** (avatars + thought bubbles of shared taste) with **Say hi**.
   - **Ride there:** Uber deep link (pickup + drop-off pre-filled; you confirm), Bolt where it's used.
   - Check in.
7. **People**
   - See who's at the same venue/event and shares your taste (only shared tastes are shown, never personal details).
   - Visibility control: everyone / strong matches / verified / nobody.
   - **Say hi** (10 per hour) → they accept or ignore → chat.
   - **Safe meet-up:** both agree → 30 minutes of two-way live location → ends automatically when you're within 25 m, or either taps stop. Block and report everywhere.
   - **Share my night** with a friend (where you are, since when).
8. **How was it?** After a check-in, rate 1–5 stars + one line. Feeds "rated by people like you".
9. **Plan around it (small extra):** for any event, dinner before and a spot after, open at those times (Qloo).

### B. For venues and promoters
10. **Venue dashboard: "Know your crowd"**
    - Who's checking in (totals only, groups under 3 folded into "other").
    - What your crowd loves: top artists, shows, cuisines (Qloo), by night of the week.
    - Your ratings: overall vs by taste group ("jazz lovers rate you 3.9").
    - **Who to book next:** artists your crowd would love (Qloo), and the gap between the crowd you have and the one you want.
    - Add your events (title, lineup, time, venue) so they reach the right people.

## Qloo is the hero (judges' "would it work without Qloo?" test)
Taste profiles · place picks near you · lineup scoring · people matching · "people like you" ratings · crowd taste for venues · who-to-book. Without Qloo there is no "like you".

## What's built already (reuse)
Qloo client (cache, retry, name matching), taste profiles and comparison, places near you / translate city / tonight, opening hours, events scoring and after-the-show, Claude web search for events + vetting, people (check-in, visibility, hi, chat, meet-ups, block/report, share), organiser totals, Supabase store, HMAC auth, avatars, 19 offline tests + live end-to-end test. City support (36 cities, local time zones) added 26 Oct.

## To build now
- Backend: events for any city (per-city daily search, cached), city endpoint, venue crowd counts for the map, reviews (Qloo summaries + our own ratings, taste-weighted), venue dashboard upgrades (ratings by taste group, who to book), ride links, map data endpoint.
- Frontend: sign-up door animation, city step, live map, place/event card, people, hi/chat/meet-up, how-was-it, venue dashboard. **UI waits for the user's reference design.**
- Demo data: a few clearly labelled demo users with different tastes, checked in around one city, so the map and "people like you" show something real in the video.
- Deploy (Vercel or similar, near Frankfurt for Supabase), README with a Qloo-calls table, licence, demo video.

## Rules
- Plain English, no Pidgin. No AI attribution in commits. Keys only in `.env`, never printed or committed. Ask before installing anything. Demo users are labelled as demo users.
