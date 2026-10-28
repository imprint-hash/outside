// The place card and the event card, as a side sheet (a bottom sheet on
// phones). Qloo's review data, our two ratings, who's here (faces, no
// names), ride links, check in.
import { api, esc } from "/api.js";
import { icon, openSheet, onSheetClose, toast, ratingPill, hoursFact, tripText, timeIn, dayIn, stars, avatarSVG, whereAmI, demoTag, demoCount, compact } from "/ui.js";

export const cardCache = new Map();

export async function getCard(id, match = null) {
  const q = match != null && match !== "" ? `?match=${encodeURIComponent(match)}` : "";
  const card = await api(`/api/places/${encodeURIComponent(id)}${q}`);
  cardCache.set(id, card);
  return card;
}

/** Check in, asking for the browser's location so the check-in can be verified. */
export async function checkIn(venueId) {
  toast("Checking you in. Sharing your location lets you see who's here.", { ms: 6000 });
  const at = await whereAmI();
  try {
    const { checkin } = await api("/api/checkin", { method: "POST", body: { venueId, ...(at || {}) } });
    if (checkin?.verified === false) {
      toast("Checked in. Share your location when you check in to see who's here.", { ms: 6000 });
    } else toast(`Checked in at ${checkin?.venueName || "the venue"}.`);
    cardCache.delete(venueId);
    return checkin;
  } catch (err) {
    toast(err.message, { error: true });
    return null;
  }
}

function rideHtml(ride, address) {
  if (!ride) return "";
  return `<div class="panel" id="ridePanel">
    <h3>${icon("local_taxi")}Ride there</h3>
    <div class="ride-links">
      ${ride.uber ? `<a class="btn btn-mint btn-stack" href="${esc(ride.uber)}" target="_blank" rel="noopener">${icon("local_taxi")}Uber<small>Route filled in</small></a>` : ""}
      ${ride.bolt ? `<a class="btn btn-stack" href="${esc(ride.bolt)}" target="_blank" rel="noopener" data-bolt="${esc(address || "")}">${icon("hail")}Bolt<small>Destination copied</small></a>` : ""}
      <a class="btn btn-stack" href="${esc(ride.maps)}" target="_blank" rel="noopener">${icon("map")}Maps<small>Directions</small></a>
    </div>
    <p class="faint" style="font-size:12px">You confirm the trip and see the price in the app.</p>
  </div>`;
}

function wireBolt(root) {
  root.querySelector("[data-bolt]")?.addEventListener("click", (e) => {
    const addr = e.currentTarget.dataset.bolt;
    if (addr) navigator.clipboard?.writeText(addr).then(() => toast("Address copied. Paste it into Bolt.")).catch(() => {});
  });
}

function facesHtml(crowd) {
  if (!crowd?.here) return `<p class="muted">Nobody's checked in here yet tonight.</p>`;
  const faces = crowd.faces || [];
  return `
    <p>${crowd.likeYou ? `<b class="mint">${crowd.likeYou} ${crowd.likeYou === 1 ? "person" : "people"} with your taste</b> of ${crowd.here} checked in` : `${crowd.here} checked in, none share your taste yet`}${crowd.demo ? ` <span class="tag tag-demo">${crowd.demo} demo</span>` : ""}</p>
    ${faces.length ? `<div class="face-grid">${faces.map((f) => `<div class="face-card">
        ${avatarSVG(f.avatar, { size: 56, plumbob: f.match >= 60 ? "strong" : f.match >= 40 ? "okay" : null })}
        ${f.match != null ? `<span class="tag tag-mint">${f.match}% like you</span>` : ""}${demoTag(f)}
        ${f.bubbles?.length ? `<div class="bubbles" style="justify-content:center">${f.bubbles.map((b) => `<span class="bubble">${esc(b)}</span>`).join("")}</div>` : ""}
      </div>`).join("")}</div>` : ""}
    <p class="faint" style="font-size:12px">No names or locations. You see who they are once you're both checked in here.</p>`;
}

