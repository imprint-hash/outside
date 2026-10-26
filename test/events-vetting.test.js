// The Lagos events search is only as good as what it refuses. No web calls here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OUTSIDE_STORE = join(mkdtempSync(join(tmpdir(), "outside-vet-")), "store.json");
process.env.QLOO_BASE_URL = "http://127.0.0.1:9"; // venue lookups fail fast; areas are used instead
const { vetEvents } = await import("../src/city-events.js");

const now = new Date("2026-10-23T12:00:00+01:00");
const seen = new Set(["https://a.example/ok"]);
const ev = (o) => ({ title: "Show", kind: "concert", starts: "2026-12-20T20:00:00+01:00", venue_name: "Some Hall", area: "Lekki", lineup: ["Wizkid"], source_url: "https://a.example/ok", ...o });

test("keeps a complete event, placed by its area when Qloo doesn't know the venue", async () => {
  const { kept } = await vetEvents([ev({})], seen, now);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].status, "found");
  assert.equal(kept[0].venue.approximate, true);
  assert.ok(Math.abs(kept[0].venue.lat - 6.4478) < 0.01, "Lekki");
});

test("drops past, too-far, unnamed, undated and made-up-source events, saying why", async () => {
  const { kept, dropped } = await vetEvents([
    ev({ title: "Past", starts: "2026-10-01T20:00:00+01:00" }),
    ev({ title: "Far", starts: "2027-06-01T20:00:00+01:00" }),
    ev({ title: "Nobody", lineup: [] }),
    ev({ title: "Vague", starts: "sometime in December" }),
    ev({ title: "Invented", source_url: "https://invented.example/x" }),
    ev({ title: "" }),
  ], seen, now);
  assert.equal(kept.length, 0);
  assert.deepEqual(dropped.map((d) => d.why), ["already happened", "more than 120 days away", "no performers named", "no readable date", "source link not among the pages searched", "no title"]);
});

test("the same event found twice is kept once, first sighting wins", async () => {
  const { kept } = await vetEvents([ev({ area: "Lekki" }), ev({ area: "Victoria Island", starts: "2026-12-20T21:00:00+01:00" })], seen, now);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].venue.area, "Lekki");
});
