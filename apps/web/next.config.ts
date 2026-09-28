import type { NextConfig } from "next";

// The worker is a separate persistent service. In local/tunnel testing the browser reaches it
// through this same-origin proxy (/worker/*). Note Next caps proxied bodies at 10 MB, so large
// uploads must go to the worker directly (NEXT_PUBLIC_WORKER_URL).
const workerUrl = process.env.WORKER_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@obs/shared"],
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.app"],
  async rewrites() {
    return [{ source: "/worker/:path*", destination: `${workerUrl}/:path*` }];
  },
};

export default nextConfig;
