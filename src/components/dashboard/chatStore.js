// Persistent multi-conversation store for the Wallet Assistant.
//
// Shape: { activeId, conversations: [{ id, title, msgs, updatedAt }] }
// where msgs are {role:'user'|'ai', text, think, done}. Persisted to
// localStorage so threads survive reloads and stay measurable/clearable from
// Settings. Migrates the previous single-thread store (`pwai.chat`).

const STORE_KEY = 'pwai.chats';
const LEGACY_KEY = 'pwai.chat';
const MAX_CONVERSATIONS = 30;
const MAX_MSGS_PER_CONV = 40;
const MAX_TEXT_CHARS = 24000;
const MAX_THINK_CHARS = 12000;

function clampText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + '\n\n[trimmed in local cache]';
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// First user line, trimmed to a short label.
export function titleFrom(msgs) {
  const u = (msgs || []).find((m) => m.role === 'user');
  const t = (u?.text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length > 42 ? t.slice(0, 42) + '…' : t;
}

export function newConversation() {
  return { id: uid(), title: 'New chat', msgs: [], updatedAt: Date.now() };
}

function freshStore() {
  const c = newConversation();
  return { activeId: c.id, conversations: [c] };
}

export function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && Array.isArray(raw.conversations) && raw.conversations.length) {
      const conversations = raw.conversations.map((c) => ({
        id: c.id || uid(),
        title: c.title || titleFrom(c.msgs),
        msgs: Array.isArray(c.msgs) ? c.msgs : [],
        updatedAt: c.updatedAt || Date.now(),
      }));
      const activeId = conversations.some((c) => c.id === raw.activeId)
        ? raw.activeId
        : conversations[0].id;
      return { activeId, conversations };
    }
  } catch {}

  // Migrate the legacy single-thread store into one conversation.
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
    if (Array.isArray(legacy) && legacy.length) {
      const conv = { id: uid(), title: titleFrom(legacy), msgs: legacy, updatedAt: Date.now() };
      const store = { activeId: conv.id, conversations: [conv] };
      saveStore(store);
      try { localStorage.removeItem(LEGACY_KEY); } catch {}
      return store;
    }
  } catch {}

  return freshStore();
}

export function saveStore(store) {
  try {
    // #region debug-point E:persist-cost
    const startedAt = performance.now();
    // #endregion
    const conversations = store.conversations
      .slice(-MAX_CONVERSATIONS)
      .map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        msgs: (c.msgs || [])
          .slice(-MAX_MSGS_PER_CONV)
          .map(({ role, text, think }) => ({
            role,
            text: clampText(text, MAX_TEXT_CHARS),
            think: clampText(think, MAX_THINK_CHARS),
            done: true,
          })),
      }));
    const payload = JSON.stringify({ activeId: store.activeId, conversations });
    localStorage.setItem(STORE_KEY, payload);
    // #region debug-point F:persist-cost
    const totalMs = performance.now() - startedAt;
    if (totalMs >= 12) {
      console.info('[perf] saveStore', {
        totalMs: Number(totalMs.toFixed(1)),
        bytes: payload.length,
        conversations: conversations.length,
      });
    }
    // #endregion
  } catch {}
}

export function clearStore() {
  try { localStorage.removeItem(STORE_KEY); } catch {}
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
  return freshStore();
}
