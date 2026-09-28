import { pino } from "pino";
import { config } from "../config.js";

/**
 * One structured JSON logger for HTTP and background jobs. Pipeline log lines always carry
 * `stage` plus the entity ids involved (recordingId / documentId / classId / jobId), so any
 * failure can be traced from the logs alone.
 */
export const logger = pino({ level: config.LOG_LEVEL, base: { service: "worker" } });
export type Logger = typeof logger;
