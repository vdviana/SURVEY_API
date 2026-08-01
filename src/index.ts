import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
  }
}

void main();
