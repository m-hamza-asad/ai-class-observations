import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGINS: z.string().default(""),
  DATA_DIR: z.string().default("data"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),

  // AI providers
  GROQ_API_KEY: z.string().optional(),
  WHISPER_MODEL: z.string().default("whisper-large-v3"),
  ANTHROPIC_API_KEY: z.string().optional(),
  // The brief specifies a Sonnet model for report generation; romanization uses the same model by default.
  CLAUDE_REPORT_MODEL: z.string().default("claude-sonnet-5"),
  CLAUDE_ROMANIZE_MODEL: z.string().default("claude-sonnet-5"),
  GEMINI_API_KEY: z.string().optional(),
  /** Segments whose Whisper confidence falls below this are flagged "unclear". Tune on real classroom audio. */
  UNCLEAR_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.45),
  /**
   * LOCAL DEVELOPMENT ONLY: "1" swaps every AI call for deterministic fake output so the pipeline
   * mechanics can be exercised without API keys. Refused when NODE_ENV=production.
   */
  AI_FAKE: z.enum(["0", "1"]).default("0"),
  NODE_ENV: z.string().default("development"),
});

// treat blank values (e.g. copied straight from .env.example) as unset
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
export const config = schema.parse(env);

if (config.AI_FAKE === "1" && config.NODE_ENV === "production") {
  throw new Error("AI_FAKE=1 is not allowed in production");
}
export const aiFake = config.AI_FAKE === "1";

/**
 * The pipeline needs Supabase + Postgres. Without them the worker still serves the recording lab,
 * so it can be deployed for device testing before those accounts exist.
 */
export const pipelineEnabled = Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY && config.DATABASE_URL);
