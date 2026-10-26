// Ride links: Uber pre-filled, Bolt only where it runs, Maps always.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rideLinks } from "../src/rides.js";

const ronnie = { lat: 51.5133, lon: -0.1318 };
const hotel = { lat: 51.5246, lon: -0.0784 };

test("Uber link carries pickup, drop-off and an encoded name", () => {
  const r = rideLinks({ from: hotel, to: ronnie, toName: "Ronnie Scott's & Bar", cc: "GB" });
  assert.equal(r.uber,
    "https://m.uber.com/ul/?action=setPickup&pickup[latitude]=51.5246&pickup[longitude]=-0.0784"
    + "&dropoff[latitude]=51.5133&dropoff[longitude]=-0.1318&dropoff[nickname]=Ronnie%20Scott's%20%26%20Bar");
  assert.equal(r.maps, "https://www.google.com/maps/dir/?api=1&destination=51.5133,-0.1318&origin=51.5246,-0.0784");
});

test("no origin uses my_location and Maps has no origin", () => {
  const r = rideLinks({ to: ronnie, toName: "X", cc: "GB" });
  assert.match(r.uber, /action=setPickup&pickup=my_location&dropoff\[latitude\]=51\.5133/);
  assert.equal(r.maps, "https://www.google.com/maps/dir/?api=1&destination=51.5133,-0.1318");
});

test("Bolt only in its countries", () => {
  for (const cc of ["NG", "GH", "KE", "ZA", "GB", "FR", "DE", "NL", "PT", "ES"]) {
    assert.equal(rideLinks({ to: ronnie, cc }).bolt, "https://bolt.eu/", cc);
  }
  for (const cc of ["US", "JP", "AE", "TH", ""]) assert.equal(rideLinks({ to: ronnie, cc }).bolt, null, cc);
});

test("Uber is null in MA, TH and SG; Maps is always there", () => {
  for (const cc of ["MA", "TH", "SG", "th"]) {
    const r = rideLinks({ to: ronnie, cc });
    assert.equal(r.uber, null, cc);
    assert.ok(r.maps.startsWith("https://www.google.com/maps/dir/"));
  }
  assert.ok(rideLinks({ to: ronnie, cc: "US" }).uber);
});
