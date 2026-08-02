import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../../DATABASE/migrations/007_phq9_gad7_mood.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  const instruments = await client.query(
    `SELECT instrument_code, item_count
     FROM instrument_versions
     WHERE instrument_code IN ('phq9_v1', 'gad7_v1')
     ORDER BY instrument_code`,
  );
  console.log(JSON.stringify({ ok: true, instruments: instruments.rows }));
} finally {
  await client.end();
}
