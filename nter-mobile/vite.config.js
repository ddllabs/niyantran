import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The same toolchain as nter.pro. In `npm run dev`, /api is proxied to www.nter.pro so the
// browser preview reads the live public feeds without CORS; the phone build calls it directly
// through Capacitor's native HTTP.
// PREVIEW=1 builds a self-contained copy that runs from any folder (relative paths), used for the
// hosted click-through preview. Only the installable web app (TARGET=web) gets a service worker;
// the phone apps load their files from the device and must never serve a stale cached copy.
const preview = process.env.PREVIEW === '1';
const web = process.env.TARGET === 'web';

export default defineConfig({
  base: preview ? './' : '/',
  plugins: [
    react(),
    web && !preview && VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['brand/*.png', 'brand/*.webp'],
      manifest: {
        name: 'nter.pro',
        short_name: 'nter.pro',
        description: 'The research terminal for government, policy, law and global affairs.',
        theme_color: '#f8f5f0',
        background_color: '#f8f5f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,webp,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    // nter.pro's edge functions accept http://localhost:5173 (the website's own dev address), so the
    // browser version of the app always uses that port.
    port: 5173,
    strictPort: true,
    proxy: {
      // API_PROXY=http://localhost:3000 points the browser version at a local copy of the website.
      '/api': { target: process.env.API_PROXY || 'https://www.nter.pro', changeOrigin: true, secure: true },
      // The desk cards' analysis packs (src/lib/websiteData.js).
      '/data': { target: process.env.API_PROXY || 'https://www.nter.pro', changeOrigin: true, secure: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
