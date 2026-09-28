import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { PermanentError } from "../jobs/tracking.js";

let client: Anthropic | null = null;

export function claude(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) throw new PermanentError("ANTHROPIC_API_KEY is not configured on the worker.");
  // SDK retries 429/5xx/connection errors itself; pg-boss retries the whole stage on top of that
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3 });
  return client;
}

/** Throws a PermanentError for outcomes a retry won't fix (refusal, output cut off, bad request). */
export function assertUsableResponse(msg: Anthropic.Message) {
  if (msg.stop_reason === "refusal") {
    throw new PermanentError(`Claude declined the request (${msg.stop_details?.category ?? "no category"}).`);
  }
  if (msg.stop_reason === "max_tokens") {
    throw new PermanentError("Claude's output hit max_tokens before completing; raise max_tokens for this stage.");
  }
}

/** Retryable = rate limits, overload, server errors, network. Everything else fails the stage now. */
export function toStageError(err: unknown): Error {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new PermanentError("Anthropic API key is invalid.");
  if (err instanceof Anthropic.BadRequestError) return new PermanentError(`Anthropic rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return err;
  return err instanceof Error ? err : new Error(String(err));
}

export function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
