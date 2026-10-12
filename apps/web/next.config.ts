import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import path from "path";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Note: /api/backend/* proxying is handled by Edge middleware (middleware.ts).
// The middleware validates the session cookie via getToken() at the edge and
// rewrites to the backend with x-internal-secret + x-user-email headers.
// The old serverless route handler at src/app/api/backend/[...path]/route.ts
// is kept as a fallback but should not be hit in normal operation.
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  async redirects() {
    return [
      {
        source: "/invoices/:path*",
        destination: "/accounting/invoices/:path*",
        permanent: true,
      },
      {
        source: "/documents/:path*",
        destination: "/accounting/documents/:path*",
        permanent: true,
      },
      {
        source: "/trash",
        destination: "/accounting/trash",
        permanent: true,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
