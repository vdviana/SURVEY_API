import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'survey-api' }));

  app.get('/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true, database: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, database: 'down' });
    }
  });
}
