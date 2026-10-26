// Run one city's events search by hand: `node bin/find-events.mjs [City]` (default London).
import { searchAndMark } from "../src/city-events.js";

const city = process.argv.slice(2).join(" ").trim() || "London";
const r = await searchAndMark(city);
console.log(`${r.city}: found ${r.kept} events today; ${r.dropped.length} dropped; ${r.expired} past ones removed; ${r.total} upcoming in total.`);
for (const d of r.dropped) console.log(`  dropped "${d.title}": ${d.why}`);
