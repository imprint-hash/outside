/**
 * Ride links for a place or event: Uber with pickup and drop-off filled in
 * (you still confirm in the app), Bolt where it runs, and Google Maps
 * directions as the always-there fallback. Pure: no network, no keys.
 */

/** Countries where Uber doesn't run (ISO-2). */
export const UBER_NOT = ["MA", "TH", "SG"];
/** Countries where Bolt runs and we offer it (ISO-2). */
export const BOLT_CC = ["NG", "GH", "KE", "ZA", "GB", "FR", "DE", "NL", "PT", "ES"];

const num = (x) => Number.isFinite(Number(x));
const hasPoint = (p) => !!p && num(p.lat) && num(p.lon) && p.lat !== null && p.lon !== null;

/**
 * rideLinks({ from, to, toName, cc }) → { uber, bolt, maps }
 * `from` and `to` are { lat, lon }; `from` may be missing (Uber then uses your
 * current location). `cc` is the city's ISO-2 country code.
 */
export function rideLinks({ from = null, to, toName = "", cc = "" } = {}) {
  if (!hasPoint(to)) throw new Error("rideLinks needs a destination with lat and lon");
  const country = String(cc || "").toUpperCase();
  const dest = `${Number(to.lat)},${Number(to.lon)}`;

  let uber = null;
  if (!UBER_NOT.includes(country)) {
    const pickup = hasPoint(from)
      ? `pickup[latitude]=${Number(from.lat)}&pickup[longitude]=${Number(from.lon)}`
      : "pickup=my_location";
    uber = `https://m.uber.com/ul/?action=setPickup&${pickup}`
      + `&dropoff[latitude]=${Number(to.lat)}&dropoff[longitude]=${Number(to.lon)}`
      + `&dropoff[nickname]=${encodeURIComponent(toName || "")}`;
  }

  const bolt = BOLT_CC.includes(country) ? "https://bolt.eu/" : null;

  let maps = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  if (hasPoint(from)) maps += `&origin=${Number(from.lat)},${Number(from.lon)}`;

  return { uber, bolt, maps };
}
