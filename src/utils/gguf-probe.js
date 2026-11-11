// Lightweight GGUF header probe.
//
// Fetches the first PROBE_BYTES of a GGUF shard via an HTTP Range request and
// parses the binary metadata section to extract architecture parameters. This
// lets the offload planner show accurate layer counts and memory estimates
// before the model has been downloaded or loaded into wllama.
//
// Falls back silently to null on any error (CORS, server errors, malformed
// header) so callers can degrade to registry hints.

const PROBE_BYTES = 512 * 1024; // 512 KB covers metadata for all known models
const GGUF_MAGIC = 0x46554747;  // 'GGUF' little-endian uint32

// GGUF metadata value types
const T = {
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5,
  FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12,
};

function readStr(view, offset, dec) {
  const len = Number(view.getBigUint64(offset, true));
  const value = dec.decode(new Uint8Array(view.buffer, offset + 8, len));
  return { value, next: offset + 8 + len };
}

function readVal(view, offset, type, dec) {
  switch (type) {
    case T.UINT8:   return { value: view.getUint8(offset),              next: offset + 1 };
    case T.INT8:    return { value: view.getInt8(offset),               next: offset + 1 };
    case T.UINT16:  return { value: view.getUint16(offset, true),       next: offset + 2 };
    case T.INT16:   return { value: view.getInt16(offset, true),        next: offset + 2 };
    case T.UINT32:  return { value: view.getUint32(offset, true),       next: offset + 4 };
    case T.INT32:   return { value: view.getInt32(offset, true),        next: offset + 4 };
    case T.FLOAT32: return { value: view.getFloat32(offset, true),      next: offset + 4 };
    case T.BOOL:    return { value: view.getUint8(offset) !== 0,        next: offset + 1 };
    case T.UINT64:  return { value: Number(view.getBigUint64(offset, true)), next: offset + 8 };
    case T.INT64:   return { value: Number(view.getBigInt64(offset, true)),  next: offset + 8 };
    case T.FLOAT64: return { value: view.getFloat64(offset, true),      next: offset + 8 };
    case T.STRING:  return readStr(view, offset, dec);
    case T.ARRAY: {
      const elemType = view.getUint32(offset, true);
      const n = Number(view.getBigUint64(offset + 4, true));
      let cur = offset + 12;
      for (let i = 0; i < n; i++) cur = readVal(view, cur, elemType, dec).next;
      return { value: null, next: cur };
    }
    default: throw new Error(`unknown GGUF type ${type}`);
  }
}

// Parse GGUF metadata KV pairs from an ArrayBuffer (may be partial).
// Returns whatever keys were successfully parsed before the buffer ended.
function parseGGUFMeta(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GGUF_MAGIC) throw new Error('not a GGUF file');
  const version = view.getUint32(4, true);
  if (version < 2) throw new Error(`GGUF v${version} unsupported`);
  const nKv = Number(view.getBigUint64(16, true));

  const dec = new TextDecoder();
  const meta = {};
  let offset = 24;
  try {
    for (let i = 0; i < nKv; i++) {
      const k = readStr(view, offset, dec);
      offset = k.next;
      const type = view.getUint32(offset, true);
      offset += 4;
      const v = readVal(view, offset, type, dec);
      meta[k.value] = v.value;
      offset = v.next;
    }
  } catch {
    // Buffer cut off mid-parse (expected when probe bytes < full file) —
    // return whatever we collected; architecture keys appear early.
  }
  return meta;
}

// Map raw GGUF metadata to the arch shape used by the offload planner.
// Keys use the pattern <architecture>.<param> (e.g. "qwen2.block_count").
function archFromMeta(meta) {
  const find = (suffix) => {
    const k = Object.keys(meta).find((key) => key.endsWith(suffix));
    return k != null ? Number(meta[k]) : null;
  };
  return {
    nLayer:  find('.block_count'),
    nHeadKv: find('.attention.head_count_kv'),
    headDim: find('.attention.key_length'),
    nEmbd:   find('.embedding_length'),
  };
}

// Per-URL cache so repeated calls are instant.
const cache = new Map();

// Fetch the first PROBE_BYTES of `url` and return architecture parameters
// extracted from the GGUF metadata header. Returns null on any failure.
export async function probeGGUFArch(url) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);

  let result = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Read at most PROBE_BYTES even if the server ignored the Range header.
    const chunks = [];
    let total = 0;
    const reader = res.body.getReader();
    while (total < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    reader.cancel().catch(() => {});

    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }

    const meta = parseGGUFMeta(buf.buffer);
    const arch = archFromMeta(meta);
    if (arch.nLayer != null) result = arch;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn('[gguf-probe]', url.split('/').pop(), '—', e.message);
    }
  } finally {
    clearTimeout(timer);
  }

  cache.set(url, result);
  return result;
}
