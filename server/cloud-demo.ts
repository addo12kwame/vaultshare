import express, { type Request, type Response } from 'express';
import { Pool, type PoolClient } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';

type Snapshot = Record<string, Record<string, any>[]>;
type Factory = (origin: string) => { app: express.Express; db: DatabaseSync };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const cookieName = '__Host-demo';
const ttl = 24 * 60 * 60 * 1000;
const maxBytes = 8 * 1024 * 1024;

// Portfolio demo adapter: Postgres owns durability and request serialization.
// One bounded shared snapshot preserves real account isolation and cross-browser share links.
// File bytes are stored privately in Postgres, never on ephemeral disk.
export function cloudDemo(factory: Factory) {
  const app = express();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000 });
  let ready: Promise<any> | undefined;
  const initialize = () => ready ??= pool.query(`CREATE TABLE IF NOT EXISTS demo_workspaces (
    id TEXT PRIMARY KEY, state JSONB NOT NULL DEFAULT '{}', expires BIGINT NOT NULL,
    window_start BIGINT NOT NULL, requests INTEGER NOT NULL DEFAULT 0
  )`).catch(e => { ready = undefined; throw e; });
  app.disable('x-powered-by');
  app.locals.closeDemoStore = () => pool.end();
  app.use(async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    if (!process.env.DATABASE_URL) return void res.status(503).json({ error: 'Demo storage is not configured.' });
    const host = process.env.VERCEL_ENV === 'production' ? (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL) : process.env.VERCEL_URL;
    const configured = process.env.APP_ORIGIN || (host ? `https://${host}` : '');
    const origin = configured.replace(/\/$/, '');
    if (!origin) return void res.status(503).json({ error: 'Demo origin is not configured.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('origin') !== origin)
      return void res.status(403).json({ error: 'Origin not allowed.' });
    // Bound imported demo data before allocating a request-local database.
    const length = Number(req.get('content-length') || 0);
    if (length > 300 * 1024) return void res.status(413).json({ error: 'Hosted uploads must be under 256 KB.' });
    const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    const token = raw && /^[a-f0-9]{64}$/.test(raw) ? raw : randomBytes(32).toString('hex');
    const id = 'vaultshare-shared-demo-v1', now = Date.now();
    let client: PoolClient | undefined;
    let db: DatabaseSync | undefined;
    const originalEnd = res.end;
    try {
      await initialize();
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '8s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      let found = await client.query('SELECT * FROM demo_workspaces WHERE id=$1 FOR UPDATE', [id]);
      if (!found.rowCount) {
        // Serialize new-workspace admission to enforce a global storage bound.
        await client.query('SELECT pg_advisory_xact_lock(531441)');
        await client.query('DELETE FROM demo_workspaces WHERE expires < $1', [now]);
        const count = await client.query('SELECT count(*)::int AS n FROM demo_workspaces');
        if (count.rows[0].n >= 500) {
          await client.query('ROLLBACK');
          return void res.status(503).json({ error: 'The demo is at capacity. Please try again later.' });
        }
        await client.query('INSERT INTO demo_workspaces(id,expires,window_start) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, now + ttl, now]);
        found = await client.query('SELECT * FROM demo_workspaces WHERE id=$1 FOR UPDATE', [id]);
      }
      const record = found.rows[0];
      const fresh = Number(record.expires) <= now;
      const windowStart = fresh || now - Number(record.window_start) >= 3600000 ? now : Number(record.window_start);
      const requests = windowStart === now ? 0 : record.requests;
      if (requests >= 3000) {
        await client.query('ROLLBACK');
        res.set('Retry-After', '3600');
        return void res.status(429).json({ error: 'Demo request limit reached. Try again in an hour.' });
      }
      const instance = factory(origin); db = instance.db;
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => String(r.name));
      const state: Snapshot = fresh ? {} : record.state;
      db.exec('PRAGMA foreign_keys=OFF; BEGIN');
      for (const name of tables) {
        // Names originate only from the application's schema, never user input.
        if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid demo schema');
        const columns = db.prepare(`PRAGMA table_info(${name})`).all().map(r => String(r.name));
        const insert = db.prepare(`INSERT INTO ${name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        for (const row of state[name] || []) insert.run(...columns.map(c => row[c] ?? null));
      }
      db.exec('COMMIT; PRAGMA foreign_keys=ON');

      const endArgs = await new Promise<any[]>((resolve, reject) => {
        res.end = ((...args: any[]) => { resolve(args); return res; }) as typeof res.end;
        // Buffer the complete bounded JSON response until Postgres commits.
        instance.app(req, res, reject);
      });
      if (res.statusCode < 400) {
        const snapshot: Snapshot = {};
        for (const name of tables) snapshot[name] = db.prepare(`SELECT * FROM ${name}`).all();
        const json = JSON.stringify(snapshot);
        if (Buffer.byteLength(json) > maxBytes) throw new Error('Demo workspace limit reached');
        await client.query('UPDATE demo_workspaces SET state=$2::jsonb,expires=$3,window_start=$4,requests=$5 WHERE id=$1', [id,json,now+ttl,windowStart,requests+1]);
      } else {
        await client.query('UPDATE demo_workspaces SET window_start=$2,requests=$3 WHERE id=$1', [id,windowStart,requests+1]);
      }
      await client.query('COMMIT');
      res.end = originalEnd;
      (originalEnd as any).apply(res, endArgs);
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      res.end = originalEnd;
      if (!res.headersSent) {
        res.removeHeader('Content-Length'); res.removeHeader('ETag');
        res.status(503).json({ error: 'Demo request could not be saved. Try a smaller workspace or retry shortly.' });
      } else res.destroy();
      // Never log provider connection strings, SQL parameters, or invitation tokens.
      console.error('Cloud demo request failed', e instanceof Error ? e.name : 'Error');
    } finally {
      if (db) db.close();
      client?.release();
    }
  });
  return app;
}
