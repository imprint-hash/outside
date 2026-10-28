// Ported from React Bits (https://reactbits.dev) by David Haz. Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0 — see THIRD_PARTY_NOTICES.md.
//
// RotatingText: words that swap in place, letter by letter. The React
// component animates with motion; this vanilla port redoes its "slide"
// effect (staggered characters, wait-then-enter, smooth width) with CSS
// transitions. Screen readers get the current word only. Reduced motion
// keeps the first word still.
//
//   const r = rotatingText(el, { texts: ["London", "Lagos"] });
//   r.stop("London");   // stop rotating and settle on one word

const SPLIT = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const chars = (text) => (SPLIT ? Array.from(SPLIT.segment(text), (s) => s.segment) : Array.from(text));

// Close to motion's spring(damping 25, stiffness 300).
const ENTER = "cubic-bezier(0.22, 1.25, 0.36, 1)";
const ENTER_MS = 520;
const EXIT_MS = 260;

let styled = false;
const injectStyle = () => {
  if (styled) return;
  styled = true;
  const css = document.createElement("style");
  css.textContent = `
.text-rotate{display:inline-flex;position:relative;overflow:hidden;vertical-align:bottom;white-space:pre;padding:0 .04em .12em;margin:0 -.04em -.12em;transition:width ${ENTER_MS}ms ${ENTER}}
.text-rotate-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.text-rotate-word{display:inline-flex;white-space:pre}
.text-rotate-element{display:inline-block;will-change:transform,opacity}`;
  document.head.append(css);
};

/**
 * Rotate `el`'s text through `texts`. Returns { stop(finalText?) }.
 * Never throws: on any error the element keeps plain text.
 */
export function rotatingText(el, options = {}) {
  try {
    return start(el, options);
  } catch {
    return { stop(final) { if (el && final) el.textContent = final; } };
  }
}

function start(el, { texts = [], rotationInterval = 2000, staggerDuration = 0.025, staggerFrom = "last", loop = true } = {}) {
  if (!el || !texts.length) return { stop() {} };
  let reduced = false;
  try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  injectStyle();

  el.textContent = "";
  el.classList.add("text-rotate");
  const sr = document.createElement("span");
  sr.className = "text-rotate-sr-only";
  el.append(sr);

  let index = 0;
  let current = null;
  let timer = 0;
  let stopped = false;

  const delayFor = (i, total) => {
    if (staggerFrom === "first") return i * staggerDuration;
    if (staggerFrom === "last") return (total - 1 - i) * staggerDuration;
    if (staggerFrom === "center") return Math.abs(Math.floor(total / 2) - i) * staggerDuration;
    return Math.abs(staggerFrom - i) * staggerDuration;
  };

  const build = (text) => {
    const word = document.createElement("span");
    word.className = "text-rotate-word";
    word.setAttribute("aria-hidden", "true");
    const list = chars(text);
    list.forEach((ch, i) => {
      const s = document.createElement("span");
      s.className = "text-rotate-element";
      s.textContent = ch;
      s.dataset.delay = String(delayFor(i, list.length));
      word.append(s);
    });
    return word;
  };

  const show = (text, { animate }) => {
    sr.textContent = text;
    const old = current;
    const next = build(text);
    current = next;
    const enter = () => {
      if (current !== next) return;
      old?.remove();
      if (!animate || reduced) {
        el.append(next);
        el.style.width = "";
        return;
      }
      for (const c of next.children) {
        c.style.transform = "translateY(100%)";
        c.style.opacity = "0";
      }
      el.append(next);
      // Ease the width to the new word so the line around it doesn't jump.
      const pad = getComputedStyle(el);
      el.style.width = `${next.offsetWidth + parseFloat(pad.paddingLeft) + parseFloat(pad.paddingRight)}px`;
      next.getBoundingClientRect(); // commit the start state
      for (const c of next.children) {
        c.style.transition = `transform ${ENTER_MS}ms ${ENTER} ${c.dataset.delay}s, opacity ${ENTER_MS * 0.6}ms ease ${c.dataset.delay}s`;
        c.style.transform = "translateY(0)";
        c.style.opacity = "1";
      }
    };
    if (old && animate && !reduced) {
      // Wait mode: the old word leaves first, then the new one comes in.
      if (!el.style.width) el.style.width = `${el.getBoundingClientRect().width}px`;
      let longest = 0;
      for (const c of old.children) {
        const d = Number(c.dataset.delay) || 0;
        longest = Math.max(longest, d);
        c.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.5, 0, 0.75, 0) ${d}s, opacity ${EXIT_MS}ms ease ${d}s`;
        c.style.transform = "translateY(-120%)";
        c.style.opacity = "0";
      }
      setTimeout(enter, EXIT_MS + longest * 1000);
    } else enter();
  };

  const tick = () => {
    if (stopped) return;
    const last = texts.length - 1;
    const nextIndex = index < last ? index + 1 : loop ? 0 : index;
    if (nextIndex !== index) {
      index = nextIndex;
      show(texts[index], { animate: true });
    }
    timer = setTimeout(tick, rotationInterval);
  };

  show(texts[0], { animate: false });
  // Reduced motion: hold the first word; no rotation at all.
  if (!reduced) timer = setTimeout(tick, rotationInterval);

  return {
    stop(finalText) {
      stopped = true;
      clearTimeout(timer);
      if (finalText != null && finalText !== sr.textContent) show(finalText, { animate: true });
    },
  };
}
