// Tonight: the live map of your city. Left, your matches (places and events,
// most people like you first); right, the map with glowing markers. Tap one
// for a popover, open it for the full card. Everything shown comes from the
// API; missing fields are left out.
import { api, esc, needSignIn } from "/api.js";
import { $, icon, topbar, setHelloCount, ratingPill, facesRow, tripText, hoursFact, timeIn, dayIn, toast, sheetOpen, closeSheet, PLUMBOB, demoTag, demoCount } from "/ui.js";
import { openPlace, openEvent, getCard, checkIn, cardCache } from "/card.js";
import { openHere, openInbox, openChat, openSettings, openRate, pollInbox } from "/social.js";
import { makeMap, setGlow, reduceMotion, PITCH, BEARING } from "/map3d.js";

needSignIn();

const state = {
  me: null,
  when: "tonight",
  kinds: new Set(),
  data: null,
  selected: null,
  checkin: null,
  pollTimer: null,
  pollUntil: 0,
};
const mobile = () => matchMedia("(max-width: 899px)").matches;

/* ---------- start ---------- */

const { user, checkin } = await api("/api/me").catch((e) => { toast(e.message, { error: true }); return {}; });
if (!user) throw new Error("not signed in");
if (!user.avatar) location.replace("/taste");
else if (!user.favourites?.length) location.replace("/taste#taste");
else if (!user.city) location.replace("/taste#city");
state.me = user;
state.checkin = checkin;
topbar({ active: "tonight", user, cityLabel: cityLabel(user) });
setRibbonHeight();
addEventListener("resize", setRibbonHeight);

function cityLabel(u) {
  return { city: u.city || "Your city", stay: u.stay?.label || "" };
}
function setRibbonHeight() {
  document.documentElement.style.setProperty("--ribbon", `${$("ribbon").offsetHeight}px`);
}

/* ---------- the map ---------- */

// Made on the first load, once we know the city. null when WebGL is missing.
let map = null;
let mapOff = false;
let introDone = false;
let intro = null;
let is3d = true;
const markers = new Map(); // "place:id" -> maplibregl.Marker
const ease = (opts) => (reduceMotion() ? map.jumpTo(opts) : map.flyTo(opts));

function ensureMap(d) {
  if (map || mapOff) return map;
  const c = d.origin || d.city;
  map = makeMap($("map"), [c.lon, c.lat]);
  if (!map) { showMapOff(); return null; }
  map.on("error", (e) => { if (/webgl/i.test(e?.error?.message || "")) showMapOff(); });
  map.once("style.load", () => setTimeout(runIntro, 400));
  map.on("click", () => clearHot());
  return map;
}

function showMapOff() {
  mapOff = true;
  try { map?.remove(); } catch {}
  map = null;
  markers.clear();
  $("map").outerHTML = `<div class="map-off" role="note">${icon("map")}<p>This browser can't draw the 3D map, so here's the list only.</p></div>`;
  document.querySelector(".map-tools")?.remove();
  document.querySelector(".legend")?.remove();
}

// Opening shot: flat over the city, then glide down to where you're staying.
function runIntro() {
  if (introDone || !map || !intro) return;
  introDone = true;
  const cam = { ...intro, pitch: PITCH, bearing: BEARING };
  if (reduceMotion()) map.jumpTo(cam);
  else map.flyTo({ ...cam, duration: 3500, curve: 1.3, essential: false });
}

$("zoomIn").onclick = () => map?.zoomIn();
$("zoomOut").onclick = () => map?.zoomOut();
$("recenter").onclick = () => { const o = state.data?.origin; if (o && map) ease({ center: [o.lon, o.lat], zoom: 14.5, pitch: is3d ? PITCH : 0, bearing: is3d ? BEARING : 0 }); };
$("pitchToggle").onclick = () => {
  if (!map) return;
  is3d = !is3d;
  const b = $("pitchToggle");
  b.textContent = is3d ? "2D" : "3D";
  b.setAttribute("aria-pressed", String(is3d));
  b.setAttribute("aria-label", is3d ? "Flat map" : "3D map");
  map.easeTo({ pitch: is3d ? PITCH : 0, bearing: is3d ? BEARING : 0, duration: reduceMotion() ? 0 : 700 });
};

