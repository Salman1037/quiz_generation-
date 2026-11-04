import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Document parsers run only on the server; keep them out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
