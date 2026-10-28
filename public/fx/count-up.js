// Ported from React Bits (https://reactbits.dev) by David Haz. Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0 — see THIRD_PARTY_NOTICES.md.
//
// CountUp: a number that counts from `from` to `to` once it scrolls into
// view. Vanilla port of the React component's "count" mode (motion's
// animate() replaced by requestAnimationFrame). Reduced motion shows the
// final number straight away.
//
//   countUp(el, { to: 42, suffix: " ★", decimals: 1 });

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// cubic-bezier(0.33, 1, 0.68, 1), solved for x by Newton steps.
const cubicBezier = (x1, y1, x2, y2) => {
  const a = (a1, a2) => 1 - 3 * a2 + 3 * a1;
  const b = (a1, a2) => 3 * a2 - 6 * a1;
  const c = (a1) => 3 * a1;
  const at = (t, a1, a2) => ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t;
  const slope = (t, a1, a2) => 3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / s;
    }
    return at(clamp01(t), y1, y2);
  };
};

const EASINGS = {
  linear: (t) => t,
  easeOut: cubicBezier(0.33, 1, 0.68, 1),
  expo: (t) => (t >= 1 ? 1 : (1 - Math.pow(2, -10 * t)) / (1 - Math.pow(2, -10))),
};

const getDecimalPlaces = (num) => {
  const str = num.toString();
  if (str.includes(".")) {
    const decimals = str.split(".")[1];
    if (parseInt(decimals) !== 0) return decimals.length;
  }
  return 0;
};

const group = (int, separator) => (separator ? int.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : int);

/**
 * Count `el`'s text up to `to` the first time it is on screen.
 * Returns a stop function. Never throws; on any error the final text stays.
 */
export function countUp(el, { to, from = 0, duration = 2, delay = 0, separator = "", prefix = "", suffix = "", decimals, easing = "easeOut" } = {}) {
  if (!el || typeof to !== "number" || !isFinite(to)) return () => {};
  const places = decimals ?? Math.max(getDecimalPlaces(from), getDecimalPlaces(to));
  const format = (v) => {
    const fixed = Math.abs(v).toFixed(places);
    const [int, frac = ""] = fixed.split(".");
    const negative = v < 0 && Number(fixed) !== 0;
    return `${prefix}${negative ? "-" : ""}${group(int, separator)}${frac ? `.${frac}` : ""}${suffix}`;
  };
  const finalText = format(to);
  let raf = 0;
  let timer = 0;
  let io = null;
  const stop = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    io?.disconnect();
  };
  try {
    let reduced = false;
    try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
    if (reduced || typeof IntersectionObserver === "undefined") { el.textContent = finalText; return stop; }
    const ease = EASINGS[easing] || EASINGS.easeOut;
    el.style.fontVariantNumeric = "tabular-nums";
    el.textContent = format(from);
    const run = () => {
      const start = performance.now();
      const tick = (now) => {
        if (!el.isConnected) return;
        const p = duration > 0 ? clamp01((now - start) / (duration * 1000)) : 1;
        el.textContent = format(from + (to - from) * ease(p));
        if (p < 1) raf = requestAnimationFrame(tick);
        else el.textContent = finalText;
      };
      raf = requestAnimationFrame(tick);
    };
    io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      timer = setTimeout(run, delay * 1000);
    });
    io.observe(el);
  } catch {
    el.textContent = finalText;
  }
  return stop;
}
