import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tokenServerPlugin from './vite-plugin-token-server.js';

// COOP/COEP are required for SharedArrayBuffer (wllama multi-thread CPU build).
// These dev-server headers do NOT apply to production — set the same headers on the host.
//
// COEP is "credentialless" (NOT "require-corp"): both keep the page
// crossOriginIsolated (so SharedArrayBuffer works), but require-corp BLOCKS every
// cross-origin subresource that lacks a CORP/CORS header — which is exactly the
// case for CoinGecko token icons (their CDN sends no CORP/ACAO header), so all
// icons silently failed to load. "credentialless" fetches such cross-origin
// resources without credentials instead of blocking them, fixing the icons.
const crossOriginIsolation = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react(), tokenServerPlugin()],
  server: {
    headers: crossOriginIsolation,
    // /api/* is handled by tokenServerPlugin — no proxy needed in dev
  },
  preview: {
    headers: crossOriginIsolation,
    // In preview mode the Vite plugin doesn't run; proxy to the standalone server instead
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { target: 'es2022' },
  // @cofhe/sdk spawns a zk-prove worker with internal imports; the default
  // iife worker format can't code-split
  worker: { format: 'es' },
  optimizeDeps: {
    // wllama + transformers.js ship wasm assets that esbuild pre-bundling mangles
    exclude: ['@wllama/wllama', '@huggingface/transformers'],
  },
});
