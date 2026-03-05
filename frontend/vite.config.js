import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000'
const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true'
const pollingInterval = Number(process.env.CHOKIDAR_INTERVAL || 1000)
const pollingBinaryInterval = Number(process.env.CHOKIDAR_BINARY_INTERVAL || 1500)

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: {
      usePolling,
      interval: pollingInterval,
      binaryInterval: pollingBinaryInterval,
      ignored: ['**/.git/**', '**/dist/**', '**/.idea/**'],
    },
    proxy: {
      '/health': { target: apiProxyTarget, changeOrigin: true },
      '/config': { target: apiProxyTarget, changeOrigin: true },
      '/available-models': { target: apiProxyTarget, changeOrigin: true },
      '/run': { target: apiProxyTarget, changeOrigin: true },
      '/audio-proxy': { target: apiProxyTarget, changeOrigin: true },
    },
  },
})
