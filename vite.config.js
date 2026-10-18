import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { loadEnv } from './server/loadEnv.mjs'
import { featureFeedPlugin } from './server/featureFeed.mjs'
import { homeApiPlugin } from './server/homeApi.mjs'
import { nterNewsApiPlugin } from './server/nterNews.mjs'
import { transitApiPlugin } from './server/transitApi.mjs'
import { diplomacyApiPlugin } from './server/diplomacyApi.mjs'
import { assetsApiPlugin } from './server/assetsApi.mjs'
import { siteIconApiPlugin } from './server/siteIconApi.mjs'
import { resourcesApiPlugin } from './server/resourcesApi.mjs'
import { aiApiPlugin } from './server/aiApi.mjs'
import { usersApiPlugin } from './server/usersApi.mjs'
import { analyticsApiPlugin } from './server/analyticsApi.mjs'
import { marketingMediaApiPlugin } from './server/marketingMediaApi.mjs'
import { siteFiguresApiPlugin } from './server/siteFiguresApi.mjs'
import { billingApiPlugin } from './server/billingApi.mjs'
import { userPrefsApiPlugin } from './server/userPrefsApi.mjs'
import { authApiPlugin } from './server/authApi.mjs'
import { liveTvApiPlugin } from './server/liveTvApi.mjs'

loadEnv()

// F178: the character maps and standard fonts pdf.js needs to read PDFs with CID-keyed fonts, served
// at /pdfjs/ from the installed pdfjs-dist (src/lib/fileText.js points pdf.js at them). Dev serves
// them from node_modules; a build copies them into dist/pdfjs/, outside the entry bundle.
function pdfjsAssetsPlugin() {
  const root = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
  const folders = ['cmaps', 'standard_fonts']
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const [, folder, file] = /^\/(cmaps|standard_fonts)\/([\w.-]+)$/.exec((req.url || '').split('?')[0]) || []
        const path = file && `${root}${folder}/${file}`
        if (!path || !existsSync(path) || !statSync(path).isFile()) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.end(readFileSync(path))
      })
    },
    generateBundle() {
      for (const folder of folders) {
        for (const file of readdirSync(`${root}${folder}`)) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${file}`, source: readFileSync(`${root}${folder}/${file}`) })
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    pdfjsAssetsPlugin(),
    authApiPlugin(),
    liveTvApiPlugin(),
    featureFeedPlugin(),
    homeApiPlugin(),
    nterNewsApiPlugin(),
    transitApiPlugin(),
    diplomacyApiPlugin(),
    assetsApiPlugin(),
    siteIconApiPlugin(),
    resourcesApiPlugin(),
    aiApiPlugin(),
    usersApiPlugin(),
    analyticsApiPlugin(),
    marketingMediaApiPlugin(),
    siteFiguresApiPlugin(),
    billingApiPlugin(),
    userPrefsApiPlugin(),
  ],
  // Cache the React runtime independently; aggregate initial bytes remain budgeted.
  build: { rollupOptions: { output: { manualChunks(id) {
    if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
  } } } },
  envPrefix: ['VITE_'],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
})
