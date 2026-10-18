import type { NextConfig } from "next";

// The browser only ever talks to this origin; Next proxies /api to the Python core service.
// BACKEND_URL is read on the server at build/start time (never exposed to the browser).
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8080";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default config;
