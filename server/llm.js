// LLM proxy: forwards an OpenAI-compatible Chat Completions request from the
// browser to the user's configured endpoint, and streams the response back.
//
// Why a proxy at all (vs. the browser calling the API directly):
//   • CORS — commercial inference APIs deliberately refuse cross-origin browser
//     requests; a server-to-server call isn't subject to CORS.
//   • Key hygiene — the API key rides as a request header to THIS local server
//     and is attached to the upstream call here, instead of being embedded in
//     page code.
//
// The browser sends the raw OpenAI request body and two routing headers:
//   x-llm-base-url : the endpoint root (we append /chat/completions)
//   x-llm-api-key  : optional bearer token (self-hosted servers often need none)
// Everything in the body is forwarded verbatim, and the upstream stream is piped
// straight back, so SSE streaming works unchanged.

import { Readable } from 'stream';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleLlmProxy(req, res) {
  try {
    const base = req.headers['x-llm-base-url'];
    const key = req.headers['x-llm-api-key'];
    if (!base) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing x-llm-base-url header' }));
      return;
    }
    const body = await readBody(req);
    // Tolerate a base URL given with or without a trailing slash or an explicit
    // /chat/completions; normalise to exactly one.
    const root = String(base).replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const target = `${root}/chat/completions`;

    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body,
    });

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    if (upstream.body) {
      // Pipe the upstream (web ReadableStream) straight to the Node response so
      // streamed tokens reach the browser as they arrive.
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `LLM proxy failed: ${err?.message || err}` }));
  }
}
