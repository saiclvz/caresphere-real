import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose on the LAN (e.g. http://192.168.1.20:5173)
    port: 5173,
    // Allow tunnel hostnames (ngrok, VS Code dev tunnels) for demos.
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.devtunnels.ms'],
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
});