/* ---------- the "Q" chip: the Qloo request behind a match ---------- */

const show = (v) => (Array.isArray(v) ? v.join(", ") : String(v));

/** A small button under a match; tapping it opens the Qloo call behind the number. */
export function proofChip(proof) {
  if (!proof) return "";
  return `<button class="qchip" type="button" data-act="proof" aria-expanded="false"><span class="q" aria-hidden="true">Q</span>See the Qloo call</button><div class="proof" hidden></div>`;
}

export function proofHtml(proof, placeId) {
  const params = Object.entries(proof.params || {});
  const drivers = proof.drivers || [];
  const top = Math.max(0.01, ...drivers.map((d) => d.score));
  return `
    <p class="label">The match · one call to Qloo</p>
    <code class="call">${esc(proof.call)}</code>
    <dl class="params">${params.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(show(v))}</dd>`).join("")}</dl>
    ${proof.affinity != null ? `<p>Qloo's affinity for this place: <b class="mint">${Number(proof.affinity).toFixed(3)}</b>, shown as ${Math.round(proof.affinity * 100)}%.</p>` : ""}
    ${drivers.length ? `<p class="label">What carried it · Qloo explainability</p>
      <div class="kw">${drivers.map((d) => `<div class="kw-row"><span>${esc(d.name)}</span><span class="n">${d.score.toFixed(2)}</span><span class="bar"><i style="width:${Math.max(4, (d.score / top) * 100)}%"></i></span></div>`).join("")}</div>` : ""}
    <p class="label">Rating and reviews · one more call</p>
    <code class="call">GET /v2/insights</code>
    <dl class="params"><dt>filter.type</dt><dd>urn:entity:place</dd><dt>filter.results.entities</dt><dd>${esc(placeId)}</dd></dl>
    <p class="faint" style="font-size:11px">Only the things you love are sent to Qloo, never who you are.</p>`;
}

/** Open or close the proof panel next to a chip. */
export function toggleProof(chip, proof, placeId) {
  const panel = chip.nextElementSibling;
  if (!panel) return;
  const open = panel.hidden;
  if (open && !panel.innerHTML) panel.innerHTML = proofHtml(proof, placeId);
  panel.hidden = !open;
  chip.setAttribute("aria-expanded", String(open));
}

const SUMM = [["ambience", "Ambience"], ["service", "Service"], ["crowd", "Crowd"], ["overall", "Overall"]];

function placeHtml(ctx, c, { ride }) {
  const p = c.place;
  const q = c.qloo || {};
  const ours = c.ours || {};
  const here = ctx.checkin?.venueId === p.id;
  const kws = q.keywords || [];
  const max = Math.max(1, ...kws.map((k) => k.mentions));
  const summ = SUMM.filter(([k]) => q.summaries?.[k]);
  const facts = [
    p.price && `<span class="fact">${esc(p.price)}</span>`,
    hoursFact(p.hours),
    p.trip && `<span class="fact">${icon(p.trip.mode === "walk" ? "directions_walk" : "directions_car")}${esc(tripText(p.trip))}${p.trip.warning ? ` · ${esc(p.trip.warning)}` : ""}</span>`,
    p.website && `<a class="fact" href="${esc(p.website)}" target="_blank" rel="noopener">${icon("language")}Website</a>`,
    p.phone && `<a class="fact" href="tel:${esc(p.phone)}">${icon("call")}Call</a>`,
  ].filter(Boolean).join("");

  return `
    <div class="hero">
      ${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="media-blank">${icon("storefront")}</div>`}
      ${c.fit?.label ? `<span class="tl glass-tag">${icon("verified")}${esc(c.fit.label)}</span>` : ""}
      <span class="tr">${ratingPill({ all: q.rating, ours })}</span>
    </div>
    <div class="pad">
      <div>
        <div class="title-row"><h3 style="font:600 24px/32px var(--head)">${esc(p.name)}</h3>${p.area ? `<span class="area">${esc(p.area)}</span>` : ""}</div>
        ${p.address ? `<p class="muted" style="font-size:13px">${esc(p.address)}</p>` : ""}
      </div>
      ${facts ? `<div class="facts">${facts}</div>` : ""}
      ${c.fit?.match != null ? `<div class="matchbox"><span class="ico">${icon("auto_graph")}</span><div><div><span class="big">${c.fit.match}% match</span><span class="what">Your taste · Qloo</span></div>${p.why ? `<p>${esc(p.why)}</p>` : ""}${proofChip(ctx.findVenue?.(p.id)?.proof)}</div></div>` : ""}

      <div class="actions">
        <button class="btn btn-mint btn-stack" type="button" data-act="ride">${icon("local_taxi")}Ride there</button>
        ${here
          ? `<button class="btn btn-stack" type="button" data-act="leave">${icon("where_to_vote", "mint")}Checked in<small>Tap to leave</small></button>`
          : `<button class="btn btn-stack" type="button" data-act="checkin">${icon("location_on", "mint")}Check in</button>`}
        <button class="btn btn-stack" type="button" data-act="hi" ${c.you?.canSayHi ? "" : "aria-disabled=\"true\""}>${icon("waving_hand", "amber")}Say hi${c.crowd?.likeYou ? ` (${c.crowd.likeYou})` : ""}</button>
      </div>
      ${!c.you?.canSayHi ? `<p class="faint" style="font-size:12px;margin-top:-8px">Check in here to see who's here and say hi.</p>` : ""}
      ${c.you?.canReview ? `<button class="btn btn-amber" type="button" data-act="rate">${icon("star")}How was it? Rate ${esc(p.name)}</button>` : c.you?.reviewedToday ? `<p class="ok-msg">${icon("check")} You rated it today. Thanks.</p>` : ""}

      <div id="rideSlot">${ride ? rideHtml(c.ride, p.address || p.name) : ""}</div>

      <section class="panel" aria-label="Ratings">
        <h3>${icon("star")}Ratings</h3>
        <div class="bigrate">
          <div><b>${q.rating != null ? `${q.rating.toFixed(1)} ★` : "–"}</b><small>Everyone${ours.overall?.count ? ` · plus ${ours.overall.count} on Outside (${ours.overall.avg.toFixed(1)} ★)${demoCount(ours.overall.demo)}` : ""}</small></div>
          <div class="yt"><b>${ours.likeYou?.enough && ours.likeYou.avg != null ? `${ours.likeYou.avg.toFixed(1)} ★` : "–"}</b><small>${ours.likeYou?.enough ? `People with your taste · ${ours.likeYou.count}${demoCount(ours.likeYou.demo)}` : ours.likeYou?.count ? `Only ${ours.likeYou.count} rating from people like you so far${demoCount(ours.likeYou.demo)}` : "No ratings from people like you yet"}</small></div>
        </div>
      </section>

      ${kws.length || summ.length ? `<section class="panel" aria-label="What reviewers say">
        <h3>${icon("reviews")}What reviewers mention<span class="src">Qloo</span></h3>
        ${kws.length ? `<div class="kw">${kws.map((k) => `<div class="kw-row"><span>${esc(k.text)}</span><span class="n">${compact(k.mentions)} mentions</span><span class="bar"><i style="width:${Math.max(4, (k.mentions / max) * 100)}%"></i></span></div>`).join("")}</div>` : ""}
        ${summ.length ? `<dl class="summ">${summ.map(([k, l]) => `<dt>${l}</dt><dd>${esc(q.summaries[k])}</dd>`).join("")}</dl>` : ""}
        ${q.summaries?.dishes?.length ? `<p class="muted" style="font-size:13px"><b class="amber">Known for:</b> ${q.summaries.dishes.map(esc).join(", ")}</p>` : ""}
      </section>` : ""}

      ${ours.notes?.length ? `<section class="panel" aria-label="Notes from people on Outside">
        <h3>${icon("forum")}From people who went</h3>
        ${ours.notes.map((n) => `<div class="note"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center">${stars(n.stars)}${n.match != null && n.match >= 40 ? `<span class="tag tag-mint">${n.match}% like you</span>` : ""}</div><p>“${esc(n.note)}”</p>${n.because || n.demo ? `<small>${esc(n.because || "")} ${demoTag(n)}</small>` : ""}</div>`).join("")}
      </section>` : ""}

      <section class="panel" aria-label="Who's here">
        <h3>${icon("groups")}Who's here tonight</h3>
        ${facesHtml(c.crowd)}
      </section>

      ${p.vibe?.length ? `<div class="facts">${p.vibe.map((v) => `<span class="tag">${esc(v)}</span>`).join("")}</div>` : ""}
    </div>`;
}

export async function openPlace(ctx, id, { match = null, ride = false } = {}) {
  const v = ctx.findVenue?.(id);
  const body = openSheet({ title: v?.name || "Place", html: `<div class="skeleton" style="height:220px;border-radius:0"></div><div class="pad"><div class="skeleton" style="height:28px;width:60%"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:200px"></div></div>` });
  onSheetClose(() => ctx.clearHash());
  let c;
  try {
    c = await getCard(id, match ?? v?.match ?? null);
  } catch (err) {
    body.innerHTML = `<div class="pad"><div class="empty">${icon("error")}<h3>Couldn't open this place</h3><p>${esc(err.message)}</p></div></div>`;
    return;
  }
  if (!body.isConnected) return;
  document.getElementById("sheetTitle").textContent = c.place.name;
  const draw = (opts) => {
    body.innerHTML = placeHtml(ctx, c, opts);
    wireBolt(body);
  };
  draw({ ride });
  if (ride) body.querySelector("#ridePanel")?.scrollIntoView({ block: "center" });

  body.onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "proof") return toggleProof(e.target.closest("[data-act]"), ctx.findVenue?.(id)?.proof, id);
    if (act === "ride") {
      const slot = body.querySelector("#rideSlot");
      if (!c.ride) return toast("No ride links for this place.", { error: true });
      slot.innerHTML = slot.innerHTML ? "" : rideHtml(c.ride, c.place.address || c.place.name);
      wireBolt(slot);
      slot.firstElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (act === "checkin") {
      const res = await checkIn(id);
      if (res) {
        ctx.checkin = res;
        try { c = await getCard(id, match ?? v?.match ?? null); } catch {}
        draw({ ride: false });
        ctx.refresh();
      }
    }
    if (act === "leave") {
      try { await api("/api/checkin", { method: "DELETE" }); ctx.checkin = null; toast("Checked out."); draw({ ride: false }); ctx.refresh(); }
      catch (err) { toast(err.message, { error: true }); }
    }
    if (act === "hi") {
      if (!c.you?.canSayHi) return toast("Check in here first, then you can see who's here and say hi.");
      location.hash = "here";
    }
    if (act === "rate") location.hash = `rate?place=${encodeURIComponent(id)}&name=${encodeURIComponent(c.place.name)}`;
  };
}

