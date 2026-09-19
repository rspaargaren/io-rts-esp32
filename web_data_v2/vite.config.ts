import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      "/api": {
        target: "http://192.168.0.78",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
