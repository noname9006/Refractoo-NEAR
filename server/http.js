// Shared HTTP helper: gzip-aware JSON replies. Works with both the standalone
// Express server and the Vite dev-server middleware (both pass a Node
// http.ServerResponse). The token list is ~1.3 MB of JSON; gzip cuts it to a
// fraction over the wire, which is the single biggest transfer on first load.

import { gzipSync } from 'zlib';

export function sendJson(req, res, status, body) {
  const json = JSON.stringify(body);
  const accepts = (req.headers['accept-encoding'] || '').includes('gzip');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  // Vary so shared caches don't serve a gzipped body to a client that can't
  // decode it (or vice versa).
  res.setHeader('Vary', 'Accept-Encoding');

  // Only worth compressing non-trivial payloads.
  if (accepts && json.length > 1024) {
    const gz = gzipSync(json);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', gz.length);
    res.end(gz);
  } else {
    res.setHeader('Content-Length', Buffer.byteLength(json));
    res.end(json);
  }
}
