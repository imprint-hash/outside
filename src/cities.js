/**
 * The cities Outside knows: a name Qloo can search by, a time zone (so "open
 * now" and "tonight" mean the local evening), and a centre for when a venue
 * can only be placed roughly. Any city Qloo covers works for picks; this list
 * is what the city picker offers and what GPS snaps to.
 */

/** ISO 3166-1 alpha-2 codes, for web search locations and ride links. */
const COUNTRY_CODES = {
  "Nigeria": "NG",
  "Ghana": "GH",
  "Kenya": "KE",
  "South Africa": "ZA",
  "Egypt": "EG",
  "Morocco": "MA",
  "United Kingdom": "GB",
  "France": "FR",
  "Germany": "DE",
  "Netherlands": "NL",
  "Portugal": "PT",
  "Spain": "ES",
  "Italy": "IT",
  "Türkiye": "TR",
  "United Arab Emirates": "AE",
  "India": "IN",
  "Thailand": "TH",
  "Singapore": "SG",
  "Japan": "JP",
  "South Korea": "KR",
  "Australia": "AU",
  "United States": "US",
  "Canada": "CA",
  "Mexico": "MX",
  "Brazil": "BR",
};

/** "New York" → "new-york", "São Paulo" → "sao-paulo". */
const slugOf = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const CITIES = [
  ["Lagos", "Nigeria", "Africa/Lagos", 6.4281, 3.4219],
  ["Abuja", "Nigeria", "Africa/Lagos", 9.0765, 7.3986],
  ["Accra", "Ghana", "Africa/Accra", 5.6037, -0.187],
  ["Nairobi", "Kenya", "Africa/Nairobi", -1.2864, 36.8172],
  ["Johannesburg", "South Africa", "Africa/Johannesburg", -26.2041, 28.0473],
  ["Cape Town", "South Africa", "Africa/Johannesburg", -33.9249, 18.4241],
  ["Cairo", "Egypt", "Africa/Cairo", 30.0444, 31.2357],
  ["Marrakech", "Morocco", "Africa/Casablanca", 31.6295, -7.9811],
  ["London", "United Kingdom", "Europe/London", 51.5072, -0.1276],
  ["Manchester", "United Kingdom", "Europe/London", 53.4808, -2.2426],
  ["Paris", "France", "Europe/Paris", 48.8566, 2.3522],
  ["Berlin", "Germany", "Europe/Berlin", 52.52, 13.405],
  ["Amsterdam", "Netherlands", "Europe/Amsterdam", 52.3676, 4.9041],
  ["Lisbon", "Portugal", "Europe/Lisbon", 38.7223, -9.1393],
  ["Madrid", "Spain", "Europe/Madrid", 40.4168, -3.7038],
  ["Barcelona", "Spain", "Europe/Madrid", 41.3874, 2.1686],
  ["Rome", "Italy", "Europe/Rome", 41.9028, 12.4964],
  ["Milan", "Italy", "Europe/Rome", 45.4642, 9.19],
  ["Istanbul", "Türkiye", "Europe/Istanbul", 41.0082, 28.9784],
  ["Dubai", "United Arab Emirates", "Asia/Dubai", 25.2048, 55.2708],
  ["Mumbai", "India", "Asia/Kolkata", 19.076, 72.8777],
  ["Bangkok", "Thailand", "Asia/Bangkok", 13.7563, 100.5018],
  ["Singapore", "Singapore", "Asia/Singapore", 1.3521, 103.8198],
  ["Tokyo", "Japan", "Asia/Tokyo", 35.6762, 139.6503],
  ["Seoul", "South Korea", "Asia/Seoul", 37.5665, 126.978],
  ["Sydney", "Australia", "Australia/Sydney", -33.8688, 151.2093],
  ["New York", "United States", "America/New_York", 40.7128, -74.006],
  ["Atlanta", "United States", "America/New_York", 33.749, -84.388],
  ["Miami", "United States", "America/New_York", 25.7617, -80.1918],
  ["Houston", "United States", "America/Chicago", 29.7604, -95.3698],
  ["Chicago", "United States", "America/Chicago", 41.8781, -87.6298],
  ["Los Angeles", "United States", "America/Los_Angeles", 34.0522, -118.2437],
  ["Toronto", "Canada", "America/Toronto", 43.6532, -79.3832],
  ["Mexico City", "Mexico", "America/Mexico_City", 19.4326, -99.1332],
  ["São Paulo", "Brazil", "America/Sao_Paulo", -23.5558, -46.6396],
  ["Rio de Janeiro", "Brazil", "America/Sao_Paulo", -22.9068, -43.1729],
].map(([name, country, tz, lat, lon]) => ({ name, country, cc: COUNTRY_CODES[country], slug: slugOf(name), tz, lat, lon }));

export const DEFAULT_CITY = "Lagos";

const byName = new Map(CITIES.map((c) => [c.name.toLowerCase(), c]));

/** A known city by name (any case), or null. */
export function cityNamed(name) {
  return byName.get(String(name || "").trim().toLowerCase()) || null;
}

/** The nearest known city to a point, if within 80 km. */
export function cityNear({ lat, lon }) {
  let best = null, bestD = Infinity;
  for (const c of CITIES) {
    const d = Math.hypot(c.lat - lat, (c.lon - lon) * Math.cos((lat * Math.PI) / 180));
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD * 111 <= 80 ? best : null;
}

/** The city a user is in, falling back to the default. */
export const cityOf = (user) => cityNamed(user?.city) || cityNamed(DEFAULT_CITY);

/** What the client sees of a city. */
export const publicCity = (c) => ({ name: c.name, country: c.country, cc: c.cc, tz: c.tz, lat: c.lat, lon: c.lon });
