import { useState } from 'react';
import { amount, usdHolding, shortAddr, explorerAddr, chainMeta, originChainName } from './format.js';
import TokenIcon from './TokenIcon.jsx';
import { symbolName } from '../../data/coinIcons.js';
import { IChevDown, IUnlock, ILock } from './icons.jsx';
import { getLayout, setCardCollapsed } from '../../storage/local.js';
import { TRUST } from '../../fhe/index.js';
import { MODE } from '../../config/networks.js';
import { fheApps } from '../../data/fheApps.js';
import { STACK_ID as NEAR_STACK, intentsConfigured } from '../../near/confidentialIntents.js';
import { historyNote } from '../../near/historyNote.js';
import { looksLikeInjection } from '../../prompts/untrusted.js';

// Confidential (shielded) token balances, across every FHE stack the active
// network profile supports — Zama Protocol, Fhenix CoFHE, Inco Lightning.
//
// The central rule this card exists to express: an encrypted balance has an
// UNKNOWN amount, not a zero one. Discovery proves a ciphertext exists for the
// wallet; only an explicit reveal (a wallet signature plus a decryption
// round-trip) produces a number. So encrypted rows show "•••••" and no value,
// and nothing here ever estimates.
export default function Shielded({ flow, view, updating }) {
  const [collapsed, setCollapsed] = useState(() => getLayout().collapsed.shielded ?? false);
  const toggleCollapsed = () => setCollapsed((c) => { setCardCollapsed('shielded', !c); return !c; });
  const [busyKey, setBusyKey] = useState(null);
  const [showTrust, setShowTrust] = useState(false);

  const all = view?.shielded || [];
  // FHE-stack rows (per-token reveal) and NEAR private-shard rows (one sign-in
  // for the whole account) behave differently, so they render as two blocks.
  const tokens = all.filter((t) => t.stack !== NEAR_STACK);
  const nearRows = all.filter((t) => t.stack === NEAR_STACK);
  const stacks = flow.shieldedStacks || [];
  const encrypted = tokens.filter((t) => t.state === 'encrypted');
  const hasWallet = !!flow.wallet;

  // Stacks that are present but unusable, so "nothing here" can be explained
  // rather than looking like an empty result.
  const unconfigured = stacks.filter((s) => !s.configured);
  const failed = stacks.filter((s) => s.configured && !s.ok && s.error);
  const trustKinds = [...new Set(tokens.map((t) => stackTrust(t.stack)))].filter(Boolean);
  const apps = fheApps(MODE, [...new Set(stacks.map((s) => s.id))]);

  const revealOne = async (t) => {
    setBusyKey(t.key);
    try {
      await flow.revealShieldedToken(t);
    } catch {
      // revealShielded records recoverable failures on the row itself; only a
      // precondition (no signer) throws, and the button is disabled for that.
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-h card-h-btn" onClick={toggleCollapsed}>
        <h3>Shielded balances</h3>
        {updating && <span className="synced"><span className="mini-spin" />scanning…</span>}
        <span className="spacer" />
        {all.length > 0 && (
          <span className="count">
            {all.length} found{encrypted.length ? ` · ${encrypted.length} encrypted` : ''}
          </span>
        )}
        <button className="icon-btn" aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}>
          <span className="chev"><IChevDown /></span>
        </button>
      </div>

      {!collapsed && (
        <>
          {tokens.length === 0 && (
            <div className="list">
              <div className="empty-note">
                {updating
                  ? 'Scanning for confidential token balances…'
                  : 'No confidential token balances found for these wallets.'}
                {unconfigured.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    Not configured: {unconfigured.map((s) => `${s.name} (${s.chainName})`).join(', ')}.
                  </div>
                )}
                {failed.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    Could not scan: {failed.map((s) => `${s.name} — ${s.error}`).join('; ')}
                  </div>
                )}
              </div>
            </div>
          )}

          {tokens.length > 0 && (
            <>
              {encrypted.length > 1 && (
                <div className="shield-actions">
                  <button className="btn ghost sm" disabled={!hasWallet || !!busyKey}
                    title={hasWallet
                      ? 'Reveal every encrypted balance — one wallet signature per token'
                      : 'Connect a wallet to reveal confidential balances'}
                    onClick={flow.revealAllShielded}>
                    <IUnlock /> Reveal all ({encrypted.length})
                  </button>
                </div>
              )}

              <div className="list">
                {tokens.map((t) => {
                  const busy = busyKey === t.key || t.state === 'revealing';
                  const link = explorerAddr(t.chainId, t.address);
                  return (
                    <div className="shield-row" key={t.key}>
                      <div className="proto" title={`${t.name} · ${stackName(t.stack, stacks)}`}>🔒</div>
                      <div className="shield-main">
                        <div className="nm">
                          {t.symbol}
                          <span className="tag">{chainMeta(t.chainId).name}</span>
                          <span className="tag">{stackName(t.stack, stacks)}</span>
                        </div>
                        <div className="sub">
                          {link ? (
                            <a href={link} target="_blank" rel="noreferrer noopener">{shortAddr(t.address)}</a>
                          ) : shortAddr(t.address)}
                          {flow.cluster.addresses.length > 1 && <> · {shortAddr(t.wallet)}</>}
                          {t.state === 'error' && <> · <span className="warn">{t.error}</span></>}
                        </div>
                      </div>
                      <span className="spacer" />
                      <div className="shield-vals">
                        {t.state === 'revealed' ? (
                          <>
                            <div className="num" style={{ fontWeight: 600 }}>{usdHolding(t.usd)}</div>
                            <div className="sub num">{amount(t.amount)} {t.symbol}</div>
                          </>
                        ) : (
                          <>
                            <div className="num shield-masked" title="Encrypted on-chain — amount unknown until revealed">•••••</div>
                            <div className="sub">encrypted</div>
                          </>
                        )}
                      </div>
                      {t.state === 'revealed' ? (
                        <span className="shield-btn done" title="Revealed in this browser · never stored"><ILock /></span>
                      ) : (
                        <button className="shield-btn" disabled={!hasWallet || busy}
                          title={hasWallet
                            ? 'Reveal this balance — decrypted in your browser via a wallet signature'
                            : 'Connect a wallet to reveal confidential balances'}
                          aria-label={`Reveal ${t.symbol} balance`}
                          onClick={() => revealOne(t)}>
                          {busy ? <span className="mini-spin" /> : <IUnlock />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Honest disclosure, not decoration. Revealing contacts a
                  decryption service, and the trust model differs per stack. */}
              <div className="shield-foot">
                <button className="linkish" onClick={() => setShowTrust((v) => !v)}>
                  {showTrust ? 'Hide' : 'How revealing works'}
                </button>
                {showTrust && (
                  <div className="shield-trust">
                    <p>
                      Amounts are decrypted <strong>in this browser</strong> and held in memory for
                      this session only — never written to disk, never sent anywhere. Reloading the
                      page re-encrypts the view.
                    </p>
                    <p>
                      Revealing does contact the stack's decryption service. It cannot read your
                      amount, but it does learn <strong>which confidential balance you asked
                      about</strong>, from your address.
                    </p>
                    {trustKinds.map((k) => (
                      <p key={k}><strong>{TRUST[k].short}:</strong> {TRUST[k].detail}</p>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <NearIntentsBlock flow={flow} rows={nearRows} hasWallet={hasWallet} />

          {/* Where to actually use confidential tokens. Links only — these are
              not the user's positions and carry no numbers (see data/fheApps.js). */}
          {apps.length > 0 && (
            <div className="shield-apps">
              <div className="shield-apps-h">Confidential apps</div>
              {apps.map((a) => (
                <a className="shield-app" key={a.url} href={a.url} target="_blank" rel="noreferrer noopener">
                  <div className="shield-app-nm">{a.name}<span className="tag">{a.category}</span></div>
                  <div className="sub">{a.what}</div>
                </a>
              ))}
              <div className="empty-note" style={{ paddingTop: 6 }}>
                Links only — not your positions. Confidential balances above are the
                one confidential holding this app can actually read.
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// NEAR Confidential Intents: balances on NEAR's private shard. Unlike the FHE
// stacks there is nothing to discover publicly — the shard is invisible from
// outside — so the block starts locked and one wallet signature (a no-op intent
// that moves nothing) reads every private balance at once.
function NearIntentsBlock({ flow, rows, hasWallet }) {
  const [showTrust, setShowTrust] = useState(false);
  const ni = flow.nearIntents || { status: 'idle' };
  const signing = ni.status === 'signing';
  // Demo without a wallet: an extra button shows labelled sample data.
  const demoMode = !!flow.demo && !hasWallet;
  const apiKeySet = intentsConfigured();
  const run = (via) => flow.unlockNearIntents(via).catch(() => {});
  const total = rows.reduce((s, t) => s + (Number.isFinite(t.usd) ? t.usd : 0), 0);

  return (
    <div className="near-intents">
      <div className="shield-apps-h">NEAR Confidential Intents · private shard</div>

      {ni.status !== 'unlocked' && (
        <div className="list">
          <div className="empty-note">
            Since Aug 2026 NEAR Intents balances are confidential by default — invisible to
            explorers and to this app until you prove you own them.
            {ni.status === 'error' && <div className="warn" style={{ marginTop: 6 }}>{ni.error}</div>}
            {ni.expired && ni.status === 'idle' && (
              <div className="warn" style={{ marginTop: 6 }}>Your NEAR Intents session expired. Sign in again to keep balances updating.</div>
            )}
          </div>
          <div className="shield-actions">
            {/* NEAR wallet: NEP-413 signMessage of an empty intent. */}
            <button className="btn ghost sm" disabled={!apiKeySet || signing}
              title={apiKeySet
                ? 'Connect a NEAR wallet and sign an empty intent (NEP-413, moves nothing) to read your private-shard balances'
                : 'NEAR Intents API key is not configured'}
              onClick={() => run('near')}>
              {signing && ni.via === 'near' ? <span className="mini-spin" /> : <IUnlock />} Sign with NEAR wallet
            </button>
            {/* EVM wallet: ERC-191 personal_sign of an empty intent. */}
            {hasWallet && (
              <button className="btn ghost sm" disabled={!apiKeySet || signing}
                title={apiKeySet ? 'Sign an empty intent with your EVM wallet (ERC-191, moves nothing)' : 'NEAR Intents API key is not configured'}
                onClick={() => run('evm')}>
                {signing && ni.via !== 'near' ? <span className="mini-spin" /> : <IUnlock />} Sign with EVM wallet
              </button>
            )}
            {demoMode && (
              <button className="btn ghost sm" disabled={signing}
                title="Demo: shows SAMPLE private-shard balances — no signature, nothing read"
                onClick={() => run('evm')}>
                <IUnlock /> Show sample private balances (demo)
              </button>
            )}
          </div>
        </div>
      )}

      {ni.status === 'unlocked' && (
        <div className="list">
          {ni.demo && (
            <div className="demo-note">
              <strong>Sample data.</strong> In the demo no wallet signs anything, so these private-shard
              balances are illustrative. With a wallet connected, one signature of an empty intent
              reads your real ones.
            </div>
          )}
          {rows.length === 0 && (
            <div className="empty-note">No balances on the private shard for {String(ni.address).startsWith("0x") ? shortAddr(ni.address) : ni.address}.</div>
          )}
          {rows.map((t) => {
            // Token text that reads like instructions or a link: shown here as
            // what it is, and withheld from every AI prompt (prompts/untrusted.js).
            const hostile = looksLikeInjection(t.symbol) || looksLikeInjection(t.name);
            const sym = hostile ? 'tokens' : t.symbol;
            return (
            <div className="shield-row" key={t.key}>
              <TokenIcon chainId="near" symbol={hostile ? '?' : t.symbol} bySymbol locked />
              <div className="shield-main">
                <div className="nm">
                  {hostile ? 'Suspicious token' : <>{symbolName(t.symbol)} <span className="tag">{t.symbol}</span></>}
                  {hostile && <span className="tag warn-tag" title="Its name reads like instructions to an AI. It is never put in a prompt.">withheld from AI</span>}
                  {t.demo && <span className="tag demo-tag">sample</span>}
                </div>
                {hostile && <div className="sub hostile-name" title={t.symbol}>Name: “{t.symbol}”</div>}
                <div className="sub num">
                  {t.amount != null ? `${amount(t.amount)} ${sym}` : `${t.rawAmount} raw`} · {originChainName(t.originChain)}
                  {t.state === 'error' && <> · <span className="warn">{t.error}</span></>}
                </div>
              </div>
              <span className="spacer" />
              <div className="shield-vals">
                <div className="num" style={{ fontWeight: 600 }}>{usdHolding(t.usd)}</div>

              </div>
              <span className="shield-btn done" title="Read in this browser · never stored"><ILock /></span>
            </div>
            );
          })}
          {rows.length > 0 && (
            <div className="empty-note" style={{ paddingTop: 6 }}>
              {rows.length} private balance{rows.length === 1 ? '' : 's'} · {usdHolding(total)}
              {ni.historyStatus?.state === 'ok' && Array.isArray(ni.history)
                ? <> · {ni.history.length} item{ni.history.length === 1 ? '' : 's'} in history</>
                : historyNote(ni.historyStatus) && <> · <span title={historyNote(ni.historyStatus).body}>{historyNote(ni.historyStatus).short}</span></>}
            </div>
          )}
          {!ni.demo && ni.refreshError && (
            <div className="empty-note" style={{ paddingTop: 2 }}>
              <span className="warn">Last refresh failed: {ni.refreshError}</span>
            </div>
          )}
        </div>
      )}

      <div className="shield-foot">
        <button className="linkish" onClick={() => setShowTrust((v) => !v)}>
          {showTrust ? 'Hide' : 'Who can see these balances'}
        </button>
        {showTrust && (
          <div className="shield-trust">
            <p>
              <strong>Public, explorers, other apps:</strong> nothing. The private shard is not
              readable from outside.
            </p>
            <p>
              <strong>The signature</strong> signs an empty intent list — it authorizes no transfer
              and moves no funds. It only proves you control this address.
            </p>
            <p>
              <strong>NEAR Intents API (Aurora)</strong> serves the balances, so it sees your address
              and amounts. The shard's permissioned validators run in TEEs and see its state — a
              hardware trust assumption.
            </p>
            <p>
              <strong>This app:</strong> amounts and the session stay in this browser's memory for
              this page load only. Our server never sees them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const stackName = (id, stacks) => stacks.find((s) => s.id === id)?.name || id;

// Trust model per stack id. Kept here rather than on the token so the adapter
// stays the single source for its own meta (see src/fhe/index.js → TRUST).
const stackTrust = (id) => (id === 'inco' ? 'tee' : 'threshold-fhe');

