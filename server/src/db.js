// Persistence: embedded SQLite via Node's built-in node:sqlite.
// Schema creation below acts as the migration set; every entity table stores
// core columns + a JSON payload. An in-memory cache mirrors the DB and all
// mutations write through, so the engine always reads fast local state.
import { DatabaseSync } from 'node:sqlite';

const TABLES = ['vendors','outlets','airlines','locations','screens','flights','campaigns',
  'creatives','promos','incidents','triggers','messages','goodwill_rules','goodwill_fired',
  'marketplace','packages','history_daily','advertisers'];

export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    for (const t of TABLES) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL, screen_id TEXT, data TEXT)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS redemptions (id TEXT PRIMARY KEY, code TEXT, at REAL, data TEXT)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
    this.cache = {}; for (const t of TABLES) this.cache[t] = new Map();
    this.decisionLog = []; // newest-last ring of decision records (also persisted)
    this.loadAll();
  }
  loadAll() {
    for (const t of TABLES) {
      const rows = this.db.prepare(`SELECT id, data FROM ${t}`).all();
      for (const r of rows) this.cache[t].set(r.id, JSON.parse(r.data));
    }
    const d = this.db.prepare(`SELECT data FROM decisions ORDER BY id DESC LIMIT 2000`).all();
    this.decisionLog = d.map(r => JSON.parse(r.data)).reverse();
  }
  all(t) { return [...this.cache[t].values()]; }
  get(t, id) { return this.cache[t].get(id); }
  put(t, row) {
    this.cache[t].set(row.id, row);
    this.db.prepare(`INSERT INTO ${t} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(row.id, JSON.stringify(row));
    return row;
  }
  del(t, id) { this.cache[t].delete(id); this.db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id); }
  logDecision(rec) {
    this.decisionLog.push(rec);
    if (this.decisionLog.length > 4000) this.decisionLog.splice(0, this.decisionLog.length - 4000);
    this.db.prepare(`INSERT INTO decisions (at, screen_id, data) VALUES (?, ?, ?)`).run(rec.at, rec.screenId, JSON.stringify(rec));
  }
  addRedemption(r) {
    this.db.prepare(`INSERT OR REPLACE INTO redemptions (id, code, at, data) VALUES (?, ?, ?, ?)`)
      .run(r.id, r.code, r.at, JSON.stringify(r));
  }
  kvGet(k, dflt) { const r = this.db.prepare(`SELECT v FROM kv WHERE k = ?`).get(k); return r ? JSON.parse(r.v) : dflt; }
  kvSet(k, v) { this.db.prepare(`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(k, JSON.stringify(v)); }
}
export const store = new Store(process.env.DB_PATH || ':memory:');
