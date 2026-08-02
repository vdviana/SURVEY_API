import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

async function main() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting_down');
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, 'survey_api_listening');
  } catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
  }
}

void main();
