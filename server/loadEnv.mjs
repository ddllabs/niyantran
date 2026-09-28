/**
 * Load repo-root / app .env into process.env (server plugins only).
 * Never expose these values to the browser bundle.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let loaded = false;

export function loadEnv(force = false) {
  if (loaded && !force) return;
  loaded = true;
  for (const file of ['.env.local', '.env', 'backend/.env']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && (force || process.env[key] == null)) {
        process.env[key] = val;
      }
    }
  }
}
