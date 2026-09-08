import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      TMDB_READ_ACCESS_TOKEN: "test-token",
      CRON_SECRET: "test-cron-secret"
    }
  }
});
