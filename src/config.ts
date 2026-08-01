import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: required(
    'DATABASE_URL',
    'postgresql://survey:survey_dev_password@localhost:5432/noosphere_survey',
  ),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
  rateLimitTimeWindow: process.env.RATE_LIMIT_TIME_WINDOW ?? '1 minute',
  appVersionHeader: process.env.APP_VERSION_HEADER ?? 'x-survey-app-version',
  researcherApiKey: process.env.RESEARCHER_API_KEY ?? '',
};
