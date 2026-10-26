// People: who's here, hellos, chat (with block and report), safe meet-up,
// how was it, and settings. All rules (who can see whom, rate limits,
// meet-up limits) live on the server; this only shows what it returns.
import { api, esc, signOut } from "/api.js";
import { icon, openSheet, onSheetClose, toast, avatarSVG, timeIn, ago, chats, rememberChat, forgetChat, demoTag, whereAmI } from "/ui.js";

const VIS = [
  ["everyone", "Everyone here", "Anyone checked in at the same place can see you."],
  ["strong", "Strong matches only", "Only people who share a lot of your taste."],
  ["verified", "Verified people only", "Only people with a verified account."],
  ["groups", "Groups only", "You're counted for group plans, never shown one-to-one."],
  ["nobody", "Nobody", "Invisible tonight. You won't see others either."],
];

function visHtml(current, name = "vis") {
  return `<div class="radio-list" role="radiogroup" aria-label="Who can see you">${VIS.map(([v, t, s]) => `<label><input type="radio" name="${name}" value="${v}" ${current === v ? "checked" : ""}><span><b>${t}</b><small>${s}</small></span></label>`).join("")}</div>`;
}
async function saveVis(ctx, v) {
  try { const { user } = await api("/api/me/visibility", { method: "POST", body: { visibility: v } }); ctx.me = user; toast("Saved. Only people you allow can see you."); }
  catch (err) { toast(err.message, { error: true }); }
}

const nameOf = (n) => esc(n || "Someone");
const nameTag = () => ""; // demo users already carry "Demo · " in their name

/* ---------- inbox polling ---------- */

export function pollInbox(setCount) {
  const tick = async () => {
    try { const { hellos } = await api("/api/hello/inbox"); setCount(hellos?.length || 0); } catch {}
  };
  tick();
  setInterval(tick, 20_000);
}

/* ---------- people here ---------- */

