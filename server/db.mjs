/**
 * Local SQLite store (sql.js / WASM) for accounts + product analytics.
 * File: tmp/niyantran.sqlite — fine for single-node dev; swap to better-sqlite3 later if needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(APP_ROOT, 'tmp', 'niyantran.sqlite');

let SQL = null;
let db = null;

function ensureDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function persist() {
  if (!db) return;
  ensureDir();
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function migrate(database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'explorer',
      type TEXT NOT NULL DEFAULT 'analyst',
      active INTEGER NOT NULL DEFAULT 1,
      persona_id TEXT,
      plan_status TEXT DEFAULT 'free',
      trial_ends_at TEXT,
      billing_yearly INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
  `);
  // Additive columns for older DBs.
  const cols = queryAll(database, `PRAGMA table_info(users)`).map((r) => r.name);
  const add = (name, ddl) => {
    if (!cols.includes(name)) database.run(`ALTER TABLE users ADD COLUMN ${ddl}`);
  };
  add('plan_status', 'plan_status TEXT DEFAULT \"free\"');
  add('trial_ends_at', 'trial_ends_at TEXT');
  add('billing_yearly', 'billing_yearly INTEGER DEFAULT 0');
  add('google_sub', 'google_sub TEXT');
  try {
    database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL`);
  } catch {
    /* sql.js may not support partial indexes — non-fatal */
  }
  database.run(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      props_json TEXT,
      session_id TEXT,
      user_email TEXT,
      created_at TEXT NOT NULL
    );
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_analytics_name ON analytics_events(name);`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);`);
  // A-15: per-user watchlist / AI chats / tours (JSON blobs, keyed by email).
  database.run(`
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_email TEXT PRIMARY KEY,
      watchlist_json TEXT,
      ai_chats_json TEXT,
      tours_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_no TEXT NOT NULL UNIQUE,
      user_email TEXT NOT NULL,
      user_id TEXT,
      plan_id TEXT NOT NULL,
      yearly INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      taxable REAL NOT NULL,
      cgst REAL NOT NULL DEFAULT 0,
      sgst REAL NOT NULL DEFAULT 0,
      igst REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      tax_split TEXT,
      usd_list REAL,
      usd_to_inr REAL,
      buyer_name TEXT,
      buyer_gstin TEXT,
      buyer_state_code TEXT,
      buyer_address TEXT,
      payment_id TEXT,
      order_id TEXT,
      provider TEXT,
      payload_json TEXT,
      issued_at TEXT NOT NULL
    );
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_invoices_email ON invoices(user_email);`);
}

export async function getDb() {
  if (db) return db;
  SQL = SQL || (await initSqlJs());
  ensureDir();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  migrate(db);
  persist();
  return db;
}

export function saveDb() {
  persist();
}

export function dbPath() {
  return DB_PATH;
}

export function queryAll(database, sql, params = []) {
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function run(database, sql, params = []) {
  database.run(sql, params);
  persist();
}
