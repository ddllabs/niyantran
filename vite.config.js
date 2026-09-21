import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { loadEnv } from './server/loadEnv.mjs'
import { featureFeedPlugin } from './server/featureFeed.mjs'
import { homeApiPlugin } from './server/homeApi.mjs'
import { transitApiPlugin } from './server/transitApi.mjs'
import { diplomacyApiPlugin } from './server/diplomacyApi.mjs'
import { assetsApiPlugin } from './server/assetsApi.mjs'
import { resourcesApiPlugin } from './server/resourcesApi.mjs'
import { aiApiPlugin } from './server/aiApi.mjs'
import { usersApiPlugin } from './server/usersApi.mjs'
import { analyticsApiPlugin } from './server/analyticsApi.mjs'
import { marketingMediaApiPlugin } from './server/marketingMediaApi.mjs'
import { appFlagsApiPlugin } from './server/appFlags.mjs'
import { billingApiPlugin } from './server/billingApi.mjs'
import { googleAuthApiPlugin } from './server/googleAuth.mjs'
import { userPrefsApiPlugin } from './server/userPrefsApi.mjs'

loadEnv()

export default defineConfig({
  plugins: [react(), featureFeedPlugin(), homeApiPlugin(), transitApiPlugin(), diplomacyApiPlugin(), assetsApiPlugin(), resourcesApiPlugin(), aiApiPlugin(), usersApiPlugin(), analyticsApiPlugin(), marketingMediaApiPlugin(), appFlagsApiPlugin(), billingApiPlugin(), userPrefsApiPlugin(), googleAuthApiPlugin()],
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