const KIND_ICON = { restaurant: "restaurant", bar: "local_bar", lounge: "nightlife", club: "graphic_eq" };
const EVENT_ICON = { concert: "music_note", festival: "festival", party: "celebration", comedy: "theater_comedy", other: "event" };

function markerHtml({ cls, size, ico, label, plumbob }) {
  const gem = plumbob && PLUMBOB[plumbob]
    ? `<svg class="gem" viewBox="0 0 16 28" style="color:${PLUMBOB[plumbob]}"><path d="M8 0 L16 12 L8 28 L0 12Z" fill="currentColor"/><path d="M8 0 L16 12 L8 12Z" fill="rgba(255,255,255,.45)"/></svg>`
    : "";
  return `<div class="mk ${cls}" style="width:${size}px;height:${size}px">${cls === "quiet" ? "" : `<span class="halo"></span>`}${gem}<span class="core" style="width:${size}px;height:${size}px">${ico ? icon(ico) : ""}</span><span class="tag-label"><i></i>${esc(label)}</span></div>`;
}

function venueLook(v) {
  const like = v.crowd?.likeYou || 0;
  if (like > 0) return { cls: "like", size: 20 + Math.min(like, 6) * 3, ico: KIND_ICON[v.category] || "group", plumbob: v.crowd.plumbob };
  if (v.match != null) return { cls: "fit", size: 18, ico: KIND_ICON[v.category] || "place" };
  return { cls: "quiet", size: 12, ico: null };
}

function addMarker(key, lngLat, html, { size, z = 0, label, onPick }) {
  const el = document.createElement("div");
  el.className = "mkwrap";
  el.style.cssText = `width:${size}px;height:${size}px;z-index:${z}`;
  el.innerHTML = html;
  if (onPick) {
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", label);
    el.title = label;
    el.addEventListener("click", (e) => { e.stopPropagation(); onPick(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } });
    el.addEventListener("mouseenter", () => hot(key, "map"));
    el.addEventListener("mouseleave", () => clearHot());
  }
  const m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map);
  if (key) markers.set(key, m);
  return m;
}

function drawMarkers() {
  const d = state.data;
  if (!d || !ensureMap(d)) return;
  for (const m of markers.values()) m.remove();
  markers.clear();
  map.__you?.remove();
  const pts = [];
  const glow = [];
  if (d.origin) {
    map.__you = addMarker(null, [d.origin.lon, d.origin.lat], `<div class="mk you" style="width:14px;height:14px" title="${esc(d.origin.label || "You")}"><span class="core" style="width:14px;height:14px"></span></div>`, { size: 14, z: 1 });
    pts.push([d.origin.lon, d.origin.lat]);
  }
  for (const v of d.venues) {
    if (!v.location) continue;
    const look = venueLook(v);
    const label = v.match != null ? `${v.name} (${v.match}%)` : v.name;
    addMarker(`place:${v.id}`, [v.location.lon, v.location.lat], markerHtml({ ...look, label }), {
      size: look.size, label: v.name, z: look.cls === "like" ? 1000 : look.cls === "fit" ? 500 : 10,
      onPick: () => select({ type: "place", id: v.id }, { from: "map" }),
    });
    if (v.crowd?.likeYou > 0) glow.push({ lon: v.location.lon, lat: v.location.lat, like: v.crowd.likeYou });
    pts.push([v.location.lon, v.location.lat]);
  }
  for (const e of d.events) {
    if (!Number.isFinite(e.venue?.lat) || e.venue.approximate) continue;
    const label = e.fit != null ? `${e.title} (${e.fit}%)` : e.title;
    addMarker(`event:${e.id}`, [e.venue.lon, e.venue.lat], markerHtml({ cls: "event", size: 24, ico: EVENT_ICON[e.eventKind] || "event", label }), {
      size: 24, label: e.title, z: 800, onPick: () => select({ type: "event", id: e.id }, { from: "map" }),
    });
  }
  setGlow(map, glow);
  if (introDone) return;
  // Where the opening shot lands: on your stay, close enough to see what's around.
  let zoom = 14.2;
  if (pts.length > 1) {
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    const cam = map.cameraForBounds(b, { padding: 60, maxZoom: 14.5 });
    if (cam?.zoom) zoom = Math.max(13.8, Math.min(14.8, cam.zoom + 1));
  }
  const center = d.origin ? [d.origin.lon, d.origin.lat] : pts[0] || [d.city.lon, d.city.lat];
  intro = intro || { center, zoom: pts.length ? zoom : 12 };
  if (map.style && map.isStyleLoaded()) runIntro();
}

