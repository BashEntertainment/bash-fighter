import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Proxy the match server's WebSocket + health endpoint through the
    // same origin the dev server (and, in the browser preview tunnel,
    // the exposed port) is on, so the client's same-origin WS URL works
    // without exposing a second port.
    proxy: {
      '/socket': { target: 'ws://localhost:8081', ws: true },
      '/api': { target: 'http://localhost:8081' },
    },
  },
  resolve: {
    // Workspace packages ship raw TS source with explicit .ts extensions
    // (Node's type-stripping convention); esbuild/Vite need this hint to
    // resolve those specifiers.
    extensions: ['.ts', '.js', '.mjs', '.json'],
  },
});
