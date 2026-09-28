import type { Readable } from "node:stream";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { aiFake, config, pipelineEnabled } from "./config.js";
import { logger } from "./lib/logger.js";
import { labRoutes } from "./lab/routes.js";
import { documentRoutes } from "./routes/documents.js";
import { recordingRoutes } from "./routes/recordings.js";
import { startQueue, stopQueue } from "./queue.js";
import { FFMPEG, FFPROBE } from "./media/ffmpeg.js";

const corsOrigins = config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

const app = Fastify({
  // structured JSON logs; every pipeline log line carries recording/stage fields
  loggerInstance: logger,
  bodyLimit: 1024 * 1024,
});

await app.register(cors, {
  origin: corsOrigins.length ? corsOrigins : true,
  allowedHeaders: ["content-type", "authorization", "x-lab-token", "x-file-name", "x-chunk-t"],
  methods: ["GET", "POST", "PUT", "OPTIONS"],
});

// Raw binary bodies (video chunks, uploads) are handed to routes as streams; routes enforce their own size caps.
const passthrough = (_req: unknown, payload: Readable, done: (err: Error | null, body?: unknown) => void) => done(null, payload);
app.addContentTypeParser("application/octet-stream", passthrough);
app.addContentTypeParser(/^(video|audio)\//, passthrough);

app.get("/health", async () => ({
  ok: true,
  pipeline: pipelineEnabled,
  ai: aiFake ? "FAKE (local testing)" : { groq: Boolean(config.GROQ_API_KEY), anthropic: Boolean(config.ANTHROPIC_API_KEY), gemini: Boolean(config.GEMINI_API_KEY) },
  ffmpeg: FFMPEG,
  ffprobe: FFPROBE,
}));
await app.register(labRoutes, { prefix: "/lab" });

if (pipelineEnabled) {
  await startQueue();
  await app.register(documentRoutes, { prefix: "/documents" });
  await app.register(recordingRoutes, { prefix: "/recordings" });
} else {
  logger.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL not set: running lab-only (no pipeline)");
}

// "::" listens on IPv6 and IPv4 (localhost may resolve to ::1; Railway private networking is IPv6)
await app.listen({ port: config.PORT, host: "::" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    logger.info({ signal: sig }, "shutting down");
    await app.close();
    await stopQueue();
    process.exit(0);
  });
}