/* ---------- list hover <-> marker highlight ---------- */

function clearHot() {
  document.querySelectorAll(".mkwrap.hot, .card.hot").forEach((x) => x.classList.remove("hot"));
}
function hot(key, from) {
  clearHot();
  if (from === "list") markers.get(key)?.getElement().classList.add("hot");
  else document.querySelector(`.card[data-key="${CSS.escape(key)}"]`)?.classList.add("hot");
}

/* ---------- popover ---------- */

function kwHtml(keywords = [], n = 4) {
  const ks = keywords.slice(0, n);
  if (!ks.length) return `<p class="faint">Reviewers haven't said much about it yet.</p>`;
  const max = Math.max(...ks.map((k) => k.mentions));
  return `<div class="kw">${ks.map((k) => `<div class="kw-row"><span>${esc(k.text)}</span><span class="n">${k.mentions}</span><span class="bar"><i style="width:${Math.max(6, (k.mentions / max) * 100)}%"></i></span></div>`).join("")}</div>`;
}

function placePopup(v, card) {
  const like = v.crowd?.likeYou || 0;
  const summary = card?.qloo?.summaries?.ambience || card?.qloo?.summaries?.overall;
  return `<div class="popc">
    <div class="ph"><b>${like ? `<span class="live"></span>` : ""}${esc(v.name)}</b>${v.match != null ? `<span class="tag tag-mint-solid">${v.match}% match</span>` : ""}</div>
    <div class="deck">
      <span class="dh">${icon("reviews")}What reviewers mention</span>
      ${card ? kwHtml(card.qloo?.keywords) : `<p class="faint">Loading reviews…</p>`}
      ${summary ? `<p class="muted clamp3" style="font-size:12px;line-height:18px">${esc(summary)}</p>` : ""}
    </div>
    <div class="tiles">
      <div><b>${like}</b><small>Like you here now${demoCount(v.crowd?.demo)}</small></div>
      ${v.trip ? `<div><b class="amber">${v.trip.minutes}m</b><small>${v.trip.mode === "walk" ? "Walk" : "Drive"} away</small></div>` : `<div><b class="amber">${v.crowd?.here || 0}</b><small>Checked in${demoCount(v.crowd?.demo)}</small></div>`}
    </div>
    <button class="btn btn-mint btn-block btn-sm" type="button" data-open-place="${esc(v.id)}">${icon("open_in_full")}Open place</button>
  </div>`;
}

