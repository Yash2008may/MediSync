import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts,
    // Lets the dev server call the MediSync API on :5000 without CORS changes.
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
    },
  },
});
