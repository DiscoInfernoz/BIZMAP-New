/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },

  // ⬇️ Add a webpack hook to force in-memory cache (fixes PackFileCacheStrategy path errors)
  webpack: (config) => {
    // Use in-memory cache to avoid container FS path weirdness
    config.cache = { type: "memory" };

    // (Optional fallback) If something else re-enables filesystem cache later, make sure it writes to a safe path:
    // if (config.cache && config.cache.type === "filesystem") {
    //   const path = require("path");
    //   config.cache.cacheDirectory = path.resolve(".next/cache/webpack");
    // }

    return config;
  },
};

module.exports = nextConfig;