function eventPopup(e) {
  const tz = state.data.city.tz;
  const top = (e.artists || []).filter((a) => a.fit != null).slice(0, 3);
  return `<div class="popc">
    <div class="ph"><b>${esc(e.title)}</b>${e.fit != null ? `<span class="tag tag-mint-solid">${e.fit}% match</span>` : ""}</div>
    <div class="deck">
      <span class="dh">${icon("queue_music")}Lineup vs your taste</span>
      ${top.length ? `<div class="kw">${top.map((a) => `<div class="kw-row"><span>${esc(a.name)}${a.youLove ? " · you love them" : ""}</span><span class="n">${a.fit}%</span><span class="bar"><i style="width:${a.fit}%"></i></span></div>`).join("")}</div>` : `<p class="faint">Qloo doesn't know this lineup yet.</p>`}
    </div>
    <div class="tiles">
      <div><b>${e.crowd?.likeYou ?? 0}</b><small>Like you at the venue${demoCount(e.crowd?.demo)}</small></div>
      <div><b class="amber">${esc(timeIn(e.starts, tz))}</b><small>${esc(dayIn(e.starts, tz).wd)} · ${esc(e.venue?.name || "")}</small></div>
    </div>
    <button class="btn btn-mint btn-block btn-sm" type="button" data-open-event="${esc(e.id)}">${icon("open_in_full")}Open event</button>
  </div>`;
}

const popup = typeof maplibregl === "undefined" ? null : new maplibregl.Popup({ className: "pop", maxWidth: "304px", offset: 16, focusAfterOpen: false });
$("split").addEventListener("click", (e) => {
  if (!e.target.closest(".maplibregl-popup")) return;
  const p = e.target.closest("[data-open-place]");
  const ev = e.target.closest("[data-open-event]");
  if (p) goPlace(p.dataset.openPlace);
  if (ev) location.hash = `event/${ev.dataset.openEvent}`;
});

function findVenue(id) { return state.data?.venues.find((v) => v.id === id); }
function findEvent(id) { return state.data?.events.find((e) => e.id === id); }

function goPlace(id) {
  const v = findVenue(id);
  location.hash = `place/${id}${v?.match != null ? `?m=${v.match}` : ""}`;
}

async function select(item, { from = "list" } = {}) {
  state.selected = item;
  document.querySelectorAll(".card.selected").forEach((c) => c.classList.remove("selected"));
  document.querySelector(`.card[data-key="${item.type}:${CSS.escape(item.id)}"]`)?.classList.add("selected");
  document.querySelectorAll(".mk.on").forEach((m) => m.classList.remove("on"));
  const mk = markers.get(`${item.type}:${item.id}`);
  mk?.getElement().querySelector(".mk")?.classList.add("on");

  if (from === "list" && mobile()) {
    if (item.type === "place") goPlace(item.id); else location.hash = `event/${item.id}`;
    return;
  }
  if (!mk) {
    if (item.type === "place") goPlace(item.id); else location.hash = `event/${item.id}`;
    return;
  }
  if (from === "list") { introDone = true; map.stop(); ease({ center: mk.getLngLat(), zoom: Math.max(map.getZoom(), 14.5), duration: 900 }); }
  if (from === "map") document.querySelector(`.card[data-key="${item.type}:${CSS.escape(item.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });

  if (item.type === "event") {
    popup.setLngLat(mk.getLngLat()).setHTML(eventPopup(findEvent(item.id))).addTo(map);
    return;
  }
  const v = findVenue(item.id);
  popup.setLngLat(mk.getLngLat()).setHTML(placePopup(v, cardCache.get(v.id))).addTo(map);
  if (!cardCache.get(v.id)) {
    const card = await getCard(v.id, v.match).catch(() => null);
    if (card && state.selected?.id === v.id && popup.isOpen()) popup.setHTML(placePopup(v, card));
  }
}

/* ---------- the stream ---------- */

const CAT_NAME = { restaurant: "Food", bar: "Bar", lounge: "Lounge", club: "Club" };

function roomHtml(crowd, faces = []) {
  if (!crowd?.here) return "";
  const like = crowd.likeYou || 0;
  return `<div class="room">
    ${facesRow(faces, like || crowd.here)}
    <div class="txt ${like ? "" : "quiet"}">
      <span>${like ? `${like} ${like === 1 ? "person" : "people"} with your taste` : `${crowd.here} checked in`}</span>
      <small>${like ? "Checked in right now" : "None share your taste yet"}${crowd.demo ? ` · ${crowd.demo} demo` : ""}</small>
    </div>
  </div>`;
}

function featureVenue(v0) {
  const card = cardCache.get(v0.id);
  // Venues that come only from check-ins have no Qloo details on the map; the card has them.
  const v = { ...v0, image: v0.image || card?.place?.image || null, area: v0.area || card?.place?.area || null, rating: v0.rating ?? card?.qloo?.rating ?? null, price: v0.price || card?.place?.price || null, hours: v0.hours?.known ? v0.hours : card?.place?.hours || v0.hours };
  const faces = card?.crowd?.faces || [];
  const quote = card?.ours?.notes?.[0];
  const facts = [v.price && `<span class="fact">${esc(v.price)}</span>`, hoursFact(v.hours)].filter(Boolean).join("");
  return `<article class="card feature" tabindex="0" data-key="place:${esc(v.id)}" aria-label="${esc(v.name)}">
    <div class="media">
      ${v.image ? `<img src="${esc(v.image)}" alt="" loading="lazy">` : `<div class="media-blank">${icon(KIND_ICON[v.category] || "storefront")}</div>`}
      <span class="tl glass-tag">${icon(v.crowd?.likeYou ? "groups" : "verified")}${v.crowd?.likeYou ? `Your people are here${demoCount(v.crowd.demo)}` : esc(v.fit || CAT_NAME[v.category] || "Place")}</span>
      <span class="tr">${ratingPill({ all: v.rating, ours: card?.ours })}</span>
      ${v.trip ? `<span class="br glass-tag amber">${icon(v.trip.mode === "walk" ? "directions_walk" : "directions_car")}${esc(tripText(v.trip))}</span>` : ""}
    </div>
    <div class="body">
      <div>
        <div class="title-row"><h3>${esc(v.name)}</h3>${v.area ? `<span class="area">${esc(v.area)}</span>` : ""}</div>
        ${CAT_NAME[v.category] ? `<p class="subtitle">${esc(CAT_NAME[v.category])}${v.fit ? ` · ${esc(v.fit)}` : ""}</p>` : ""}
      </div>
      ${v.match != null ? `<div class="matchbox"><span class="ico">${icon("auto_graph")}</span><div><div><span class="big">${v.match}% match</span><span class="what">Your taste</span></div>${v.why ? `<p>${esc(v.why)}</p>` : ""}</div></div>` : ""}
      ${roomHtml(v.crowd, faces)}
      ${facts ? `<div class="facts">${facts}</div>` : ""}
      ${quote ? `<blockquote class="quote">${icon("format_quote")}<span>“${esc(quote.note)}”${quote.because ? ` <span class="faint">· ${esc(quote.because)}</span>` : ""} ${demoTag(quote)}</span></blockquote>` : ""}
      <div class="actions">
        <button class="btn btn-mint btn-stack" type="button" data-act="ride">${icon("local_taxi")}Ride there</button>
        <button class="btn btn-stack" type="button" data-act="checkin">${icon("location_on", "mint")}${state.checkin?.venueId === v.id ? "Checked in" : "Check in"}</button>
        <button class="btn btn-stack" type="button" data-act="hi">${icon("waving_hand", "amber")}Say hi${v.crowd?.likeYou ? ` (${v.crowd.likeYou})` : ""}</button>
      </div>
    </div>
  </article>`;
}

function compactVenue(v) {
  const meta = [v.area, CAT_NAME[v.category], v.price].filter(Boolean).map(esc).join(" · ");
  const hasStats = v.rating != null || v.crowd?.likeYou || v.crowd?.here;
  return `<article class="card compact" tabindex="0" data-key="place:${esc(v.id)}" aria-label="${esc(v.name)}">
    <div class="media">${v.image ? `<img src="${esc(v.image)}" alt="" loading="lazy">` : `<div class="media-blank">${icon(KIND_ICON[v.category] || "storefront")}</div>`}
      ${v.fit ? `<span class="tl glass-tag">${icon("verified")}${esc(v.fit)}</span>` : ""}</div>
    <div class="body">
      <div class="head"><h3>${esc(v.name)}</h3>${v.match != null ? `<span class="tag tag-mint">${v.match}% match</span>` : ""}</div>
      ${meta ? `<p class="meta">${meta}${v.trip ? ` · ${esc(tripText(v.trip))}` : ""}</p>` : v.trip ? `<p class="meta">${esc(tripText(v.trip))}</p>` : ""}
      ${hasStats ? `<div class="statline"><span>${v.rating != null ? `All: ${v.rating.toFixed(1)} ★` : ""}</span>${v.crowd?.likeYou ? `<span class="crowd">${v.crowd.likeYou} like you here${demoCount(v.crowd.demo)}</span>` : v.crowd?.here ? `<span class="faint">${v.crowd.here} checked in${demoCount(v.crowd.demo)}</span>` : ""}</div>` : ""}
      ${v.hours?.known ? `<div class="facts">${hoursFact(v.hours)}</div>` : ""}
      <div class="row-actions">
        <button class="btn btn-sm" type="button" data-act="open">${icon("info")}Details</button>
        <button class="btn btn-sm ${state.checkin?.venueId === v.id ? "" : "btn-mint"}" type="button" data-act="checkin">${state.checkin?.venueId === v.id ? "Checked in" : "Check in"}</button>
      </div>
    </div>
  </article>`;
}

function eventRow(e) {
  const tz = state.data.city.tz;
  const d = dayIn(e.starts, tz);
  return `<article class="card event-row" tabindex="0" data-key="event:${esc(e.id)}" aria-label="${esc(e.title)}">
    <div class="datebox"><b>${esc(d.day)}</b><small>${esc(d.wd)}</small></div>
    <div class="body">
      <div class="head" style="display:flex;justify-content:space-between;gap:8px"><h3>${esc(e.title)}</h3>${e.fit != null ? `<span class="tag tag-mint">${e.fit}%</span>` : ""}</div>
      <p class="meta muted" style="font-size:12px">${esc(e.venue?.name || "")}${e.venue?.approximate ? " (location approximate)" : ""} · ${esc(timeIn(e.starts, tz))}</p>
      ${e.why ? `<p class="faint" style="font-size:12px;line-height:18px">${esc(e.why)}</p>` : ""}
      ${e.crowd?.likeYou ? `<span class="tag tag-amber">${e.crowd.likeYou} like you at the venue${demoCount(e.crowd.demo)}</span>` : ""}
    </div>
  </article>`;
}

function featureEvent(e) {
  const tz = state.data.city.tz;
  const d = dayIn(e.starts, tz);
  const names = (e.artists || []).map((a) => a.name).slice(0, 4).join(", ");
  return `<article class="card feature" tabindex="0" data-key="event:${esc(e.id)}" aria-label="${esc(e.title)}">
    <div class="media"><div class="media-blank">${icon(EVENT_ICON[e.eventKind] || "event")}</div>
      <span class="tl glass-tag amber">${icon("event")}${esc(d.wd)} ${esc(d.day)} ${esc(d.mon)} · ${esc(timeIn(e.starts, tz))}</span>
    </div>
    <div class="body">
      <div><div class="title-row"><h3>${esc(e.venue?.name || "")}</h3>${e.venue?.area ? `<span class="area">${esc(e.venue.area)}</span>` : ""}</div><p class="subtitle">${esc(e.title)}</p></div>
      ${e.fit != null ? `<div class="matchbox"><span class="ico">${icon("auto_graph")}</span><div><div><span class="big">${e.fit}% match</span><span class="what">${esc(e.label || "Your taste")}</span></div>${names ? `<p>${esc(names)}</p>` : ""}</div></div>` : ""}
      ${roomHtml(e.crowd)}
      <div class="actions" style="grid-template-columns:1fr">
        <button class="btn btn-mint" type="button" data-act="open">${icon("open_in_full")}Lineup, ride and after the show</button>
      </div>
    </div>
  </article>`;
}

function renderStream() {
  const d = state.data;
  const body = $("streamBody");
  const parts = [];
  const st = d.eventsStatus || {};
  if (st.refreshing) parts.push(`<div class="banner spin" role="status">${icon("progress_activity")}Still searching for events in ${esc(d.city.name)}. They'll appear here in a minute or two.</div>`);

  const venues = d.venues;
  const events = d.events;
  let featured = null;
  if (venues[0]?.crowd?.likeYou) featured = { type: "place", v: venues[0] };
  else if (events[0]) featured = { type: "event", e: events[0] };
  else if (venues[0]) featured = { type: "place", v: venues[0] };

  if (!venues.length && !events.length) {
    parts.push(`<div class="empty">${icon("bedtime")}<h3>Quiet near you</h3><p>Nothing ${state.when === "now" ? "open right now" : "on tonight"} matches these filters.</p>${state.when !== "week" ? `<button class="btn btn-ghost" type="button" data-when-go="week">Try this week</button>` : ""}</div>`);
  }
  if (featured) parts.push(featured.type === "place" ? featureVenue(featured.v) : featureEvent(featured.e));

  const restEvents = events.filter((e) => !(featured?.type === "event" && featured.e.id === e.id));
  if (restEvents.length) {
    parts.push(`<p class="section-title">${icon("event")}Events ${state.when === "week" ? "this week" : state.when === "now" ? "on now" : "tonight"} <span class="n">${restEvents.length}</span></p>`);
    parts.push(...restEvents.map(eventRow));
  } else if (!st.refreshing && !events.length && (venues.length) && [...(state.kinds.size ? state.kinds : ["music", "comedy"])].some((k) => k === "music" || k === "comedy")) {
    parts.push(`<p class="section-title">${icon("event")}Events</p><div class="banner info">${icon("info")}No events ${state.when === "week" ? "this week" : "tonight"} match your filters yet.${state.when !== "week" ? ` <button class="btn btn-sm btn-ghost" type="button" data-when-go="week">This week</button>` : ""}</div>`);
  }
  const restVenues = venues.filter((v) => !(featured?.type === "place" && featured.v.id === v.id));
  if (restVenues.length) {
    parts.push(`<p class="section-title">${icon("storefront")}Places <span class="n">${restVenues.length}</span></p>`);
    parts.push(...restVenues.map(compactVenue));
  }
  parts.push(`<p class="faint" style="font-size:11px;padding:0 4px">Places and matches from Qloo. Events found on the web each day and scored against your taste by Qloo. People counts come from check-ins on Outside.</p>`);
  body.innerHTML = parts.join("");
  $("stream").setAttribute("aria-busy", "false");
  if (state.selected) document.querySelector(`.card[data-key="${state.selected.type}:${CSS.escape(state.selected.id)}"]`)?.classList.add("selected");

  // Fill the featured card with faces, notes and the "your taste" rating.
  if (featured?.type === "place" && !cardCache.get(featured.v.id)) {
    getCard(featured.v.id, featured.v.match).then(() => { if (state.data === d) renderStream(); }).catch(() => {});
  }
}

$("streamBody").addEventListener("click", async (e) => {
  const go = e.target.closest("[data-when-go]");
  if (go) return setWhen(go.dataset.whenGo);
  const card = e.target.closest(".card");
  if (!card) return;
  const [type, ...rest] = card.dataset.key.split(":");
  const id = rest.join(":");
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (type === "event") return act ? (location.hash = `event/${id}`) : select({ type, id });
  if (act === "open") return goPlace(id);
  if (act === "ride") { const v = findVenue(id); location.hash = `place/${id}?${v?.match != null ? `m=${v.match}&` : ""}ride=1`; return; }
  if (act === "checkin") {
    if (state.checkin?.venueId === id) return goPlace(id);
    const res = await checkIn(id);
    if (res) { state.checkin = res; renderChip(); renderStream(); }
    return;
  }
  if (act === "hi") {
    if (state.checkin?.venueId === id) location.hash = "here";
    else { toast("Check in here first, then you can say hi to people like you."); goPlace(id); }
    return;
  }
  select({ type, id });
});
$("streamBody").addEventListener("mouseover", (e) => {
  const card = e.target.closest(".card[data-key]");
  if (card && !card.classList.contains("hot")) hot(card.dataset.key, "list");
});
$("streamBody").addEventListener("mouseleave", () => clearHot());
$("streamBody").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("card")) { e.preventDefault(); e.target.click(); }
});

