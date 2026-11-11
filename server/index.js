import express from 'express';
import { getTokenMap, getTokenMapForChain, getIconUrl } from './coingecko.js';
import { getSysInfo } from './sysinfo.js';
import { handleLlmProxy } from './llm.js';
import { sendJson } from './http.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Full token map: { "chainId:address": { symbol, name, cgId, imageUrl, rank } }
// Clients fetch this once on load and cache it in localStorage for 24h. Gzipped.
app.get('/api/tokenlist', async (req, res) => {
  try {
    const map = await getTokenMap();
    sendJson(req, res, 200, { ok: true, map, count: Object.keys(map).length });
  } catch (err) {
    sendJson(req, res, 500, { ok: false, error: err.message });
  }
});

// Per-chain shard of the token map — lets a client fetch only the chains it
// needs instead of the whole ~1.3 MB list. Same flat key shape, gzipped.
app.get('/api/tokenlist/:chainId', async (req, res) => {
  const chainId = Number(req.params.chainId);
  if (!chainId) return sendJson(req, res, 400, { ok: false, error: 'bad chainId' });
  try {
    const map = await getTokenMapForChain(chainId);
    sendJson(req, res, 200, { ok: true, map, count: Object.keys(map).length });
  } catch (err) {
    sendJson(req, res, 500, { ok: false, error: err.message });
  }
});

// On-demand icon for a single token (for tokens outside the top-1000 by market cap).
app.get('/api/coinicon/:chainId/:address', async (req, res) => {
  const chainId = Number(req.params.chainId);
  const { address } = req.params;
  if (!chainId || !address) return res.status(400).json({ ok: false, error: 'bad params' });
  try {
    const url = await getIconUrl(chainId, address);
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Local host system info for the Settings "This device" panel (CPU, RAM, GPU).
// Read from this machine only; never persisted or forwarded.
app.get('/api/sysinfo', async (req, res) => {
  try {
    const info = await getSysInfo();
    sendJson(req, res, 200, { ok: true, info });
  } catch (err) {
    sendJson(req, res, 500, { ok: false, error: err.message });
  }
});

// Proxy chat completions to the user's configured external endpoint (avoids
// browser CORS and keeps the API key out of page code). Streams the response.
app.post('/api/llm', handleLlmProxy);

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
});
