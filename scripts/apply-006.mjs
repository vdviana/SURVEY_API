import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../../DATABASE/migrations/006_dirty_dozen_mind_map.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  const instruments = await client.query(
    `SELECT instrument_code, item_count, manifest_hash
     FROM instrument_versions
     WHERE instrument_code = 'dirty_dozen_v1'`,
  );
  const items = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM instrument_items
     WHERE instrument_version_id = '77777777-7777-7777-7777-777777777777'`,
  );
  const table = await client.query(
    `SELECT to_regclass('public.personality_profiles') AS t`,
  );
  console.log(
    JSON.stringify({
      ok: true,
      instruments: instruments.rows,
      itemCount: items.rows[0].n,
      personalityProfiles: table.rows[0].t,
    }),
  );
} finally {
  await client.end();
}
