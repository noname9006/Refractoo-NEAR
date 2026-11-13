import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { buildAnalysisMessages } from '../../prompts/wallet-analysis.js';
import { createThinkStreamParser, parseThink } from '../../prompts/think-parser.js';
import { portfolioFacts } from '../../analytics/portfolio.js';
import { startRecording, transcribeWhisper } from '../../voice/index.js';
import { getModel, formatSize } from '../../models/registry.js';
import { LiveMarkdownView, MarkdownView } from './MarkdownRenderer.jsx';
import { loadStore, saveStore, clearStore, newConversation, titleFrom } from './chatStore.js';
import { startResourceMonitor, subscribeResources, getResourceSnapshot } from '../../utils/resource-monitor.js';
import { fmtBytesBin } from '../../utils/system-info.js';
import { ISpark, IExpand, IShrink, IChevDown, IMic, ISend, IStop, IPower, IDownload, IPlus, IList, ITrash, IChat, PrismMark } from './icons.jsx';
import { PrivacyBadge } from './PrivacyBadge.jsx';
import TierPanel from './TierPanel.jsx';
import GatewayCheck from './GatewayCheck.jsx';
import { verificationChecks } from '../../near/nearAiContext.js';
import { pseudonymizeForRemote, precisionFor } from '../../utils/pseudonymize.js';
import { nearAccountFacts } from '../../near/nearAccount.js';
import { describeOutbound } from '../../utils/outbound.js';
import OutboundReview from './OutboundReview.jsx';

const THINK_KEY = 'pwai.thinking';
// Default OFF to match Qwen3.5's documented behavior (reasoning is disabled by
// default on the 0.8B–9B models). Only 'on' opts into the <think> trace.
const loadThinking = () => {
  try { return localStorage.getItem(THINK_KEY) === 'on'; } catch { return false; }
};

const SUGGESTIONS = [
  'What changed in my portfolio in the last 24h?',
  'Am I overexposed to ETH?',
  'Explain my Aave health factor',
  'Any risky token approvals?',
];

const LIVE_RENDER_CHAR_LIMIT = 16000;
const LIVE_RENDER_TAIL_CHARS = 12000;
const LIVE_THINK_CHAR_LIMIT = 12000;

function clipLiveText(text, limit, tailChars = limit) {
  const value = String(text || '');
  if (value.length <= limit) return { text: value, trimmed: false };
  const tail = value.slice(-Math.min(tailChars, limit));
  return { text: `[Live preview trimmed]\n${tail}`, trimmed: true };
}

function cancelIdleTask(task) {
  if (!task) return;
  if (task.type === 'idle' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(task.id);
  } else {
    clearTimeout(task.id);
  }
}

function scheduleIdleTask(callback, timeout = 400) {
  if ('requestIdleCallback' in window) {
    return { type: 'idle', id: window.requestIdleCallback(callback, { timeout: 1200 }) };
  }
  return { type: 'timeout', id: window.setTimeout(callback, timeout) };
}

