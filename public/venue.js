// Venue dashboard, "Know your crowd": who walks in on which night, what they
// love, how each taste group rates you, and who to book next (Qloo). Totals
// only; groups under 3 people come back folded from the server.
import { api, esc, token } from "/api.js";
import { $, icon, topbar, toast, BRAND_MARK, openDemoVenue } from "/ui.js";

const dash = $("dash");
let me = null;
let days = 28;
let want = "";

function bareTop() {
  document.querySelector("header.topbar").innerHTML = `<a class="brand" href="/" aria-label="Outside"><span class="brand-mark">${BRAND_MARK}</span><span class="brand-text"><span class="brand-name">Outside</span><span class="brand-by">For venues</span></span></a>`;
}

/* ---------- not a venue yet ---------- */

function joinForm({ signedIn }) {
  // A guest has no email or password yet: they fill in the full form, and keep their account.
  const guest = Boolean(me?.guest);
  if (guest) signedIn = false;
  dash.innerHTML = `
    <div class="dash-head"><div><p class="label mint">For venues and promoters</p><h1>Know your crowd</h1></div></div>
    <div class="dash-grid">
      <section class="panel span-7">
        <h3>${icon("insights")}What you get</h3>
        <ul class="list-plain">
          <li class="person">${icon("calendar_view_week", "mint")}<span class="info"><b>Who walks in, night by night</b><span class="muted">Check-ins at your venue and what those people love, by day of the week.</span></span></li>
          <li class="person">${icon("star", "amber")}<span class="info"><b>Ratings by taste</b><span class="muted">How jazz lovers rate you compared with Afrobeats fans.</span></span></li>
          <li class="person">${icon("queue_music", "mint")}<span class="info"><b>Who to book next</b><span class="muted">Artists your crowd would love, from Qloo's taste graph.</span></span></li>
          <li class="person">${icon("lock", "faint")}<span class="info"><b>Private by design</b><span class="muted">Totals only. Any group under 3 people is folded into "other". No names, ever.</span></span></li>
        </ul>
        <p style="margin-top:12px"><a class="plans-link" href="/plans">${icon("payments")}How Outside makes money</a></p>
        <button class="btn btn-ghost" type="button" id="seeDemo" style="margin-top:12px">${icon("storefront")}See the demo venue (Jazz Cafe)</button>
        <p class="error" id="venueErr" role="alert" hidden></p>
      </section>
      <form class="panel span-5" id="join" novalidate>
        <h3>${icon("storefront")}${signedIn ? "Use this account for a venue" : "Sign up as a venue"}</h3>
        ${signedIn ? `<p class="muted">You're signed in as ${esc(me.firstName)} (${esc(me.email)}). Confirm your password to add venue tools to this account.</p>` : `
        <label class="field"><span>Your first name</span><input id="jName" autocomplete="given-name" maxlength="30" required></label>`}
        <label class="field"><span>Email</span><input id="jEmail" type="email" autocomplete="email" required value="${esc(me?.email || "")}" ${signedIn ? "readonly" : ""}></label>
        <label class="field"><span>Password</span><input id="jPass" type="password" autocomplete="${signedIn ? "current-password" : "new-password"}" minlength="8" required></label>
        <p class="error" id="jErr" role="alert" hidden></p>
        <button class="btn btn-mint" type="submit">${signedIn ? "Add venue tools" : "Create venue account"}</button>
      </form>
    </div>`;
  $("seeDemo").onclick = openDemoVenue;
  $("join").onsubmit = async (e) => {
    e.preventDefault();
    const body = { email: $("jEmail").value.trim(), password: $("jPass").value, organiser: true, ...(signedIn ? {} : { firstName: $("jName").value.trim() }) };
    try {
      const auth = guest && token() ? { authorization: `Bearer ${token()}` } : {};
      const r = await fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong.");
      try { localStorage.setItem("outside.token", d.token); } catch {}
      start();
    } catch (err) { $("jErr").textContent = err.message; $("jErr").hidden = false; }
  };
}