/* ---------- loading and filters ---------- */

let loadSeq = 0;
async function load({ quiet = false } = {}) {
  const mine = ++loadSeq;
  if (!quiet) { $("streamBody").innerHTML = `<div class="skeleton" style="height:420px"></div><div class="skeleton" style="height:170px"></div><div class="skeleton" style="height:170px"></div>`; $("stream").setAttribute("aria-busy", "true"); }
  const q = new URLSearchParams({ when: state.when });
  if (state.kinds.size) q.set("kinds", [...state.kinds].join(","));
  try {
    const d = await api(`/api/map?${q}`);
    if (mine !== loadSeq) return;
    state.data = d;
    $("originNote").innerHTML = `${icon("near_me")}<span>Around ${esc(d.origin?.label || d.city.name)}</span>`;
    renderStream();
    drawMarkers();
    watchEvents();
  } catch (err) {
    if (mine !== loadSeq) return;
    $("streamBody").innerHTML = `<div class="empty">${icon("error")}<h3>Couldn't load the map</h3><p>${esc(err.message)}</p><button class="btn btn-ghost" type="button" id="retry">Try again</button></div>`;
    $("retry").onclick = () => load();
  }
}

// While events for this city are still being searched, check every 15 s (3 min at most).
function watchEvents() {
  clearTimeout(state.pollTimer);
  if (!state.data?.eventsStatus?.refreshing) return;
  if (!state.pollUntil) state.pollUntil = Date.now() + 180_000;
  if (Date.now() > state.pollUntil) return;
  state.pollTimer = setTimeout(async () => {
    try {
      const r = await api(`/api/events?when=${state.when}`);
      if (!r.status?.refreshing) { state.pollUntil = 0; load({ quiet: true }); return; }
    } catch {}
    watchEvents();
  }, 15_000);
}

