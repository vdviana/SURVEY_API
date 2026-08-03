import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';
import { studyRoutes } from './routes/study.js';
import { surveyRoutes } from './routes/survey.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 256 * 1024,
    trustProxy: true,
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitTimeWindow,
  });

  await app.register(healthRoutes);
  await app.register(studyRoutes);
  await app.register(surveyRoutes);

  app.setErrorHandler((error, request, reply) => {
    const isZod =
      error instanceof ZodError ||
      (error &&
        typeof error === 'object' &&
        ((error as { name?: string }).name === 'ZodError' ||
          Array.isArray((error as { issues?: unknown }).issues)));
    if (isZod) {
      const zerr = error as ZodError;
      return reply.code(400).send({
        error: 'validation_error',
        details:
          typeof zerr.flatten === 'function'
            ? zerr.flatten()
            : (error as { issues?: unknown }).issues,
      });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        details: error.details,
      });
    }
    request.log.error({ err: error }, 'unhandled_error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  return app;
}
