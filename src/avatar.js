/**
 * Avatars: what people see instead of a photo. Every option comes from a
 * fixed list, so a stored avatar can only ever describe a drawing, never
 * carry text or a link. The same lists drive the avatar maker in the app.
 */

export const AVATAR_OPTIONS = {
  skin: ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3317", "#3b2219"],
  hair: ["afro", "braids", "locs", "bun", "short", "lowcut", "long", "bald"],
  hairColour: ["#1a1110", "#3b2414", "#6b4423", "#a8742f", "#d9b26f", "#8a8a8a", "#c0392b"],
  outfit: ["#ff5e4d", "#00d285", "#f3c68f", "#6b7cff", "#f8fafc", "#1b2230", "#e84393"],
  extras: ["glasses", "beard", "cap", "earrings"],
};

export const DEFAULT_AVATAR = { skin: "#8d5524", hair: "afro", hairColour: "#1a1110", outfit: "#ff5e4d", extras: [] };

export class AvatarError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Check an avatar against the lists. Anything not on a list is refused. */
export function cleanAvatar(input) {
  const a = input && typeof input === "object" ? input : {};
  const pick = (key) => {
    const v = a[key] ?? DEFAULT_AVATAR[key];
    if (!AVATAR_OPTIONS[key].includes(v)) throw new AvatarError(`That ${key === "hairColour" ? "hair colour" : key} isn't one of the options.`);
    return v;
  };
  const extras = Array.isArray(a.extras) ? [...new Set(a.extras)] : [];
  const bad = extras.filter((x) => !AVATAR_OPTIONS.extras.includes(x));
  if (bad.length) throw new AvatarError(`Unknown extra: ${bad.join(", ")}.`);
  return { skin: pick("skin"), hair: pick("hair"), hairColour: pick("hairColour"), outfit: pick("outfit"), extras: extras.sort() };
}