function setWhen(w) {
  state.when = w;
  document.querySelectorAll("[data-when]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.when === w)));
  load();
}
document.querySelectorAll("[data-when]").forEach((b) => b.addEventListener("click", () => setWhen(b.dataset.when)));
document.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
  const k = b.dataset.kind;
  if (k === "all") state.kinds.clear();
  else if (state.kinds.has(k)) state.kinds.delete(k);
  else state.kinds.add(k);
  document.querySelectorAll("[data-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.kind === "all" ? !state.kinds.size : state.kinds.has(x.dataset.kind))));
  load();
}));

function tickClock() {
  const tz = state.data?.city?.tz;
  $("nowClock").textContent = tz ? `(${timeIn(new Date().toISOString(), tz)})` : "";
}
setInterval(tickClock, 30_000);

/* ---------- checked-in chip ---------- */

function renderChip() {
  const c = state.checkin;
  const el = $("checkinChip");
  el.hidden = !c;
  if (!c) return;
  el.innerHTML = `${icon(c.verified === false ? "location_off" : "where_to_vote")}<span>At ${esc(c.venueName)}</span><button type="button" id="chipHere">Who's here</button><button type="button" id="chipLeave">Leave</button>`;
  $("chipHere").onclick = () => { location.hash = "here"; };
  $("chipLeave").onclick = async () => {
    try { await api("/api/checkin", { method: "DELETE" }); state.checkin = null; renderChip(); toast("Checked out."); load({ quiet: true }); }
    catch (err) { toast(err.message, { error: true }); }
  };
  setRibbonHeight();
}

