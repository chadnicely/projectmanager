// https://nuxt.com/docs/api/configuration/nuxt-config
const API = process.env.BASE_API || "http://localhost:4200";

export default defineNuxtConfig({
  // SSR stays on (the ssr:false builder path is buggy in this Nuxt version); the app is
  // still client-driven — localStorage is guarded with import.meta.client and data loads in onMounted.
  devtools: { enabled: false },
  css: ["~/assets/styles.css"],
  app: {
    head: {
      title: "Base",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" }],
    },
  },
  // Dev: proxy the API + MCP to the NestJS backend.
  nitro: {
    devProxy: {
      "/api": { target: API, changeOrigin: true },
      "/mcp": { target: API, changeOrigin: true },
    },
  },
  compatibilityDate: "2024-09-01",
});
