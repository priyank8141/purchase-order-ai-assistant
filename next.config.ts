import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg is a Node-only driver; load it at runtime instead of bundling it.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