/* ---------- routes: #place/ID, #event/ID, #here, #inbox, #chat/ID, #settings, #rate ---------- */

const ctx = {
  get me() { return state.me; },
  set me(u) { state.me = u; topbar({ active: "tonight", user: u, cityLabel: cityLabel(u) }); },
  get checkin() { return state.checkin; },
  set checkin(c) { state.checkin = c; renderChip(); if (state.data) renderStream(); },
  get city() { return state.data?.city || { name: state.me.city, tz: undefined }; },
  findVenue,
  refresh: () => load({ quiet: true }),
  clearHash() { if (location.hash) history.replaceState(null, "", location.pathname + location.search); },
};

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) { if (sheetOpen()) closeSheet(); return; }
  const [path, qs] = h.split("?");
  const q = new URLSearchParams(qs || "");
  const [name, ...rest] = path.split("/");
  const id = rest.join("/");
  if (name === "place" && id) return openPlace(ctx, id, { match: q.get("m"), ride: q.get("ride") === "1" });
  if (name === "event" && id) return openEvent(ctx, id);
  if (name === "here") return openHere(ctx);
  if (name === "inbox") return openInbox(ctx);
  if (name === "chat" && id) return openChat(ctx, id);
  if (name === "settings") return openSettings(ctx);
  if (name === "rate") return openRate(ctx);
}
addEventListener("hashchange", route);

renderChip();
await load();
tickClock();
route();
// ?focus=place:<id> or event:<id> opens the map on that marker (shareable).
{
  const f = new URLSearchParams(location.search).get("focus");
  const [type, ...rest] = (f || "").split(":");
  if ((type === "place" || type === "event") && rest.length && markers.has(`${type}:${rest.join(":")}`)) {
    const mk = markers.get(`${type}:${rest.join(":")}`);
    // Land the opening shot on the shared place instead of your stay.
    intro = { center: mk.getLngLat().toArray(), zoom: 15 };
    if (introDone) ease({ center: intro.center, zoom: 15 });
    select({ type, id: rest.join(":") }, { from: "map" });
  }
}
pollInbox(setHelloCount);

// How was it? Ask once per visit about places you checked in at and haven't rated.
if (!location.hash) {
  api("/api/reviews/pending").then(({ pending }) => {
    let asked = false;
    try { asked = sessionStorage.getItem("outside.asked") === "1"; } catch {}
    if (pending?.length && !asked && !location.hash) {
      try { sessionStorage.setItem("outside.asked", "1"); } catch {}
      location.hash = "rate";
    }
  }).catch(() => {});
}