export async function openHere(ctx) {
  const body = openSheet({ title: "People here", html: `<div class="pad"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px"></div></div>` });
  onSheetClose(() => ctx.clearHash());
  let r;
  try { r = await api("/api/here"); }
  catch (err) {
    body.innerHTML = `<div class="pad"><div class="empty">${icon("location_on")}<h3>Not checked in</h3><p>${esc(err.message)}</p><p class="faint">Open a place on the map and tap Check in. You only ever see people at the same place as you, tonight.</p></div></div>`;
    return;
  }
  if (!body.isConnected) return;
  document.getElementById("sheetTitle").textContent = `People at ${r.venue || "this place"}`;
  const sent = new Set(chats().map((c) => c.otherId));
  const people = r.people || [];
  const named = people.filter((p) => p.userId && p.firstName);
  const anon = people.length && !named.length;
  const canHi = r.verified !== false && !anon;

  body.innerHTML = `<div class="pad">
    ${r.note ? `<div class="banner">${icon("info")}${esc(r.note)}</div>` : ""}
    ${!canHi && people.length ? `<div class="banner">${icon("location_off")}Share your location when you check in to see who's here.</div>` : ""}
    ${people.length ? `<ul class="list-plain">${people.map((p) => `<li class="person">
        <span class="av">${avatarSVG(p.avatar, { size: 52, plumbob: p.match >= 60 ? "strong" : p.match >= 40 ? "okay" : null, label: p.firstName || "" })}</span>
        <span class="info">
          <b>${p.firstName ? nameOf(p.firstName) : "Someone like you"}${nameTag(p.firstName)}${demoTag(p)}${p.verified ? ` <span class="ms mint" title="Verified" aria-label="Verified">verified</span>` : ""}</b>
          ${p.match != null ? `<span class="tag tag-mint" style="align-self:flex-start">${p.match}% like you</span>` : ""}
          ${p.bubbles?.length ? `<span class="bubbles">${p.bubbles.map((b) => `<span class="bubble">${esc(b)}</span>`).join("")}</span>` : ""}
          ${p.line ? `<small class="faint">${esc(p.line)}</small>` : ""}
        </span>
        ${canHi && p.userId ? (sent.has(p.userId)
          ? `<button class="btn btn-sm" type="button" disabled>Sent</button>`
          : `<button class="btn btn-sm btn-mint" type="button" data-hi="${esc(p.userId)}" data-name="${esc(p.firstName || "")}">${icon("waving_hand")}Say hi</button>`)
          : `<button class="btn btn-sm" type="button" disabled title="Share your location when you check in to see who's here.">Say hi</button>`}
      </li>`).join("")}</ul>`
      : `<div class="empty">${icon("person_search")}<h3>No one to show yet</h3><p>Nobody here has chosen to be seen by you tonight. Check back later.</p></div>`}
    ${r.groupMinded ? `<div class="banner info">${icon("diversity_3")}${r.groupMinded} more like you here would rather meet as a group.</div>` : ""}
    <section class="panel"><h3>${icon("visibility")}Who can see you</h3>${visHtml(ctx.me.visibility)}</section>
    <p class="faint" style="font-size:12px">Saying hi shows them your first name and what you both love. Nothing else. Chat opens only if they say yes. 10 hellos an hour at most.</p>
  </div>`;

  body.onchange = (e) => { if (e.target.name === "vis") saveVis(ctx, e.target.value); };
  body.onclick = async (e) => {
    const b = e.target.closest("[data-hi]");
    if (!b) return;
    b.disabled = true;
    try {
      const { hello } = await api("/api/hello", { method: "POST", body: { to: b.dataset.hi } });
      const p = people.find((x) => x.userId === b.dataset.hi);
      rememberChat({ helloId: hello.id, otherId: b.dataset.hi, firstName: b.dataset.name, avatar: p?.avatar || null, mine: true, venue: r.venue });
      b.textContent = "Sent";
      b.classList.remove("btn-mint");
      toast(`Hi sent to ${b.dataset.name}. Chat opens if they say yes.`);
    } catch (err) { b.disabled = false; toast(err.message, { error: true }); }
  };
}

/* ---------- hellos inbox ---------- */

export async function openInbox(ctx) {
  const body = openSheet({ title: "Hellos", html: `<div class="pad"><div class="skeleton" style="height:90px"></div></div>` });
  onSheetClose(() => ctx.clearHash());
  let hellos = [];
  let err = null;
  try { ({ hellos } = await api("/api/hello/inbox")); } catch (e) { err = e; }
  if (!body.isConnected) return;
  const mine = chats();
  body.innerHTML = `<div class="pad">
    ${err ? `<p class="error">${esc(err.message)}</p>` : ""}
    <section class="panel"><h3>${icon("waving_hand")}Waiting for your answer</h3>
      ${hellos.length ? `<ul class="list-plain">${hellos.map((h) => `<li class="person">
        <span class="av">${avatarSVG(h.avatar, { size: 52, plumbob: "yes" })}</span>
        <span class="info"><b>${nameOf(h.firstName)}${nameTag(h.firstName)}</b>
          ${h.match != null ? `<span class="tag tag-mint" style="align-self:flex-start">${h.match}% like you</span>` : ""}
          ${h.line ? `<small class="muted">${esc(h.line)}</small>` : ""}
          <small class="faint">At ${esc(h.venue || "the same place")} · ${esc(ago(h.at))}</small>
          <span style="display:flex;gap:6px;margin-top:4px">
            <button class="btn btn-sm btn-mint" type="button" data-yes="${esc(h.helloId)}">Say yes</button>
            <button class="btn btn-sm" type="button" data-no="${esc(h.helloId)}">Ignore</button>
          </span>
        </span></li>`).join("")}</ul>` : `<p class="muted">No hellos right now. Check in somewhere and people like you can say hi.</p>`}
    </section>
    <section class="panel"><h3>${icon("forum")}Your chats</h3>
      ${mine.length ? `<ul class="list-plain">${mine.map((c) => `<li><a class="person" style="text-decoration:none;color:inherit" href="#chat/${esc(c.helloId)}">
        <span class="av">${avatarSVG(c.avatar, { size: 44 })}</span>
        <span class="info"><b>${nameOf(c.firstName)}${nameTag(c.firstName)}</b><small class="faint">${c.mine ? "You said hi" : "They said hi"}${c.venue ? ` at ${esc(c.venue)}` : ""}</small></span>
        ${icon("chevron_right")}</a></li>`).join("")}</ul>` : `<p class="muted">Nothing yet.</p>`}
      <p class="faint" style="font-size:12px">Chats are listed on this device.</p>
    </section>
  </div>`;
  body.onclick = async (e) => {
    const yes = e.target.closest("[data-yes]"), no = e.target.closest("[data-no]");
    const id = yes?.dataset.yes || no?.dataset.no;
    if (!id) return;
    try {
      const { hello } = await api(`/api/hello/${encodeURIComponent(id)}/answer`, { method: "POST", body: { accept: Boolean(yes) } });
      const h = hellos.find((x) => x.helloId === id);
      if (yes) {
        rememberChat({ helloId: id, otherId: hello?.from || null, firstName: h?.firstName, avatar: h?.avatar, mine: false, venue: h?.venue });
        location.hash = `chat/${id}`;
      } else { toast("Ignored. They won't be told."); openInbox(ctx); }
    } catch (err) { toast(err.message, { error: true }); }
  };
}

/* ---------- chat, block, report, meet-up ---------- */

const REASONS = { met: "You found each other.", time: "30 minutes are up.", "left the area": "Someone moved more than 1 km from the venue.", stopped: "Meet-up mode was stopped.", blocked: "This chat was closed." };

export async function openChat(ctx, helloId) {
  const c = chats().find((x) => x.helloId === helloId) || { helloId };
  const body = openSheet({
    title: c.firstName ? `${c.firstName}` : "Chat",
    html: `<div id="meet"></div><div class="chat" id="msgs" aria-live="polite"></div><div class="pad" id="chatTools"></div>`,
    footer: `<form class="composer" id="composer"><label class="sr" for="say">Message</label><input class="input" id="say" maxlength="500" autocomplete="off" placeholder="Say something…"><button class="btn btn-mint" type="submit" aria-label="Send">${icon("send")}</button></form>`,
    closeTo: () => { location.hash = "inbox"; },
  });
  let timer = null, meetTimer = null, watchId = null, lastPos = 0, open = true;
  onSheetClose(() => { open = false; clearTimeout(timer); clearTimeout(meetTimer); if (watchId != null) navigator.geolocation?.clearWatch(watchId); ctx.clearHash(); });
  const msgs = body.querySelector("#msgs");
  const form = document.getElementById("composer");
  const tz = ctx.city?.tz;

  body.querySelector("#chatTools").innerHTML = `
    <section class="panel"><h3>${icon("shield")}Stay safe</h3>
      <p class="muted" style="font-size:13px">Meet in the venue. Meet-up mode shares both your locations for 30 minutes at most, only after you both turn it on, and stops when you're within 25 m.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-mint" type="button" data-act="meet">${icon("near_me")}Meet up</button>
        ${c.otherId ? `<button class="btn btn-sm btn-danger" type="button" data-act="block">${icon("block")}Block</button>
        <button class="btn btn-sm btn-danger" type="button" data-act="report">${icon("flag")}Report</button>` : ""}
      </div>
      <div id="reportBox"></div>
    </section>`;

  async function loadMsgs() {
    if (!open) return;
    try {
      const { messages } = await api(`/api/hello/${encodeURIComponent(helloId)}/messages`);
      form.hidden = false;
      const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
      msgs.innerHTML = messages.length
        ? messages.map((m) => `<div class="msg ${m.mine ? "mine" : ""}">${esc(m.text)}<time>${esc(timeIn(m.at, tz))}</time></div>`).join("")
        : `<p class="muted" style="text-align:center">They said yes. Say hello.</p>`;
      if (atEnd) body.scrollTop = body.scrollHeight;
    } catch (err) {
      msgs.innerHTML = `<div class="empty">${icon("hourglass_top")}<h3>Not open yet</h3><p>${esc(err.message)}</p></div>`;
      form.hidden = true;
    }
    timer = setTimeout(loadMsgs, 4000);
  }
  loadMsgs();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById("say");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try { await api(`/api/hello/${encodeURIComponent(helloId)}/messages`, { method: "POST", body: { text } }); clearTimeout(timer); loadMsgs(); body.scrollTop = body.scrollHeight; }
    catch (err) { input.value = text; toast(err.message, { error: true }); }
  };

  /* meet-up, text version */
  const meetBox = body.querySelector("#meet");
  function drawMeet(m) {
    if (!m) { meetBox.innerHTML = ""; return; }
    const ended = m.status === "ended";
    meetBox.innerHTML = `<div class="pad" style="padding-bottom:0"><div class="banner ${ended ? "" : "info"}" role="status">${icon(ended ? "flag" : m.status === "live" ? "near_me" : "hourglass_top")}
      <span>${ended ? `Meet-up ended. ${esc(REASONS[m.endedReason] || "")}`
        : m.status === "live" ? `Live · ${m.metersApart != null ? `${m.metersApart} m apart` : "waiting for their position"} · ${m.minutesLeft} min left`
        : "Waiting for them to turn on meet-up mode too."}</span>
      ${ended ? "" : `<button class="btn btn-sm btn-danger" type="button" data-act="stopmeet" style="margin-left:auto">Stop</button>`}</div></div>`;
  }
  async function sendPos(m) {
    if (m.status !== "live" || Date.now() - lastPos < 10_000) return;
    const at = await whereAmI(6000);
    if (!at) return;
    lastPos = Date.now();
    try { drawMeet((await api(`/api/meetup/${encodeURIComponent(m.meetupId)}/position`, { method: "POST", body: at })).meetup); }
    catch (err) { toast(err.message, { error: true }); }
  }
  async function pollMeet(id) {
    if (!open) return;
    try {
      const { meetup } = await api(`/api/meetup/${encodeURIComponent(id)}`);
      drawMeet(meetup);
      if (meetup.status === "ended") return;
      await sendPos(meetup);
    } catch {}
    meetTimer = setTimeout(() => pollMeet(id), 10_000);
  }
  if (c.meetupId) pollMeet(c.meetupId);

  body.onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "meet") {
      try {
        const { meetup } = await api(`/api/hello/${encodeURIComponent(helloId)}/meetup`, { method: "POST" });
        rememberChat({ ...c, meetupId: meetup.meetupId });
        c.meetupId = meetup.meetupId;
        drawMeet(meetup);
        clearTimeout(meetTimer);
        pollMeet(meetup.meetupId);
      } catch (err) { toast(err.message, { error: true }); }
    }
    if (act === "stopmeet" && c.meetupId) {
      try { await api(`/api/meetup/${encodeURIComponent(c.meetupId)}/stop`, { method: "POST" }); drawMeet({ status: "ended", endedReason: "stopped" }); clearTimeout(meetTimer); }
      catch (err) { toast(err.message, { error: true }); }
    }
    if (act === "block") {
      if (!confirm(`Block ${c.firstName || "them"}? You'll both be hidden from each other and this chat closes.`)) return;
      try { await api("/api/block", { method: "POST", body: { userId: c.otherId } }); forgetChat(helloId); toast("Blocked."); location.hash = "inbox"; }
      catch (err) { toast(err.message, { error: true }); }
    }
    if (act === "report") {
      body.querySelector("#reportBox").innerHTML = `<form id="reportForm" class="field" style="margin-top:8px"><span>What happened?</span><textarea rows="3" maxlength="500" id="reason" required></textarea><button class="btn btn-danger btn-sm" type="submit">Report and block</button></form>`;
      body.querySelector("#reason").focus();
      body.querySelector("#reportForm").onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api("/api/report", { method: "POST", body: { userId: c.otherId, reason: body.querySelector("#reason").value } }); forgetChat(helloId); toast("Reported and blocked. Thank you."); location.hash = "inbox"; }
        catch (err) { toast(err.message, { error: true }); }
      };
    }
  };
}

