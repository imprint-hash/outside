// Run the Lagos events search once by hand: `node bin/find-events.mjs`
import { refreshLagosEvents } from "../src/city-events.js";

const r = await refreshLagosEvents();
console.log(`Found ${r.kept} events today; ${r.expired} past ones removed; ${r.total} upcoming in total.`);
for (const d of r.dropped) console.log(`  dropped "${d.title}": ${d.why}`);
