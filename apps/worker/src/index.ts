import Fastify from "fastify";
import cors from "@fastify/cors";
import { labRoutes } from "./lab/routes.js";
import { FFMPEG, FFPROBE } from "./media/ffmpeg.js";

const port = Number(process.env.PORT ?? 4000);
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const app = Fastify({
  // structured JSON logs; every pipeline log line carries recording/stage fields
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 1024 * 1024,
});

await app.register(cors, {
  origin: corsOrigins.length ? corsOrigins : true,
  allowedHeaders: ["content-type", "authorization", "x-lab-token", "x-file-name", "x-chunk-t"],
  methods: ["GET", "POST", "PUT", "OPTIONS"],
});

app.get("/health", async () => ({ ok: true, ffmpeg: FFMPEG, ffprobe: FFPROBE }));
await app.register(labRoutes, { prefix: "/lab" });

await app.listen({ port, host: "0.0.0.0" });
