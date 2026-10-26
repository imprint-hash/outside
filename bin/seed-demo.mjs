#!/usr/bin/env node
/**
 * Demo data for the video: labelled demo people checked in around a city.
 *
 *   node bin/seed-demo.mjs [--city London]   create or refresh (prints the match matrix)
 *   node bin/seed-demo.mjs --renew           check every demo person back in for tonight
 *   node bin/seed-demo.mjs --remove          delete every demo record
 *
 * Talks to live Qloo and to whichever store .env points at (Supabase when set).
 */

import { seedDemo, renewDemoCheckins, removeDemo, formatMatrix } from "../src/demo.js";
import { storeName } from "../src/store.js";
import { LIKE_YOU } from "../src/crowd.js";
import { STRONG_MATCH } from "../src/people.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

try {
  console.log(`Store: ${storeName}`);
  if (flag("remove")) {
    console.log("Removed:", await removeDemo());
  } else if (flag("renew")) {
    console.log(`Renewed ${await renewDemoCheckins()} demo check-ins.`);
  } else {
    const r = await seedDemo({ cityName: value("city", "London") });
    console.log(`City: ${r.city}`);
    console.log(`Demo password: ${r.password}`);
    console.log(`Users: ${r.users} (+${r.organisers} demo venue account), check-ins: ${r.checkins}, reviews: ${r.reviews}`);
    console.log("Venues:");
    for (const [name, id] of Object.entries(r.venues)) console.log(`  ${name.padEnd(20)} ${id}`);
    if (Object.keys(r.missing).length) console.log("Favourites Qloo couldn't find:", r.missing);
    console.log("\nMatch matrix (likeness, 0-100):");
    console.log(formatMatrix(r.matrix));
    const pairs = [];
    r.matrix.rows.forEach((row, i) => row.forEach((m, j) => { if (j > i && m != null) pairs.push(m); }));
    pairs.sort((a, b) => a - b);
    const q = (p) => pairs[Math.min(pairs.length - 1, Math.floor(p * pairs.length))];
    console.log(`\nPairs: ${pairs.length}; min ${pairs[0]}, 25% ${q(0.25)}, median ${q(0.5)}, 75% ${q(0.75)}, max ${pairs.at(-1)}`);
    console.log(`At or above LIKE_YOU (${LIKE_YOU}): ${pairs.filter((m) => m >= LIKE_YOU).length}; at or above STRONG_MATCH (${STRONG_MATCH}): ${pairs.filter((m) => m >= STRONG_MATCH).length}`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