/* ---------- event card ---------- */

export async function openEvent(ctx, id) {
  const body = openSheet({ title: "Event", html: `<div class="pad"><div class="skeleton" style="height:28px;width:70%"></div><div class="skeleton" style="height:160px"></div></div>` });
  onSheetClose(() => ctx.clearHash());
  let r;
  try { r = await api(`/api/events/${encodeURIComponent(id)}`); }
  catch (err) { body.innerHTML = `<div class="pad"><div class="empty">${icon("error")}<h3>Couldn't open this event</h3><p>${esc(err.message)}</p></div></div>`; return; }
  if (!body.isConnected) return;
  const { event: e, crowd, ride, trip } = r;
  const tz = ctx.city?.tz;
  const d = dayIn(e.starts, tz);
  document.getElementById("sheetTitle").textContent = e.title;
  const artists = e.artists || [];
  body.innerHTML = `<div class="pad">
    <div>
      <p class="label amber">${esc(d.wd)} ${esc(d.day)} ${esc(d.mon)} · ${esc(timeIn(e.starts, tz))}${e.ends ? `–${esc(timeIn(e.ends, tz))}` : ""}</p>
      <h3 style="font:600 24px/32px var(--head);margin-top:4px">${esc(e.title)}</h3>
      <p class="muted">${esc(e.venue?.name || "")}${e.venue?.area ? ` · ${esc(e.venue.area)}` : ""}${e.venue?.approximate ? " (location approximate)" : ""}</p>
    </div>
    <div class="facts">
      ${trip ? `<span class="fact">${icon(trip.mode === "walk" ? "directions_walk" : "directions_car")}${esc(tripText(trip))}</span>` : ""}
      ${e.source ? `<a class="fact" href="${esc(e.source)}" target="_blank" rel="noopener">${icon("open_in_new")}Where we found it</a>` : ""}
      ${e.status === "announced" || e.ownerId ? `<span class="fact">${icon("campaign")}Added by the organiser</span>` : ""}
    </div>
    ${e.fit != null ? `<div class="matchbox"><span class="ico">${icon("auto_graph")}</span><div><div><span class="big">${e.fit}% match</span><span class="what">${esc(e.label || "")}</span></div>${e.why ? `<p>${esc(e.why)}</p>` : ""}</div></div>` : ""}
    ${artists.length ? `<section class="panel"><h3>${icon("queue_music")}${e.lineup?.length ? "Lineup" : "Sounds like"} vs your taste<span class="src">Qloo</span></h3>
      <ul class="list-plain lineup">${artists.map((a) => `<li><span>${esc(a.name)}</span>${a.youLove ? `<span class="tag tag-mint-solid">You love them</span>` : a.fit != null ? `<span class="tag tag-mint">${a.fit}% fit</span>` : `<span class="tag">Not scored</span>`}</li>`).join("")}</ul></section>` : ""}
    ${crowd ? `<section class="panel"><h3>${icon("groups")}At the venue now</h3>${facesHtml(crowd)}</section>` : ""}
    ${rideHtml(ride, e.venue?.name)}
    <section class="panel"><h3>${icon("nightlife")}After the show</h3>
      <div id="after"><button class="btn btn-ghost btn-block" type="button" data-act="after">Find places open when it ends</button></div>
    </section>
  </div>`;
  wireBolt(body);
  body.onclick = async (ev) => {
    if (ev.target.closest("[data-act='after']")) {
      const box = body.querySelector("#after");
      box.innerHTML = `<div class="skeleton" style="height:80px"></div>`;
      try {
        const { places } = await api(`/api/events/${encodeURIComponent(id)}/after`);
        box.innerHTML = places?.length
          ? `<ul class="list-plain">${places.map((p) => `<li><a class="person" style="text-decoration:none;color:inherit" href="#place/${esc(p.id)}${p.match != null ? `?m=${p.match}` : ""}">
              <span class="av">${p.image ? `<img src="${esc(p.image)}" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover">` : icon("storefront")}</span>
              <span class="info"><b>${esc(p.name)}</b><span class="muted" style="font-size:12px">${[p.area, p.price, p.hours?.closesAt ? `open till ${p.hours.closesAt}` : ""].filter(Boolean).map(esc).join(" · ")}</span></span>
              ${p.match != null ? `<span class="tag tag-mint">${p.match}%</span>` : ""}</a></li>`).join("")}</ul>`
          : `<p class="muted">Nothing we know of is open near the venue when it ends.</p>`;
      } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    }
  };
}