// Inline, collapsible, full-screen-able assistant. Streams from the on-device
// wllama model over the real cluster + portfolio facts. Push-to-talk uses the
// local Whisper engine (only when voice was enabled in onboarding). Keeps a
// list of conversations (Claude/ChatGPT-style) in a collapsible left sidebar.
export default function Assistant({ ctx, flow, onOpenSettings }) {
  const [tiersOpen, setTiersOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [full, setFull] = useState(false);
  const [input, setInput] = useState('');
  const [store, setStore] = useState(loadStore); // { activeId, conversations:[{id,title,msgs,updatedAt}] }
  const [running, setRunning] = useState(false);
  const [talking, setTalking] = useState(false);
  const [hint, setHint] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [thinking, setThinking] = useState(loadThinking); // Qwen <think> on/off
  const [liveMsg, setLiveMsg] = useState(null);
  // Off-device review step: { info, resolve } while the dialog is open.
  const [review, setReview] = useState(null);
  const reviewRef = useRef(null);
  const askReview = (info) => new Promise((resolve) => {
    const done = (ok) => { reviewRef.current = null; setReview(null); resolve(ok); };
    reviewRef.current = done;
    setReview({ info, resolve: done });
  });
  // Unmounting with the dialog open counts as "cancel": nothing is sent.
  useEffect(() => () => reviewRef.current?.(false), []);
  const threadRef = useRef(null);
  const recRef = useRef(null);
  const taRef = useRef(null);
  const stick = useRef(true); // whether to keep the thread pinned to the bottom
  const persistTaskRef = useRef(null);
  const liveRenderRef = useRef(null);
  const storeRenderRef = useRef(null);

  const conv = store.conversations.find((c) => c.id === store.activeId) || store.conversations[0];
  const msgs = conv?.msgs || [];

  // Mutate the ACTIVE conversation's messages. Auto-derives a title from the
  // first user line while the conversation is still untitled.
  const setMsgs = (updater) =>
    setStore((s) => {
      const conversations = s.conversations.map((c) => {
        if (c.id !== s.activeId) return c;
        const nextMsgs = typeof updater === 'function' ? updater(c.msgs) : updater;
        const title = c.title && c.title !== 'New chat' ? c.title : titleFrom(nextMsgs);
        return { ...c, msgs: nextMsgs, title, updatedAt: Date.now() };
      });
      return { ...s, conversations };
    });

  // First-token latency (prompt eval) can be a couple of minutes on CPU with
  // zero streamed output — show elapsed time so it doesn't look frozen.
  useEffect(() => {
    if (!running) { setElapsedMs(0); return; }
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [running]);

  const modelReady = flow.model.status === 'ready';
  const modelError = flow.model.status === 'error';
  const modelIdle = flow.model.status === 'idle';
  const modelName = flow.model.id ? getModel(flow.model.id)?.name : null;
  const voiceOn = flow.prefs.voiceEnabled;
  // The toggle is only meaningful for Qwen models, which honor the /no_think
  // soft switch. Persist the choice across reloads.
  // NEAR AI models stream reasoning separately; the toggle shows/hides it.
  const isQwen = /qwen/i.test(flow.model.id || '') || flow.model.mode === 'nearai';
  const toggleThinking = () =>
    setThinking((on) => {
      const next = !on;
      try { localStorage.setItem(THINK_KEY, next ? 'on' : 'off'); } catch {}
      return next;
    });

  // Persist the store once a turn settles, but defer the synchronous storage
  // write off the critical path so generation completion doesn't hitch.
  useEffect(() => {
    cancelIdleTask(persistTaskRef.current);
    persistTaskRef.current = null;
    if (running) return undefined;
    persistTaskRef.current = scheduleIdleTask(() => {
      saveStore(store);
      persistTaskRef.current = null;
    });
    return () => {
      cancelIdleTask(persistTaskRef.current);
      persistTaskRef.current = null;
    };
  }, [store, running]);

  // The sidebar is open by default in full-screen (room for it) and collapsed
  // in the inline card; the user can still toggle it either way.
  useEffect(() => { setSidebarOpen(full); }, [full]);

  // Settings → "Delete conversation history" wipes every thread.
  useEffect(() => {
    const onClear = () => setStore(clearStore());
    window.addEventListener('pwai-clear-dialogues', onClear);
    return () => window.removeEventListener('pwai-clear-dialogues', onClear);
  }, []);

  const m = flow.model;
  const pct = Math.round((m.progress || 0) * 100);
  const downloading = !modelReady && !modelError && m.progress > 0 && m.progress < 0.999;
  const sizeBytes = m.id ? getModel(m.id)?.sizeBytes : null;
  const sizeStr = sizeBytes ? ` of ${formatSize(sizeBytes)}` : '';
  // Idle → the tier chosen in prefs (unloadModel resets model.mode to 'local');
  // otherwise the tier that is actually loading/ready/failed.
  const tier = m.status === 'idle' ? (flow.prefs.inference || 'nearai') : (m.mode || 'local');
  const isExternal = tier === 'external';
  const isNearAi = tier === 'nearai';
  const statusDot = modelReady ? 'var(--pos)' : modelError ? 'var(--neg)' : 'var(--warn)';
  const statusText = modelReady
    ? isNearAi
      ? `NEAR AI TEE · attested${m.externalName ? ` · ${m.externalName}` : ''}`
      : isExternal
      ? `External API${m.externalName ? ` · ${m.externalName}` : ''}`
      : `Running locally${modelName ? ` · ${modelName}` : ''}`
    : modelError ? 'Couldn’t load AI'
    : m.status === 'idle' ? (isNearAi ? 'NEAR AI TEE — verifies on first question' : isExternal ? 'External model — connects on first question' : 'Local AI loads when you connect a wallet')
    : isNearAi ? (m.statusText || 'Verifying NEAR AI attestation…')
    : isExternal ? 'Connecting to external API…'
    : downloading ? `Downloading model… ${pct}%${sizeStr}` : 'Preparing locally…';

  // Poll device RAM/VRAM only while the local AI is actually in use (loaded,
  // loading, or generating) — the probe is server-side and mildly costly, so we
  // don't run it when the assistant is idle. The strip self-hides with no data.
  const aiActive = modelReady || m.status === 'loading' || running;
  useEffect(() => {
    if (!aiActive) return undefined;
    return startResourceMonitor();
  }, [aiActive]);

  // Auto-scroll to the newest content only when the user is already near the
  // bottom. If they've scrolled up to read earlier output, leave them there
  // instead of yanking back down on every streamed token.
  useEffect(() => {
    if (stick.current && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [msgs, liveMsg]);

  useEffect(() => {
    if (liveRenderRef.current == null) return;
    const ms = performance.now() - liveRenderRef.current;
    if (ms >= 12) console.info('[perf] assistant live render', { ms: Number(ms.toFixed(1)) });
    liveRenderRef.current = null;
  }, [liveMsg]);

  useEffect(() => {
    if (storeRenderRef.current == null) return;
    const ms = performance.now() - storeRenderRef.current;
    if (ms >= 12) console.info('[perf] assistant store render', { ms: Number(ms.toFixed(1)), msgs: msgs.length });
    storeRenderRef.current = null;
  }, [msgs]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  // Jump to the bottom when the active conversation changes.
  useEffect(() => {
    stick.current = true;
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [store.activeId]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCollapsed(false); taRef.current?.focus(); }
      if (e.key === 'Escape' && full) setFull(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  // --- conversation management (disabled while a turn is streaming) ---
  const newChat = () => {
    if (running) return;
    setStore((s) => {
      const cur = s.conversations.find((c) => c.id === s.activeId);
      if (cur && cur.msgs.length === 0) return s; // already on a fresh, empty chat
      const c = newConversation();
      return { activeId: c.id, conversations: [...s.conversations, c] };
    });
    setInput('');
  };
  const selectChat = (id) => {
    if (running) return;
    setStore((s) => ({ ...s, activeId: id }));
  };
  const deleteChat = (id) => {
    if (running) return;
    setStore((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      if (!conversations.length) {
        const c = newConversation();
        return { activeId: c.id, conversations: [c] };
      }
      const activeId = s.activeId === id ? conversations[conversations.length - 1].id : s.activeId;
      return { activeId, conversations };
    });
  };

  const toggleStoredThink = (i) =>
    setMsgs((s) => s.map((x, j) => (j === i ? { ...x, showThink: !x.showThink } : x)));

  const toggleLiveThink = () =>
    setLiveMsg((m) => (m ? { ...m, showThink: !m.showThink } : m));

  const appendUserMessage = (text) => {
    storeRenderRef.current = performance.now();
    setMsgs((m) => [...m, { role: 'user', text }]);
  };

  const appendAiMessage = (msg) => {
    storeRenderRef.current = performance.now();
    setMsgs((m) => [...m, msg]);
  };

  const appendImmediateReply = (userText, aiText) => {
    storeRenderRef.current = performance.now();
    setMsgs((m) => [
      ...m,
      { role: 'user', text: userText },
      { role: 'ai', text: aiText, think: '', isThinking: false, showThink: false, done: true },
    ]);
  };

  const send = async (raw) => {
    const text = (raw ?? input).trim();
    if (!text || running || reviewRef.current) return;
    setInput('');
    stick.current = true; // a new turn — follow it to the bottom
    if (taRef.current) taRef.current.style.height = 'auto';

    if (modelError) {
      appendImmediateReply(
        text,
        isNearAi
          ? `NEAR AI verification failed${flow.model.error ? ` (${flow.model.error})` : ''}. Nothing was sent — your question is only sent after the enclave's attestation passes. Use “Retry” above.`
          : `The AI couldn't finish loading${flow.model.error ? ` (${flow.model.error})` : ''}. Use “Retry” above to try again — this question was not sent anywhere.`
      );
      return;
    }
    if (!modelReady) {
      // The model loads lazily, so a first question is what kicks it off.
      if (flow.model.status === 'idle') flow.startModel();
      appendImmediateReply(
        text,
        isNearAi
          ? "Verifying the NEAR AI enclave first — ask again once the status shows “attested”. (This question was not sent.)"
          : "Starting your AI now — I'll answer the moment it's ready. (This question was not sent anywhere.)"
      );
      return;
    }

    // Build the prompt first: for an off-device tier the user reviews it before
    // anything is sent.
    let redacted = null; // { labels } when pseudonymized, { off: true } when sent raw off-device
    let messages;
    let restore = (s) => s;
    let sentQuestion = text;
    const remote = flow.model.mode === 'nearai' || flow.model.mode === 'external';
    try {
      const nearAccounts = nearAccountFacts(flow.nearData || []);
      const facts = {
        ...(flow.facts || {}),
        usdPortfolio: portfolioFacts(flow.portfolio),
        // usdPortfolio.holdings aggregates across accounts; this says whose is what.
        ...(nearAccounts.length ? { nearAccounts } : {}),
      };
      // Off-device tiers get pseudonymized FACTS + question; the answer is
      // mapped back to real addresses here, locally. On-device sees real data.
      if (remote && flow.prefs.redactRemote !== false) {
        const r = pseudonymizeForRemote(facts, text, { sigFigs: precisionFor(flow.prefs, flow.model.mode) });
        messages = buildAnalysisMessages(r.facts, r.question);
        restore = r.restore;
        sentQuestion = r.question;
        redacted = { labels: r.labels, sigFigs: r.sigFigs };
        if (import.meta.env.DEV) window.__lastRemotePrompt = messages; // dev-only inspection
      } else {
        messages = buildAnalysisMessages(facts, text);
        if (remote) redacted = { off: true };
      }
    } catch (e) {
      appendImmediateReply(text, `Error preparing the request: ${String(e?.message || e)}. Nothing was sent.`);
      return;
    }

    // Review step (on by default for both off-device tiers): show the exact
    // request — the same object the backend sends — and send only on "Send".
    const analyzeOpts = { thinking, reasoningBudget: flow.prefs.nearAi?.reasoningBudget };
    if (remote && flow.prefs.reviewRemote !== false) {
      const request = ctx.previewRequest?.(messages, analyzeOpts);
      if (request) {
        const ok = await askReview(describeOutbound({
          mode: flow.model.mode, request, question: sentQuestion, redacted: redacted?.off ? null : redacted,
        }));
        if (!ok) {
          appendImmediateReply(text, 'Not sent — you cancelled at the review step. Nothing left this device.');
          return;
        }
        // The tier or its settings could have changed while the dialog was
        // open; send only if the request is still exactly the one reviewed.
        const again = ctx.previewRequest?.(messages, analyzeOpts);
        if (!again || JSON.stringify(again) !== JSON.stringify(request)) {
          appendImmediateReply(text, 'Not sent — the AI tier or its settings changed during review. Ask again to review the new request.');
          return;
        }
      }
    }

    appendUserMessage(text);
    setRunning(true);
    let lastVisible = '';
    let finalText = '';
    let finalThink = '';
    let needsReload = false;
    let verification = null;
    setLiveMsg({
      role: 'ai',
      text: '',
      think: '',
      thinkPreview: [],
      isThinking: false,
      showThink: false,
      done: false,
      liveTrimmed: false,
    });
    try {
      console.info(`[assistant] Sending prompt (${messages.length} messages) via ${flow.model.mode || 'local'} backend… thinking=${thinking}${redacted?.labels != null ? ` · pseudonymized (${redacted.labels} identifiers)` : ''}`);
      const res = await ctx.analyze(messages, (rawVisible, rawThink, isThinking, _tps, rawPreview = []) => {
        const visible = restore(rawVisible);
        const think = restore(rawThink);
        const thinkPreview = rawPreview.map(restore);
        lastVisible = visible;
        finalText = visible;
        finalThink = think;
        const liveText = clipLiveText(visible, LIVE_RENDER_CHAR_LIMIT, LIVE_RENDER_TAIL_CHARS);
        const liveThink = clipLiveText(think, LIVE_THINK_CHAR_LIMIT);
        liveRenderRef.current = performance.now();
        setLiveMsg((m) => ({
          role: 'ai',
          text: liveText.text,
          think: liveThink.text,
          thinkPreview,
          isThinking,
          showThink: m?.showThink || false,
          done: false,
          liveTrimmed: liveText.trimmed || liveThink.trimmed,
        }));
      }, createThinkStreamParser, analyzeOpts);
      verification = res?.verification || null;
      // The model can burn its entire token budget inside <think> and stop
      // before emitting an answer (finish_reason === 'length'). Don't leave the
      // turn looking blank — say what happened.
      if (res?.truncated && !lastVisible.trim()) {
        finalText = '⚠️ I used my whole response budget while reasoning and didn’t reach a final answer. Try asking again, or narrow the question.';
        finalThink = '';
      } else if (res?.stopped && !finalText.trim() && !finalThink.trim()) {
        finalText = 'Generation stopped.';
      }
    } catch (e) {
      console.warn('[assistant] analyze() failed:', e);
      finalText = `Error: ${String(e.message || e)}`;
      finalThink = '';
      needsReload = !!e?.requiresReload;
      liveRenderRef.current = performance.now();
      setLiveMsg((m) => ({
        role: 'ai',
        text: finalText,
        think: '',
        thinkPreview: [],
        isThinking: false,
        showThink: m?.showThink || false,
        done: false,
        liveTrimmed: false,
      }));
      if (needsReload) await flow.unloadModel();
    } finally {
      appendAiMessage({
        role: 'ai',
        text: finalText,
        think: finalThink,
        isThinking: false,
        showThink: false,
        done: true,
        ...(verification ? { verification } : {}),
        ...(redacted ? { redacted } : {}),
      });
      setLiveMsg(null);
      setRunning(false);
    }
  };

  // push-to-talk
  const startTalk = async () => {
    if (!voiceOn || talking) return;
    try {
      recRef.current = await startRecording();
      setTalking(true);
      setHint('Listening… release to send');
    } catch (e) {
      setHint(`Mic failed: ${e.message || e}`);
    }
  };
  const endTalk = async () => {
    if (!talking) return;
    setTalking(false);
    setHint('Transcribing…');
    try {
      const blob = await recRef.current.stop();
      const text = await transcribeWhisper(blob, {});
      setHint('');
      if (text) { setInput(text); taRef.current?.focus(); }
    } catch (e) {
      setHint(`Transcription failed: ${e.message || e}`);
    }
  };

  const autoGrow = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; };

  const sortedConvs = useMemo(
    () => [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [store.conversations]
  );

  return (
    <>
      <section className={`assistant card${collapsed ? ' collapsed' : ''}${full ? ' full' : ''}`}>
        <div className="asst-head" onClick={(e) => { if (!e.target.closest('button')) setCollapsed((c) => !c); }}>
          <button className={`icon-btn sb-toggle${sidebarOpen ? ' on' : ''}`} title="Conversations"
            onClick={(e) => { e.stopPropagation(); setSidebarOpen((o) => !o); }}><IList /></button>
          <div className="ai"><PrismMark /></div>
          <div className="ttl">Wallet Assistant
            <small><span className="dot" style={{ background: statusDot }} />{statusText}</small>
          </div>
          <span className="spacer" />
          <button className="icon-btn" title="New chat" onClick={(e) => { e.stopPropagation(); newChat(); }} disabled={running}><IPlus /></button>
          {modelError && (
            <button className="btn ghost sm" title="Retry loading the local AI"
              onClick={(e) => { e.stopPropagation(); flow.retryModel(); }}>Retry</button>
          )}
          {modelReady && (
            <button className="btn ghost sm" title="Unload the model to free memory"
              onClick={(e) => { e.stopPropagation(); flow.unloadModel(); }}><IPower /> Unload</button>
          )}
          <button className="icon-btn" title="Full screen" onClick={(e) => { e.stopPropagation(); setFull((f) => !f); setCollapsed(false); }}>
            {full ? <IShrink /> : <IExpand />}
          </button>
          <button className="icon-btn" title="Collapse" onClick={(e) => { e.stopPropagation(); full ? setFull(false) : setCollapsed((c) => !c); }}>
            <span className="chev"><IChevDown /></span>
          </button>
        </div>

        <div className="asst-body">
          <div className="asst-layout">
            <aside className={`chat-sidebar${sidebarOpen ? ' open' : ''}`}>
              <button className="newchat-btn" onClick={newChat} disabled={running}><IPlus /> New chat</button>
              <div className="conv-list">
                {sortedConvs.map((c) => (
                  <div key={c.id} className={`conv-item${c.id === store.activeId ? ' active' : ''}${running ? ' locked' : ''}`}
                    onClick={() => selectChat(c.id)} title={c.title}>
                    <span className="conv-ico"><IChat /></span>
                    <span className="conv-title">{c.title || 'New chat'}</span>
                    <button className="conv-del" title="Delete conversation"
                      onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }} disabled={running}><ITrash /></button>
                  </div>
                ))}
              </div>
            </aside>

            <div className="asst-main">
              <ResourceStrip />
              <div className="chat-thread" ref={threadRef} onScroll={onThreadScroll}>
                {msgs.length === 0 && !liveMsg && (
                  <div className="empty">
                    <div className="big"><PrismMark /></div>
                    <h4>Ask about your wallets</h4>
                    <p>{isNearAi
                      ? 'Computed from your real on-chain facts, answered by an attested NEAR AI enclave — every answer comes with a receipt.'
                      : 'Computed from your real on-chain facts, answered by a model running on your device.'}</p>
                  </div>
                )}
                {msgs.map((mm, i) => mm.role === 'user' ? (
                  <UserBubble key={i} text={mm.text} />
                ) : (
                  <AssistantBubble key={i} msg={mm} onToggleThink={() => toggleStoredThink(i)} />
                ))}
                {liveMsg && (
                  <AssistantBubble
                    key="live"
                    msg={liveMsg}
                    live
                    elapsedMs={elapsedMs}
                    onToggleThink={toggleLiveThink}
                  />
                )}
              </div>

              {msgs.length === 0 && !liveMsg && (
                <div className="suggest">
                  <span className="lbl">Popular questions{!modelReady ? ' · available once the model is ready' : ''}</span>
                  {SUGGESTIONS.map((q) => (
                    <button key={q} className={`qchip${modelReady ? '' : ' disabled'}`}
                      disabled={!modelReady}
                      title={modelReady ? '' : 'Load the model to ask'}
                      onClick={() => modelReady && send(q)}>{q}</button>
                  ))}
                </div>
              )}

              <div className="chat-input">
                {modelReady ? (
                  <div className="input-wrap">
                    <div className={`wave${talking ? ' show' : ''}`}><i /><i /><i /><i /><i /></div>
                    <textarea ref={taRef} rows={1} value={input}
                      placeholder={voiceOn ? 'Ask anything, or hold the mic to talk…' : 'Ask anything about your wallets…'}
                      onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                    {isQwen && (
                      <button className={`think-btn${thinking ? ' on' : ''}`}
                        title={thinking ? 'Reasoning on — click to disable thinking' : 'Reasoning off — click to enable thinking'}
                        aria-pressed={thinking} onClick={toggleThinking}>
                        <ISpark /> Think
                      </button>
                    )}
                    <button className={`mic${talking ? ' live' : ''}`} title={voiceOn ? 'Hold to talk' : 'Enable voice in setup to use the mic'}
                      disabled={!voiceOn || running}
                      onPointerDown={(e) => { e.preventDefault(); startTalk(); }}
                      onPointerUp={endTalk} onPointerLeave={() => talking && endTalk()}>
                      <IMic />
                    </button>
                    {running ? (
                      <button className="send" title="Stop generating" style={{ background: 'var(--neg)' }} onClick={() => ctx.stop()}><IStop /></button>
                    ) : (
                      <button className="send" title="Send" disabled={!input.trim()} onClick={() => send()}><ISend /></button>
                    )}
                  </div>
                ) : (
                  // Model not ready → no prompt box; show a Load/Retry control instead
                  // so prompts can't be sent until the model is loaded.
                  <div className="model-gate">
                    {modelError ? (
                      <>
                        <span className="gate-msg err">{isNearAi ? 'NEAR AI enclave not verified — nothing was sent' : isExternal ? 'Couldn’t connect to the external model' : 'Couldn’t load the local AI'}{flow.model.error ? `: ${flow.model.error}` : ''}</span>
                        <button className="btn primary" onClick={() => flow.retryModel()}><IDownload /> {isNearAi ? 'Retry verification' : 'Retry loading'}</button>
                      </>
                    ) : modelIdle ? (
                      isNearAi ? (
                        <>
                          <span className="gate-msg">Answers come from a NEAR AI enclave. This browser verifies its attestation before anything is sent.</span>
                          <button className="btn primary" onClick={() => flow.startModel()}><IDownload /> Verify &amp; connect</button>
                        </>
                      ) : (
                        <>
                          <span className="gate-msg">The local AI isn’t loaded yet. It runs entirely on your device.</span>
                          <button className="btn primary" onClick={() => flow.startModel()}><IDownload /> Load model{sizeBytes ? ` (~${formatSize(sizeBytes)})` : ''}</button>
                        </>
                      )
                    ) : (
                      <>
                        <span className="gate-msg">{isNearAi ? (m.statusText || 'Verifying NEAR AI attestation…') : downloading ? `Downloading model… ${pct}%${sizeStr}` : 'Warming up the model…'}</span>
                        <button className="btn" disabled>
                          <span className="mini-spin" /> {downloading ? `${pct}%` : 'Warming up…'}
                        </button>
                        {/* Progress bar only during DOWNLOAD — warm-up shows just the spinner. */}
                        {downloading && <div className="gate-track"><i style={{ width: `${Math.max(4, pct)}%` }} /></div>}
                      </>
                    )}
                  </div>
                )}
                {/* No NEAR AI key yet (demo visitors, or the TEE tier picked
                    without a key): offer the key-less live gateway check. */}
                {!modelReady && !flow.prefs.nearAi?.apiKey && (flow.demo || isNearAi) && (
                  <GatewayCheck compact onOpenSettings={onOpenSettings} />
                )}
                <div className="talk-hint">{hint}</div>
                <PrivacyBadge prefs={flow.prefs} onClick={() => setTiersOpen((o) => !o)} />
                {tiersOpen && <TierPanel flow={flow} onClose={() => setTiersOpen(false)} onOpenSettings={onOpenSettings} />}
                {review && (
                  <OutboundReview
                    info={review.info}
                    reviewOn={flow.prefs.reviewRemote !== false}
                    onToggleReview={(on) => flow.updatePref({ reviewRemote: on })}
                    onCancel={() => review.resolve(false)}
                    onSend={() => review.resolve(true)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
      {full && <div className="scrim show" onClick={() => setFull(false)} />}
    </>
  );
}

// Reasoning display. While the model is actively thinking we show only the last
// couple of lines (top one faded out) so the user sees it's working without a
// wall of text; the full trace is one click away. When expanded, "Hide
// reasoning" appears both above and below so it's reachable even if the trace
// is taller than the window.
function ThinkView({ think, previewLines = [], isThinking, expanded, onToggle }) {
  if (expanded && think) {
    return (
      <div className="think-expanded">
        <button className="think-toggle" onClick={onToggle}>Hide reasoning</button>
        <div className="think-block">{think}</div>
        <button className="think-toggle" onClick={onToggle}>Hide reasoning</button>
      </div>
    );
  }
  if (isThinking) {
    return (
      <div className="think-live">
        <div className="think-live-head"><span className="mini-spin" /> Thinking…</div>
        {previewLines.length > 0 && (
          <div className="think-live-lines">
            {previewLines.map((l, i) => <div className="tl" key={i}>{l}</div>)}
          </div>
        )}
        {think && <button className="think-toggle" onClick={onToggle}>Show reasoning</button>}
      </div>
    );
  }
  if (think) {
    return <button className="think-toggle" onClick={onToggle}>Show reasoning</button>;
  }
  return null;
}

const UserBubble = memo(function UserBubble({ text }) {
  return <div className="msg user">{text}</div>;
});

const AssistantBubble = memo(function AssistantBubble({ msg, live = false, elapsedMs = 0, onToggleThink }) {
  const normalized = useMemo(() => {
    if (!msg?.text || msg.think) return msg;
    if (!/[<]\/?think[>]/i.test(msg.text)) return msg;
    const reparsed = parseThink(msg.text);
    return {
      ...msg,
      text: reparsed.visible,
      think: reparsed.think,
      isThinking: msg.done ? false : reparsed.isThinking || msg.isThinking,
      thinkPreview: msg.thinkPreview?.length ? msg.thinkPreview : reparsed.think.split('\n').map((s) => s.trim()).filter(Boolean).slice(-2),
    };
  }, [msg]);

  return (
    <div className="msg ai">
      <div className="av"><ISpark /></div>
      <div className="ai-col">
        {!normalized.done && !normalized.isThinking && !normalized.text && !normalized.think && (
          <div className="bub">
            <span className="mini-spin" />
            {' '}{elapsedMs > 3000 ? `Processing… (${Math.floor(elapsedMs / 1000)}s)` : 'Processing…'}
          </div>
        )}
        {(normalized.think || (normalized.isThinking && !normalized.done)) && (
          <ThinkView
            think={normalized.think}
            previewLines={normalized.thinkPreview || []}
            isThinking={normalized.isThinking && !normalized.done}
            expanded={!!normalized.showThink}
            onToggle={onToggleThink}
          />
        )}
        {normalized.text && (
          <div className="bub">
            {live ? <LiveTextView content={normalized.text} trimmed={normalized.liveTrimmed} /> : <MarkdownView content={normalized.text} />}
            {!normalized.done && <span className="caret" />}
          </div>
        )}
        {normalized.done && normalized.verification && <VerifiedPanel receipt={normalized.verification} />}
        {normalized.done && normalized.redacted && (
          <div className={`redact-note${normalized.redacted.off ? ' off' : ''}`}>
            {normalized.redacted.off
              ? 'Sent with real addresses and exact amounts (pseudonymization is off).'
              : `Sent pseudonymized: ${normalized.redacted.labels} identifier${normalized.redacted.labels === 1 ? '' : 's'} replaced with placeholders, ${normalized.redacted.sigFigs === 0 ? 'exact amounts' : `amounts rounded to ${normalized.redacted.sigFigs ?? 3} significant figures`}. Real addresses above were restored on this device.`}
          </div>
        )}
      </div>
    </div>
  );
});

// "Verified" receipt under a NEAR AI answer: one collapsed summary line, the
// individual checks on expand. Everything shown was checked in this browser.
const VerifiedPanel = memo(function VerifiedPanel({ receipt }) {
  const checks = verificationChecks(receipt);
  const passed = checks.filter((c) => c.ok === true).length;
  const all = passed === checks.length;
  // A failed check is shown expanded, not hidden behind a chip.
  const [open, setOpen] = useState(!all);
  const sigFailed = receipt.response && receipt.response.ok === false;
  const a = receipt.attestation;
  return (
    <div className={`verified ${all ? 'ok' : 'warn'}`}>
      <button className="verified-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="verified-mark">{all ? '✓' : '!'}</span>
        <span className="verified-ttl">{all ? 'Verified' : 'Not fully verified'} · {passed}/{checks.length} checks</span>
        <span className="verified-sub">{receipt.provider}{a?.model ? ` · ${a.model}` : ''}</span>
        <span className="chev"><IChevDown /></span>
      </button>
      {sigFailed && (
        <div className="verified-alert">
          The answer above could not be tied to the attested enclave. Treat it as unverified.
        </div>
      )}
      {open && (
        <ul className="verified-list">
          {checks.map((c) => (
            <li key={c.id} className={c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}>
              <span className="vi">{c.ok === true ? '✓' : c.ok === false ? '✗' : '–'}</span>
              <span className="vl">{c.label}</span>
              <span className="vd">{c.detail}</span>
            </li>
          ))}
          {a?.models?.[0]?.signer && (
            <li className="na meta"><span className="vi" /><span className="vl">Model signer</span><span className="vd mono">{a.models[0].signer} ({a.models[0].algo})</span></li>
          )}
          {receipt.response?.id && (
            <li className="na meta"><span className="vi" /><span className="vl">Completion id</span><span className="vd mono">{receipt.response.id}</span></li>
          )}
        </ul>
      )}
    </div>
  );
});

const LiveTextView = memo(function LiveTextView({ content, trimmed }) {
  return (
    <div className="md-live">
      <LiveMarkdownView content={content} />
      {trimmed && <span className="md-live-note">Rendering a trimmed live preview while the answer is still streaming.</span>}
    </div>
  );
});

// Live device RAM/VRAM at the top of the chat window. Subscribes to the shared
// 15s resource snapshot (server-side probe) and self-hides when no data is
// available (e.g. static hosting without the local helper server).
function ResourceStrip() {
  const [snap, setSnap] = useState(getResourceSnapshot);
  useEffect(() => subscribeResources(setSnap), []);
  if (!snap || (!snap.ram && !snap.vram)) return null;
  return (
    <div className="res-strip" aria-label="Device memory in use">
      {snap.ram && (
        <span className="res-item" title="System memory (RAM) in use">
          <span className="res-k">RAM</span>
          <span className="res-v">{fmtBytesBin(snap.ram.used)}</span>
          <span className="res-t">/ {fmtBytesBin(snap.ram.total)}</span>
        </span>
      )}
      {snap.vram && (
        <span className="res-item" title={snap.vram.name ? `${snap.vram.name} — video memory in use` : 'Video memory (VRAM) in use'}>
          <span className="res-k">VRAM</span>
          <span className="res-v">{snap.vram.used != null ? fmtBytesBin(snap.vram.used) : '—'}</span>
          <span className="res-t">/ {fmtBytesBin(snap.vram.total)}</span>
        </span>
      )}
    </div>
  );
}