/* ---------- how was it? ---------- */

export async function openRate(ctx) {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  let target = q.get("place") ? { placeId: q.get("place"), placeName: q.get("name") } : null;
  const body = openSheet({ title: "How was it?", center: true, html: `<div class="pad"><div class="skeleton" style="height:120px"></div></div>` });
  onSheetClose(() => ctx.clearHash());
  let pending = [];
  if (!target) {
    try { ({ pending } = await api("/api/reviews/pending")); } catch {}
    target = pending[0] || null;
  }
  if (!body.isConnected) return;
  if (!target) { body.innerHTML = `<div class="pad"><div class="empty">${icon("star")}<h3>Nothing to rate</h3><p>You can rate a place for 48 hours after you check in there.</p></div></div>`; return; }

  let n = 0;
  const draw = () => {
    body.innerHTML = `<form class="pad" id="rateForm">
      ${pending.length > 1 ? `<label class="field"><span>Place</span><select id="ratePlace">${pending.map((p) => `<option value="${esc(p.placeId)}" ${p.placeId === target.placeId ? "selected" : ""}>${esc(p.placeName || "A place you checked in at")}</option>`).join("")}</select></label>` : `<p class="label mint">${esc(target.placeName || "Your last check-in")}</p>`}
      <p class="muted">Your stars help people with your taste find their kind of night. Your name is never shown.</p>
      <div class="star-input" role="radiogroup" aria-label="Stars">${[1, 2, 3, 4, 5].map((i) => `<button type="button" role="radio" aria-checked="${i === n}" aria-label="${i} star${i > 1 ? "s" : ""}" data-n="${i}" class="${i <= n ? "on" : ""}">${icon("star")}</button>`).join("")}</div>
      <label class="field"><span>One line (optional)</span><input id="rateNote" maxlength="160" placeholder="What made it?" autocomplete="off"><small class="counter" id="rateCount">0 / 140</small></label>
      <p class="error" id="rateErr" role="alert" hidden></p>
      <button class="btn btn-mint" type="submit" ${n ? "" : "disabled"}>Send rating</button>
      <button class="btn btn-ghost" type="button" data-later>Not now</button>
    </form>`;
  };
  draw();
  body.oninput = (e) => {
    if (e.target.id === "rateNote") {
      const len = e.target.value.length;
      const c = body.querySelector("#rateCount");
      c.textContent = `${len} / 140`;
      c.classList.toggle("over", len > 140);
    }
  };
  body.onchange = (e) => { if (e.target.id === "ratePlace") target = pending.find((p) => p.placeId === e.target.value) || target; };
  body.onclick = (e) => {
    const s = e.target.closest("[data-n]");
    if (s) {
      const note = body.querySelector("#rateNote").value;
      n = Number(s.dataset.n);
      draw();
      body.querySelector("#rateNote").value = note;
      body.querySelector(`[data-n="${n}"]`).focus();
    }
    if (e.target.closest("[data-later]")) document.querySelector("dialog.sheet").close();
  };
  body.onsubmit = async (e) => {
    e.preventDefault();
    const note = body.querySelector("#rateNote").value.trim();
    const err = body.querySelector("#rateErr");
    if (note.length > 140) { err.textContent = "Keep it to 140 characters."; err.hidden = false; return; }
    try {
      await api("/api/reviews", { method: "POST", body: { placeId: target.placeId, stars: n, note } });
      body.innerHTML = `<div class="pad"><div class="empty">${icon("check_circle", "mint")}<h3>Thanks</h3><p>People with your taste will see it in their rating for ${esc(target.placeName || "this place")}.</p></div></div>`;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
}

/* ---------- settings and share my night ---------- */

export function openSettings(ctx) {
  const u = ctx.me;
  const body = openSheet({ title: "You", html: `<div class="pad">
    <div class="person">
      <span class="av">${avatarSVG(u.avatar, { size: 60, plumbob: "strong" })}</span>
      <span class="info"><b>${esc(u.firstName)}</b><small class="faint">${esc(u.email)}${u.verified ? "" : " · not verified yet"}</small></span>
      <a class="btn btn-sm" href="/taste#you">Edit</a>
    </div>
    <section class="panel"><h3>${icon("location_city")}Where you are</h3>
      <p>${esc(u.city || "No city yet")}${u.stay?.label ? ` · staying at ${esc(u.stay.label)}` : ""}</p>
      <a class="btn btn-ghost" href="/taste#city">Change city or stay</a>
    </section>
    <section class="panel"><h3>${icon("favorite")}What you love</h3>
      <div class="facts">${(u.favourites || []).map((f) => `<span class="tag">${esc(f.name)}</span>`).join("")}</div>
      <a class="btn btn-ghost" href="/taste#taste">Change your taste</a>
    </section>
    <section class="panel"><h3>${icon("visibility")}Who can see you</h3>${visHtml(u.visibility, "vis2")}</section>
    <section class="panel"><h3>${icon("share")}Share my night</h3>
      <p class="muted" style="font-size:13px">Send a trusted friend where you are and since when. You send it yourself; Outside sends nothing.</p>
      <button class="btn btn-mint" type="button" data-act="share">${icon("ios_share")}Share my night</button>
    </section>
    ${u.role === "organiser" ? `<a class="btn btn-ghost" href="/venue">${icon("storefront")}Your venue dashboard</a>` : `<a class="btn btn-ghost" href="/venue">${icon("storefront")}Run a venue? See your crowd</a>`}
    <button class="btn btn-danger" type="button" data-act="out">${icon("logout")}Sign out</button>
  </div>` });
  onSheetClose(() => ctx.clearHash());
  body.onchange = (e) => { if (e.target.name === "vis2") saveVis(ctx, e.target.value); };
  body.onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "out") signOut();
    if (act === "share") {
      try {
        const { text } = await api("/api/share-night");
        if (navigator.share) await navigator.share({ text }).catch(() => {});
        else { await navigator.clipboard.writeText(text); toast("Copied. Paste it to a friend."); }
      } catch (err) { toast(err.message, { error: true }); }
    }
  };
}
