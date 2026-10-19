import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content Security Policy for the CareSphere page (added as a <meta> tag, so it applies in `npm run dev` and in a
 * build). Scripts, data requests and images come only from CareSphere itself (and the API address in VITE_API_URL
 * when it is set); the only outside files are the Google font. Even if someone managed to inject a script, the
 * browser would refuse to send data to another site. In development Vite needs inline scripts (fast refresh).
 * Set VITE_CSP=off in frontend/.env only to rule the policy out while troubleshooting.
 */
function csp(mode, env) {
  const api = (() => { try { return env.VITE_API_URL ? new URL(env.VITE_API_URL).origin : ''; } catch { return ''; } })();
  const self = ["'self'", api].filter(Boolean).join(' ');
  const policy = [
    "default-src 'self'",
    `script-src 'self'${mode === 'development' ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src ${self} data: blob:`,
    `media-src ${self} blob:`,
    `connect-src ${self}`,
    `frame-src ${self} blob:`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'caresphere-csp',
    transformIndexHtml(html) {
      if (String(env.VITE_CSP || '').toLowerCase() === 'off') return html;
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), csp(mode, env)],
    server: {
      host: true, // expose on the LAN (e.g. http://192.168.1.20:5173)
      port: 5173,
      // Allow tunnel hostnames (ngrok, VS Code dev tunnels) for demos.
      allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.devtunnels.ms'],
      proxy: {
        '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:5000', changeOrigin: true },
      },
    },
  };
});
