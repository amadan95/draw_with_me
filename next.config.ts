import type { NextConfig } from "next";

const isDevServer = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  typedRoutes: false,
  distDir: isDevServer ? ".next-dev" : ".next",
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }

    return config;
  }
};

export default nextConfig;
