import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { AWS_MOCK_MODE: "true", WHATSAPP_MOCK_MODE: "true", SESSION_SECRET: "test-secret-please-change", LOG_LEVEL: "silent" },
  },
});
