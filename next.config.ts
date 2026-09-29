import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-only packages stay out of the client bundle.
  serverExternalPackages: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb", "@aws-sdk/client-s3"],
  /**
   * Production option: serve /api/* from API Gateway + Lambda (infra/template.yaml) while
   * Amplify serves the pages. Same origin for the browser, so cookies and CORS stay simple.
   */
  async rewrites() {
    const target = process.env.API_PROXY_URL?.replace(/\/$/, "");
    if (!target) return [];
    return { beforeFiles: [{ source: "/api/:path*", destination: `${target}/api/:path*` }], afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Camera is only used through the native file picker (capture=user); no getUserMedia needed.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
