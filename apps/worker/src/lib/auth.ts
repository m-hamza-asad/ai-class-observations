import type { FastifyReply, FastifyRequest } from "fastify";
import type { Tables } from "@obs/shared/database";
import { db } from "./supabase.js";

export type Profile = Tables<"profiles">;

declare module "fastify" {
  interface FastifyRequest {
    profile?: Profile;
  }
}

/**
 * Verifies the caller's Supabase access token (Authorization: Bearer <jwt>) and loads their profile.
 * Browsers call the worker directly (uploads can't go through Vercel), so every non-lab route uses this.
 */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return reply.code(401).send({ error: "missing bearer token" });

  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return reply.code(401).send({ error: "invalid session" });

  const { data: profile } = await db().from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.deactivated_at) return reply.code(403).send({ error: "no active profile" });
  req.profile = profile;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.profile?.role !== "admin") return reply.code(403).send({ error: "admin only" });
}
