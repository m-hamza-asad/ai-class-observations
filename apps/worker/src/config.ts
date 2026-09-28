import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGINS: z.string().default(""),
  DATA_DIR: z.string().default("data"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
});

// treat blank values (e.g. copied straight from .env.example) as unset
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
export const config = schema.parse(env);

/**
 * The pipeline needs Supabase + Postgres. Without them the worker still serves the recording lab,
 * so it can be deployed for device testing before those accounts exist.
 */
export const pipelineEnabled = Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY && config.DATABASE_URL);
