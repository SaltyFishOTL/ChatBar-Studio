import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
const buildId = new Date().toISOString();
export default defineConfig({
  define: { "import.meta.env.VITE_STUDIO_BUILD": JSON.stringify(buildId) },
  plugins: [
    react(),
    {
      name: "studio-build-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ buildId }),
        });
      },
    },
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.png"],
      manifest: {
        name: "ChatBar Studio",
        short_name: "Studio",
        description: "独立生图工作室",
        theme_color: "#fcfdfc",
        background_color: "#fcfdfc",
        display: "standalone",
        icons: [
          {
            src: "/icon.png",
            sizes: "320x320",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: [
          "**/*.{js,css,html,svg,wasm}",
          "data/prompts.json",
          "data/styles.json",
          "data/style-metadata.json",
        ],
        navigateFallbackDenylist: [/^\/data\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              url.pathname.startsWith("/data/"),
            handler: "CacheFirst",
            options: {
              cacheName: "studio-resources-v1",
              expiration: { maxEntries: 80 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  build: { target: "es2022" },
  worker: { format: "es" },
});
