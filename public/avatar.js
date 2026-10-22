// Draws an avatar as SVG from a handful of choices, plus the plumbob that
// floats over it. Only listed options are ever drawn (the server checks the
// same lists), so a stored avatar can't carry anything but a drawing.

const HAIR_BACK = {
  afro: (c) => `<circle cx="50" cy="34" r="25" fill="${c}"/><circle cx="31" cy="42" r="12" fill="${c}"/><circle cx="69" cy="42" r="12" fill="${c}"/>`,
  braids: (c) => `<path d="M30 40 Q30 16 50 16 Q70 16 70 40 L72 78 Q66 82 63 78 L64 44 L36 44 L37 78 Q34 82 28 78Z" fill="${c}"/>${[34, 40, 60, 66].map((x) => `<path d="M${x} 50 v26" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>`).join("")}`,
  locs: (c) => `<path d="M29 42 Q29 15 50 15 Q71 15 71 42Z" fill="${c}"/>${[30, 36, 42, 58, 64, 70].map((x, i) => `<rect x="${x - 3}" y="38" width="6" height="${30 + (i % 2) * 8}" rx="3" fill="${c}"/>`).join("")}`,
  long: (c) => `<path d="M29 42 Q29 15 50 15 Q71 15 71 42 L73 74 Q50 82 27 74Z" fill="${c}"/>`,
  bun: (c) => `<circle cx="50" cy="14" r="9" fill="${c}"/>`,
  short: () => "", lowcut: () => "", bald: () => "",
};
const HAIR_FRONT = {
  afro: (c) => `<path d="M31 40 Q33 22 50 22 Q67 22 69 40 Q60 30 50 31 Q40 30 31 40Z" fill="${c}"/>`,
  braids: (c) => `<path d="M31 41 Q33 23 50 23 Q67 23 69 41 Q58 31 50 32 Q42 31 31 41Z" fill="${c}"/>`,
  locs: (c) => `<path d="M31 41 Q33 23 50 23 Q67 23 69 41 Q58 30 50 31 Q42 30 31 41Z" fill="${c}"/>`,
  long: (c) => `<path d="M31 42 Q32 23 50 23 Q68 23 69 42 Q60 30 50 30 Q40 30 31 42Z" fill="${c}"/>`,
  bun: (c) => `<path d="M31 41 Q33 23 50 23 Q67 23 69 41 Q58 31 50 32 Q42 31 31 41Z" fill="${c}"/>`,
  short: (c) => `<path d="M31 40 Q32 22 50 22 Q68 22 69 40 Q61 31 50 31 Q39 31 31 40Z" fill="${c}"/>`,
  lowcut: (c) => `<path d="M32 38 Q34 24 50 24 Q66 24 68 38 Q60 32 50 32 Q40 32 32 38Z" fill="${c}" opacity=".85"/>`,
  bald: () => "",
};

/** Plumbob colours: strong match, okay match, and "they said yes". */
export const PLUMBOB = { strong: "#2ee66b", okay: "#ffd23f", yes: "#ff5e4d" };

/**
 * An avatar as an SVG string. `plumbob`: null, or a key of PLUMBOB, drawn
 * spinning above the head. `size` in px.
 */
export function avatarSVG(a, { plumbob = null, size = 96, label = "" } = {}) {
  const skin = a?.skin || "#8d5524";
  const hair = HAIR_BACK[a?.hair] ? a.hair : "afro";
  const hc = a?.hairColour || "#1a1110";
  const outfit = a?.outfit || "#ff5e4d";
  const ex = new Set(a?.extras || []);
  const shade = "rgba(0,0,0,.18)";
  const gem = plumbob && PLUMBOB[plumbob]
    ? `<g class="plumbob"><path d="M50 -22 L58 -8 L50 6 L42 -8Z" fill="${PLUMBOB[plumbob]}"/><path d="M50 -22 L58 -8 L50 -8Z" fill="rgba(255,255,255,.45)"/><path d="M42 -8 L50 6 L50 -8Z" fill="rgba(0,0,0,.18)"/></g>`
    : "";
  return `<svg class="avatar" width="${size}" height="${size * (plumbob ? 1.3 : 1)}" viewBox="0 ${plumbob ? -26 : 0} 100 ${plumbob ? 126 : 100}" role="img" aria-label="${label ? `${label}'s avatar` : "Avatar"}">
  ${gem}
  <circle cx="50" cy="50" r="48" fill="#1b2230"/>
  <clipPath id="clip-${size}"><circle cx="50" cy="50" r="48"/></clipPath>
  <g clip-path="url(#clip-${size})">
    ${HAIR_BACK[hair](hc)}
    <path d="M18 104 Q18 74 50 72 Q82 74 82 104Z" fill="${outfit}"/>
    <path d="M42 72 Q50 80 58 72" stroke="${shade}" stroke-width="3" fill="none"/>
    <rect x="43" y="58" width="14" height="15" rx="6" fill="${skin}"/>
    <ellipse cx="50" cy="46" rx="19" ry="21" fill="${skin}"/>
    <ellipse cx="31.5" cy="48" rx="3.5" ry="5" fill="${skin}"/><ellipse cx="68.5" cy="48" rx="3.5" ry="5" fill="${skin}"/>
    ${ex.has("earrings") ? `<circle cx="31.5" cy="55" r="2.4" fill="#f3c68f"/><circle cx="68.5" cy="55" r="2.4" fill="#f3c68f"/>` : ""}
    ${HAIR_FRONT[hair](hc)}
    ${ex.has("beard") ? `<path d="M33 50 Q34 70 50 70 Q66 70 67 50 Q62 60 50 61 Q38 60 33 50Z" fill="${hc}" opacity=".9"/>` : ""}
    <ellipse cx="43" cy="47" rx="2.4" ry="2.8" fill="#15100d"/><ellipse cx="57" cy="47" rx="2.4" ry="2.8" fill="#15100d"/>
    <path d="M39 41 q4 -2.5 8 0 M53 41 q4 -2.5 8 0" stroke="${hc}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M44 56 Q50 61 56 56" stroke="#3a1f17" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${ex.has("glasses") ? `<g fill="none" stroke="#111" stroke-width="2"><rect x="36.5" y="42" width="12" height="10" rx="4"/><rect x="51.5" y="42" width="12" height="10" rx="4"/><path d="M48.5 46 h3"/></g>` : ""}
    ${ex.has("cap") ? `<path d="M30 36 Q31 19 50 19 Q69 19 70 36Z" fill="${outfit}"/><path d="M48 34 Q66 32 80 38 Q66 40 48 38Z" fill="${outfit}" opacity=".85"/>` : ""}
  </g>
</svg>`;
}
