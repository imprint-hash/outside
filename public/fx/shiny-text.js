// Ported from React Bits (https://reactbits.dev) by David Haz. Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0 — see THIRD_PARTY_NOTICES.md.
//
// ShinyText: a soft band of light that sweeps across text, painted as a
// background-clip:text gradient. Vanilla port of the React component's loop
// mode. One change for Outside: if the text already has a gradient fill (our
// "your people" strands), the shine is layered over that gradient instead of
// a flat colour. Reduced motion: no sweep. Stops when the element is gone.
//
//   shinyText(el, { shineColor: "#fff", speed: 3, delay: 3 });

const EASINGS = {
  linear: (t) => t,
  smooth: (t) => 0.5 - Math.cos(Math.PI * t) / 2,
  snappy: (t) => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2),
};
const FALLOFF = [0, 0.2, 0.4, 0.6, 0.8, 1];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let paint = null;
const parseColor = (value) => {
  if (!paint) paint = document.createElement("canvas").getContext("2d");
  if (!paint) return null;
  paint.fillStyle = "#000000";
  paint.fillStyle = value;
  const resolved = String(paint.fillStyle);
  if (resolved.startsWith("#")) return [1, 3, 5].map((i) => parseInt(resolved.slice(i, i + 2), 16)).concat(1);
  const parts = resolved.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts.length > 3 ? Number(parts[3]) : 1];
};

const blend = (from, to, amount) => {
  const channel = (a, b) => Math.round(Math.pow(Math.pow(a / 255, 2.2) * (1 - amount) + Math.pow(b / 255, 2.2) * amount, 1 / 2.2) * 255);
  const alpha = from[3] * (1 - amount) + to[3] * amount;
  if (alpha <= 0) return "rgba(0, 0, 0, 0)";
  const weigh = (a, b) => (a * from[3] * (1 - amount) + b * to[3] * amount) / alpha;
  const r = from[3] === to[3] ? channel(from[0], to[0]) : Math.round(weigh(from[0], to[0]));
  const g = from[3] === to[3] ? channel(from[1], to[1]) : Math.round(weigh(from[1], to[1]));
  const b = from[3] === to[3] ? channel(from[2], to[2]) : Math.round(weigh(from[2], to[2]));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
};

let styled = false;
const injectStyle = () => {
  if (styled) return;
  styled = true;
  const css = document.createElement("style");
  css.textContent = ".shiny-text{background-repeat:no-repeat;background-size:100% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}";
  document.head.append(css);
};

/**
 * Sweep a shine across `el`. `color` is the resting text colour (defaults to
 * the element's current colour); a gradient fill already on the element is
 * kept underneath. Returns a stop function. Never throws.
 */
export function shinyText(el, options = {}) {
  try {
    return start(el, options);
  } catch {
    return () => {};
  }
}

function start(el, { color, shineColor = "#ffffff", speed = 2, delay = 0, angle = 120, shineWidth = 40, softness = 0.8, bands = 1, direction = "left", easing = "smooth", yoyo = false } = {}) {
  if (!el) return () => {};
  const cs = getComputedStyle(el);
  const under = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : null;
  const fillColor = color || cs.color;
  injectStyle();
  el.classList.add("shiny-text");

  const s = {
    speed: Math.max(0.1, speed),
    delay: Math.max(0, delay),
    angle,
    shineWidth: clamp(shineWidth, 2, 200),
    softness: clamp(softness, 0, 1),
    bands: clamp(Math.round(bands), 1, 3),
    sign: direction === "right" ? 1 : -1,
    ease: EASINGS[easing] ?? EASINGS.smooth,
    yoyo,
  };
  const shine = parseColor(shineColor);
  // Over a gradient the band fades from clear; over a flat colour, from that colour.
  const base = under ? (shine ? [shine[0], shine[1], shine[2], 0] : null) : parseColor(fillColor);
  const rest = under || `linear-gradient(${fillColor}, ${fillColor})`;

  const state = { pos: null, phase: "idle", from: 0, to: 0, start: 0, duration: 1, resume: 0, flip: false, visible: true };
  let raf = 0;
  let timer = 0;
  let alive = true;
  let reduce = false;
  try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}

  const extent = () => s.shineWidth / 2 + (s.bands - 1) * s.shineWidth * 1.3 + 2;
  const entry = () => (s.sign > 0 ? -extent() : 100 + extent());
  const exit = () => (s.sign > 0 ? 100 + extent() : -extent());

  const gradient = (pos, fill) => {
    const half = s.shineWidth / 2;
    const core = half * (1 - s.softness);
    const fade = half - core;
    const stops = [];
    for (let band = 0; band < s.bands; band++) {
      const center = pos - s.sign * band * s.shineWidth * 1.3;
      const strength = 1 - band * 0.28;
      for (const side of [-1, 1]) {
        for (const f of FALLOFF) stops.push([center + side * (core + fade * (1 - f)), f * f * (3 - 2 * f) * strength]);
      }
    }
    stops.sort((a, b) => a[0] - b[0]);
    const list = stops.map(([at, amount]) => `${blend(fill, shine, amount)} ${at.toFixed(2)}%`);
    return `linear-gradient(${s.angle}deg, ${blend(fill, shine, 0)} 0%, ${list.join(", ")}, ${blend(fill, shine, 0)} 100%)`;
  };

  const draw = () => {
    if (!base || !shine || state.pos === null) { el.style.backgroundImage = rest; return; }
    const band = gradient(state.pos, base);
    el.style.backgroundImage = under ? `${band}, ${under}` : band;
  };

  const sweep = (from, to, now) => {
    const span = Math.abs(exit() - entry()) || 1;
    state.phase = "sweep";
    state.from = from;
    state.to = to;
    state.start = now;
    state.duration = s.speed * 1000 * Math.max(0.15, Math.abs(to - from) / span);
  };

  const wake = () => {
    if (raf || !alive || reduce) return;
    clearTimeout(timer);
    timer = 0;
    raf = requestAnimationFrame(tick);
  };

  const tick = (now) => {
    raf = 0;
    if (!alive) return;
    if (!el.isConnected) return stop();
    if (state.phase === "sweep") {
      const t = clamp((now - state.start) / state.duration, 0, 1);
      state.pos = state.from + (state.to - state.from) * s.ease(t);
      draw();
      if (t < 1) { raf = requestAnimationFrame(tick); return; }
      state.phase = "wait";
      state.resume = now + s.delay * 1000;
    }
    if (state.phase === "wait") {
      if (!state.visible) return;
      if (now < state.resume) { clearTimeout(timer); timer = setTimeout(wake, state.resume - now); return; }
      if (s.yoyo) {
        state.flip = !state.flip;
        sweep(state.flip ? exit() : entry(), state.flip ? entry() : exit(), now);
      } else sweep(entry(), exit(), now);
      raf = requestAnimationFrame(tick);
      return;
    }
    if (state.phase === "idle" && state.visible) {
      sweep(entry(), exit(), now);
      raf = requestAnimationFrame(tick);
    }
  };

  const observer = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
      if (!el.isConnected) return stop();
      state.visible = entries.some((e) => e.isIntersecting);
      if (state.visible) wake();
    })
    : null;
  observer?.observe(el);

  function stop() {
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    observer?.disconnect();
  }

  draw();
  wake();
  return stop;
}