/* ---------- pick your venue ---------- */

function pickVenue() {
  dash.innerHTML = `
    <div class="dash-head"><div><p class="label mint">Step 1 of 1</p><h1>Which venue is yours?</h1></div></div>
    <section class="panel" style="max-width:640px">
      <label class="field"><span>Search your venue</span><input id="vq" placeholder="e.g. Jazz Cafe" autocomplete="off"></label>
      <ul class="suggest" id="vlist" aria-label="Venues"></ul>
      <p class="error" id="vErr" role="alert" hidden></p>
    </section>`;
  let timer, seq = 0;
  $("vq").focus();
  $("vq").oninput = () => {
    clearTimeout(timer);
    const q = $("vq").value.trim();
    if (q.length < 2) { $("vlist").innerHTML = ""; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      $("vlist").innerHTML = `<li class="muted">Searching…</li>`;
      try {
        const { results } = await api(`/api/search?type=place&q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        $("vlist").innerHTML = results.length ? results.map((r) => `<li><button type="button" data-id="${esc(r.id)}">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : icon("storefront")}<span><b>${esc(r.name)}</b>${r.detail ? `<small>${esc(String(r.detail).slice(0, 80))}</small>` : ""}</span></button></li>`).join("") : `<li class="muted">Nothing found. Try the full name.</li>`;
      } catch (err) { $("vlist").innerHTML = `<li class="muted">${esc(err.message)}</li>`; }
    }, 300);
  };
  $("vlist").onclick = async (e) => {
    const b = e.target.closest("[data-id]");
    if (!b) return;
    try {
      const { venue } = await api("/api/organiser/venue", { method: "POST", body: { venueId: b.dataset.id } });
      try { localStorage.setItem("outside.venue", JSON.stringify(venue)); } catch {}
      load();
    } catch (err) { $("vErr").textContent = err.message; $("vErr").hidden = false; }
  };
}

/* ---------- the dashboard ---------- */

const rowsHtml = (t, max = 6) => {
  if (!t?.rows?.length) return `<p class="faint">Not enough people yet.</p>`;
  const top = Math.max(...t.rows.map((r) => r.people));
  return `<div class="list-plain" style="display:flex;flex-direction:column;gap:6px">${t.rows.slice(0, max).map((r) => `<div class="hbar"><span>${esc(r.name)}</span><span class="track"><i style="width:${(r.people / top) * 100}%"></i></span><span class="v">${r.people}</span></div>`).join("")}${t.other ? `<p class="faint" style="font-size:12px">Plus ${t.other} in smaller groups</p>` : ""}</div>`;
};

const listHtml = (t) => (t?.rows?.length
  ? `<p style="font-size:13px">${t.rows.slice(0, 4).map((r) => `${esc(r.name)} <span class="faint">${r.people}</span>`).join(" · ")}${t.other ? ` <span class="faint">· ${t.other} other</span>` : ""}</p>`
  : `<p class="faint" style="font-size:12px">Not enough people yet.</p>`);

function weekHtml(week) {
  const nums = week.map((d) => (typeof d.checkins === "number" ? d.checkins : 0));
  const max = Math.max(1, ...nums);
  return `<div class="weekbars" role="img" aria-label="Check-ins by night of the week: ${week.map((d) => `${d.day} ${d.checkins}`).join(", ")}">${week.map((d) => {
    const few = typeof d.checkins !== "number";
    const h = few ? 12 : (d.checkins / max) * 100;
    return `<div class="col"><span class="n">${few ? "A few" : d.checkins}</span><span class="bar ${few ? "few" : ""}" style="height:${h}%"></span><span class="d">${esc(d.day)}</span></div>`;
  }).join("")}</div>`;
}

async function load() {
  dash.setAttribute("aria-busy", "true");
  const q = new URLSearchParams({ days: String(days) });
  if (want) q.set("want", want);
  let d;
  try { d = await api(`/api/organiser/dashboard?${q}`); }
  catch (err) { dash.innerHTML = `<div class="empty">${icon("error")}<h3>Couldn't load your dashboard</h3><p>${esc(err.message)}</p></div>`; return; }
  if (!d.venue) return me?.readOnly ? (dash.innerHTML = `<div class="empty">${icon("storefront")}<h3>The demo venue isn't set up right now</h3></div>`) : pickVenue();
  const v = d.venue;
  const c = d.city || {};
  const demoAll = v.demoUsers && v.demoUsers === v.visitors;
  const weekTotal = (v.byWeekday || []).reduce((s, x) => s + (typeof x.checkins === "number" ? x.checkins : 0), 0);
  const busyDays = (v.byWeekday || []).filter((x) => x.topSounds || x.topLoves);

  dash.innerHTML = `
    <div class="dash-head">
      <div><p class="label mint">Know your crowd</p><h1>${esc(v.name || "Your venue")}</h1></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>Last</span>
          <select id="days" class="input" style="width:auto;padding:8px 10px">${[7, 28, 90].map((n) => `<option value="${n}" ${n === days ? "selected" : ""}>${n} days</option>`).join("")}</select></label>
        ${me?.readOnly ? "" : `<button class="btn btn-ghost btn-sm" type="button" id="changeVenue">${icon("swap_horiz")}Change venue</button>`}
      </div>
    </div>
    ${v.demoUsers ? `<div class="banner">${icon("info")}${demoAll ? `All ${v.visitors} visitors here are` : `${v.demoUsers} of these ${v.visitors} visitors are`} demo people we added so the dashboard has something to show.</div>` : ""}
    ${v.note ? `<div class="banner info">${icon("lock")}${esc(v.note)}</div>` : ""}

    <div class="dash-grid">
      <div class="metric span-4"><small>Visitors, last ${v.days || days} days</small><b>${v.visitors ?? 0}</b><span class="faint" style="font-size:12px">${v.demoUsers ? `${v.demoUsers} demo` : "Distinct people who checked in"}</span></div>
      <div class="metric span-4"><small>Check-ins</small><b>${weekTotal || "–"}</b><span class="faint" style="font-size:12px">Quiet nights (under 3 people) stay private</span></div>
      <div class="metric span-4"><small>Your rating on Outside</small><b class="amber">${v.ratings?.overall?.avg != null ? `${v.ratings.overall.avg.toFixed(1)} ★` : "–"}</b><span class="faint" style="font-size:12px">${v.ratings?.overall?.count ? `${v.ratings.overall.count} ratings${v.ratings.overall.demo ? ` · ${v.ratings.overall.demo} demo` : ""}` : "No ratings yet"}</span></div>

      ${v.byWeekday ? `<section class="panel span-7"><h3>${icon("calendar_view_week")}Who walks in, by night</h3>${weekHtml(v.byWeekday)}
        ${busyDays.length ? `<div class="day-detail">${busyDays.map((x) => `<div class="note"><b class="label mint">${esc(x.day)}</b><small class="muted">Top sounds</small>${listHtml(x.topSounds)}<small class="muted">They love</small>${listHtml(x.topLoves)}</div>`).join("")}</div>` : ""}
      </section>` : ""}

      ${v.ratings ? `<section class="panel span-5"><h3>${icon("star")}Ratings by taste group</h3>
        ${v.ratings.byTaste?.length ? `<div style="display:flex;flex-direction:column;gap:8px">${v.ratings.byTaste.map((g) => `<div class="hbar"><span>${esc(g.group)} fans</span><span class="track"><i style="width:${(g.avg / 5) * 100}%"></i></span><span class="v">${g.avg.toFixed(1)} ★ · ${g.count}</span></div>`).join("")}</div>` : `<p class="faint">No taste group has 3 ratings yet.</p>`}
        ${v.ratings.other?.groups ? `<p class="faint" style="font-size:12px">${v.ratings.other.groups} more taste ${v.ratings.other.groups === 1 ? "group" : "groups"} too small to show</p>` : ""}
      </section>` : ""}

      ${v.bookNext ? `<section class="panel span-12"><h3>${icon("queue_music")}Who to book next<span class="src">Qloo, from your crowd's favourites and your venue</span></h3>
        ${v.bookNext.length ? `<div class="artists">${v.bookNext.map((a) => `<div class="artist"><div class="img">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : ""}</div><div class="t"><b>${esc(a.name)}</b>${a.affinity != null ? `<small>${a.affinity}% fit with your crowd</small>` : ""}${a.because?.length ? `<span class="faint" style="font-size:11px">Your crowd loves ${a.because.map(esc).join(", ")}</span>` : ""}</div></div>`).join("")}</div>` : `<p class="faint">Not enough to go on yet.</p>`}
        <form id="gapForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <label class="field" style="flex:1;min-width:200px"><span>The crowd you want: name an artist</span><input id="want" value="${esc(want)}" placeholder="e.g. Ezra Collective" autocomplete="off"></label>
          <button class="btn" type="submit">Compare</button>
        </form>
        ${v.gap ? (v.gap.found ? `<div class="banner info">${icon("compare_arrows")}<span>${esc(v.gap.share)} of your crowd already lean towards ${esc(v.gap.want)}'s sound${v.gap.sounds?.length ? ` (${v.gap.sounds.map(esc).join(", ")})` : ""}.</span></div>` : `<div class="banner">${icon("help")}Qloo doesn't know "${esc(v.gap.want)}". Check the spelling?</div>`) : ""}
      </section>` : ""}

      <section class="panel span-6"><h3>${icon("location_city")}${esc(c.city || "Your city")} this week</h3>
        ${c.note ? `<p class="muted">${esc(c.note)}</p>` : `
          <p><b class="mint">${c.visitors ?? 0}</b> people with a taste profile${c.demoUsers ? ` <span class="tag tag-demo">${c.demoUsers} demo</span>` : ""}</p>
          <small class="muted label-sm">Top sounds</small>${rowsHtml(c.topSounds, 6)}
          <small class="muted label-sm">Busiest venues</small>${rowsHtml(c.busiestVenues, 5)}
          <small class="muted label-sm">Where they're from</small>${rowsHtml(c.homeCities, 5)}`}
      </section>

      <section class="panel span-6"><h3>${icon("event")}Your events</h3>
        ${d.events?.length ? `<ul class="list-plain">${d.events.map((e) => {
          const strong = (c.events || []).find((x) => x.id === e.id)?.strongMatches;
          return `<li class="note"><b>${esc(e.title)}</b><small>${esc(new Date(e.starts).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))} · ${esc(e.venue?.name || "")}</small>${e.lineup?.length ? `<small class="muted">${e.lineup.map(esc).join(", ")}</small>` : ""}${strong != null ? `<small>${esc(String(strong))} strong matches in town</small>` : ""}</li>`;
        }).join("")}</ul>` : `<p class="faint">No events yet. Add one so it reaches people whose taste fits the lineup.</p>`}
        ${me?.readOnly ? `<div class="banner">${icon("visibility")}<span>This is a view-only demo. Sign up as a venue to add your own events. Organisers can pin an event as a Spotlight for the right crowd. <a href="/plans">How Outside makes money</a></span></div>` : `<form id="evForm" class="form-grid">
          <label class="field wide"><span>Title</span><input id="evTitle" maxlength="120" required placeholder="Friday Jazz Social"></label>
          <label class="field wide"><span>Lineup (comma between names)</span><input id="evLineup" required placeholder="Ezra Collective, Nubya Garcia"></label>
          <label class="field"><span>Starts (your local time)</span><input id="evStart" type="datetime-local" required></label>
          <label class="field"><span>Ends</span><input id="evEnd" type="datetime-local" required></label>
          <label class="field"><span>Kind</span><select id="evKind"><option value="concert">Concert</option><option value="party">Club night</option><option value="comedy">Comedy</option><option value="festival">Festival</option><option value="other">Other</option></select></label>
          <div class="field" style="justify-content:flex-end"><button class="btn btn-mint" type="submit">${icon("add")}Add event</button></div>
          <p class="error wide" id="evErr" role="alert" hidden></p>
        </form>`}
      </section>
    </div>
    <p class="faint" style="font-size:12px">${esc(v.privacy || c.privacy || "")}</p>
    <p><a class="plans-link" href="/plans">${icon("payments")}How Outside makes money: free for people, Event Spotlight for organisers</a></p>`;
  dash.setAttribute("aria-busy", "false");
  countMetrics();

  $("days").onchange = (e) => { days = Number(e.target.value); load(); };
  if ($("changeVenue")) $("changeVenue").onclick = pickVenue;
  $("gapForm") && ($("gapForm").onsubmit = (e) => { e.preventDefault(); want = $("want").value.trim(); load(); });
  if ($("evForm")) $("evForm").onsubmit = (e) => addEvent(e, v);
}

// The three big numbers count up once, the first time the dashboard shows.
// Looks only: loaded on the side, and the real numbers are already in place.
let counted = false;
function countMetrics() {
  if (counted) return;
  counted = true;
  const nums = [...dash.querySelectorAll(".metric b")]
    .map((el) => ({ el, m: /^(\d+(?:\.\d+)?)(.*)$/.exec(el.textContent.trim()) }))
    .filter((x) => x.m);
  if (!nums.length) return;
  import("/fx/count-up.js").then(({ countUp }) => {
    for (const { el, m } of nums) {
      if (!el.isConnected) continue;
      const decimals = (m[1].split(".")[1] || "").length;
      countUp(el, { to: Number(m[1]), decimals, suffix: m[2], duration: 1.6 });
    }
  }).catch(() => {});
}

async function venueLocation(v) {
  try { const s = JSON.parse(localStorage.getItem("outside.venue") || "null"); if (s?.id === v.id && s.location) return s; } catch {}
  // The dashboard doesn't carry the venue's location; the place card does.
  const card = await api(`/api/places/${encodeURIComponent(v.id)}`);
  const loc = { id: v.id, name: card.place.name, location: card.place.location };
  try { localStorage.setItem("outside.venue", JSON.stringify(loc)); } catch {}
  return loc;
}

async function addEvent(e, v) {
  e.preventDefault();
  const err = $("evErr");
  err.hidden = true;
  const lineup = $("evLineup").value.split(",").map((s) => s.trim()).filter(Boolean);
  const starts = $("evStart").value, ends = $("evEnd").value;
  if (!$("evTitle").value.trim() || !lineup.length || !starts || !ends) { err.textContent = "Add a title, at least one name in the lineup, and start and end times."; err.hidden = false; return; }
  try {
    const where = await venueLocation(v);
    if (!where.location) throw new Error("We don't have a location for your venue.");
    await api("/api/organiser/events", { method: "POST", body: { title: $("evTitle").value.trim(), lineup, starts: new Date(starts).toISOString(), ends: new Date(ends).toISOString(), kind: $("evKind").value, venue: { name: where.name || v.name, lat: where.location.lat, lon: where.location.lon } } });
    toast("Event added. People whose taste fits the lineup will see it.");
    load();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
}

/* ---------- start ---------- */

async function start() {
  if (!token()) { me = null; bareTop(); return joinForm({ signedIn: false }); }
  try { ({ user: me } = await api("/api/me")); } catch { bareTop(); return joinForm({ signedIn: false }); }
  topbar({ active: "venue", user: me, cityLabel: { city: me.city || "Pick a city" } });
  if (me.role !== "organiser") return joinForm({ signedIn: true });
  load();
}
start();
