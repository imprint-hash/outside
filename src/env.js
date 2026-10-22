/**
 * Reads .env into process.env for local runs. On a host, the variables are
 * already set and this does nothing. Values already in the environment win.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../.env", import.meta.url));

try {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // No .env file: the host provides the variables.
}
