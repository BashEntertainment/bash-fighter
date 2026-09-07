import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  resolve: {
    // Workspace packages ship raw TS source with explicit .ts extensions
    // (Node's type-stripping convention); esbuild/Vite need this hint to
    // resolve those specifiers.
    extensions: ['.ts', '.js', '.mjs', '.json'],
  },
});
