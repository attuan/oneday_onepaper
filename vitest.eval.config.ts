// LLM を実際に呼ぶ評価(npm run eval)。通常の npm test には入れない
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.eval.ts"], testTimeout: 15 * 60 * 1000, hookTimeout: 60 * 1000, reporters: ["verbose"] },
});
