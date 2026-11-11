// Vite dev-server plugin: mounts /api/tokenlist[/:chainId] and /api/coinicon/*
// directly on the Vite dev server so no separate process is needed during
// development. In production, run `node server/index.js` alongside your static
// file host.
import { getTokenMap, getTokenMapForChain, getIconUrl } from './server/coingecko.js';
import { getSysInfo } from './server/sysinfo.js';
import { handleLlmProxy } from './server/llm.js';
import { sendJson } from './server/http.js';

export default function tokenServerPlugin() {
  return {
    name: 'token-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        if (url === '/api/tokenlist') {
          try {
            const map = await getTokenMap();
            sendJson(req, res, 200, { ok: true, map, count: Object.keys(map).length });
          } catch (err) {
            sendJson(req, res, 500, { ok: false, error: err.message });
          }
          return;
        }

        // Per-chain shard: /api/tokenlist/<chainId>
        if (url.startsWith('/api/tokenlist/')) {
          const chainId = Number(url.slice('/api/tokenlist/'.length).split(/[/?]/)[0]);
          if (!chainId) { sendJson(req, res, 400, { ok: false, error: 'bad chainId' }); return; }
          try {
            const map = await getTokenMapForChain(chainId);
            sendJson(req, res, 200, { ok: true, map, count: Object.keys(map).length });
          } catch (err) {
            sendJson(req, res, 500, { ok: false, error: err.message });
          }
          return;
        }

        if (url === '/api/llm' && req.method === 'POST') {
          await handleLlmProxy(req, res);
          return;
        }

        if (url === '/api/sysinfo') {
          try {
            const info = await getSysInfo();
            sendJson(req, res, 200, { ok: true, info });
          } catch (err) {
            sendJson(req, res, 500, { ok: false, error: err.message });
          }
          return;
        }

        if (url.startsWith('/api/coinicon/')) {
          const parts = url.slice('/api/coinicon/'.length).split('/');
          const chainId = Number(parts[0]);
          const address = parts[1];
          if (!chainId || !address) { sendJson(req, res, 400, { ok: false, error: 'bad params' }); return; }
          try {
            const iconUrl = await getIconUrl(chainId, address);
            sendJson(req, res, 200, { ok: true, url: iconUrl });
          } catch (err) {
            sendJson(req, res, 500, { ok: false, error: err.message });
          }
          return;
        }

        next();
      });
    },
  };
}
