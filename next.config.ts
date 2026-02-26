import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark web-tree-sitter as external for server builds (uses Node APIs like fs)
  serverExternalPackages: ["web-tree-sitter"],

  turbopack: {
    resolveAlias: {
      // Prevent Turbopack from trying to bundle web-tree-sitter's Node.js deps
      // on the client side — the module is dynamically imported only in the browser
      "fs/promises": { browser: "./lib/stubs/empty.js" },
      module: { browser: "./lib/stubs/empty.js" },
    },
  },

  // Webpack fallback (used with --webpack flag)
  webpack(config, { isServer }) {
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    if (isServer) {
      config.externals = config.externals || [];
      (config.externals as Array<unknown>).push("web-tree-sitter");
    }

    return config;
  },
};

export default nextConfig;
