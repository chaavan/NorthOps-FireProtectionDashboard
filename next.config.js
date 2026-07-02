/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-*/**/*",
      "./node_modules/pdfjs-dist/**/*",
    ],
  },
  turbopack: {
    resolveAlias: {
      fs: { browser: "./empty-module.ts" },
      path: { browser: "./empty-module.ts" },
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "@react-pdf/renderer"];
    }
    return config;
  },
};

module.exports = nextConfig;
