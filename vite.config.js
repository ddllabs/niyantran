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

export default defineConfig({
  plugins: [
    react(),
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
