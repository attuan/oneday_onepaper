import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // サブパス(GitHub Pages の /リポジトリ名/ など)に置くときは BASE_PATH で渡す。
  // 未設定なら "/"。Tauri 版はそのままでよい
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: { include: ["src/**/*.test.ts", "proxy/src/**/*.test.ts"] },
});
