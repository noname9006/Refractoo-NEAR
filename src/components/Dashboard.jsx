import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterPortfolioView } from '../analytics/portfolio.js';
import { getLayout, setLayout } from '../storage/local.js';
import { VIEW_CHAIN_IDS } from '../config/networks.js';
import TopBar from './dashboard/TopBar.jsx';
import Toolbar from './dashboard/Toolbar.jsx';
import PortfolioSummary from './dashboard/PortfolioSummary.jsx';
import Assistant from './dashboard/Assistant.jsx';
import Holdings from './dashboard/Holdings.jsx';
import DefiPositions from './dashboard/DefiPositions.jsx';
import Shielded from './dashboard/Shielded.jsx';
import Activity from './dashboard/Activity.jsx';
import SpendingCaps from './dashboard/SpendingCaps.jsx';
import SortableCard from './dashboard/DraggableCard.jsx';
import DetailsDrawer from './DetailsDrawer.jsx';
import ConnectOverlay from './ConnectOverlay.jsx';
import NavPanel from './dashboard/NavPanel.jsx';
import Settings from './Settings.jsx';

// Chains available in the active network profile (mainnet or testnet).
const ALL_CHAINS = VIEW_CHAIN_IDS; // EVM chains + NEAR (read by account name)

// Card slot order: the first COL1_SLOTS entries fill the wide left column, the
// rest the right one. Bumped to v2 when the Shielded card made it five cards —
// a persisted v1 array has four entries and would fail validation below anyway,
// but the new key means an old layout is ignored rather than half-restored.
const CARD_ORDER_KEY = 'card_order_v2';
const DEFAULT_ORDER = ['holdings', 'shielded', 'defi', 'activity', 'caps'];
const COL1_SLOTS = 3;
const loadOrder = () => {
  try {
    const o = JSON.parse(localStorage.getItem(CARD_ORDER_KEY));
    if (
      Array.isArray(o) &&
      o.length === DEFAULT_ORDER.length &&
      DEFAULT_ORDER.every((id) => o.includes(id))
    ) {
      return o;
    }
  } catch {}
  return DEFAULT_ORDER;
};

export default function Dashboard({ ctx, flow }) {
  const [selectedChains, setSelectedChains] = useState(() => new Set(ALL_CHAINS));
  const [selectedWallets, setSelectedWallets] = useState(() => new Set());
  const [colRatio, setColRatio] = useState(() => getLayout().colRatio);
  const [dragging, setDragging] = useState(false);
  const [cardOrder, setCardOrder] = useState(loadOrder);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const columnsRef = useRef(null);
  const knownRef = useRef(null);

  // Swap two cards' slots when one is dropped on the other; persist the order.
  const swapCards = useCallback((from, to) => {
    setCardOrder((prev) => {
      const a = prev.indexOf(from);
      const b = prev.indexOf(to);
      if (a < 0 || b < 0) return prev;
      const next = [...prev];
      next[a] = to;
      next[b] = from;
      try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const reset = () => {
      setCardOrder(DEFAULT_ORDER);
      // Matches the old 1.5:1 flex ratio = 60% left column.
      setColRatio(setLayout({ colRatio: 3 / 5 }).colRatio);
    };
    window.addEventListener('reset-card-layout', reset);
    return () => window.removeEventListener('reset-card-layout', reset);
  }, []);

  const addresses = flow.cluster.addresses || [];
  // Wallet ids for selection/filtering: EVM addresses + NEAR account names.
  const walletIds = [...addresses, ...(flow.cluster.nearAccounts || [])];
  useEffect(() => {
    const addrs = walletIds.map((a) => a.toLowerCase());
    setSelectedWallets((prev) => {
      if (knownRef.current === null) { knownRef.current = new Set(addrs); return new Set(addrs); }
      const next = new Set([...prev].filter((a) => addrs.includes(a)));
      for (const a of addrs) if (!knownRef.current.has(a)) next.add(a);
      knownRef.current = new Set(addrs);
      return next;
    });
  }, [walletIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking a chain isolates it; clicking the already-isolated chain again
  // restores the full selection.
  const toggleChain = (id) =>
    setSelectedChains((s) => (s.size === 1 && s.has(id) ? new Set(ALL_CHAINS) : new Set([id])));
  const toggleAll = () => setSelectedChains(new Set(ALL_CHAINS));
  const toggleWallet = (addr) =>
    setSelectedWallets((s) => { const a = addr.toLowerCase(); const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n; });

  const view = useMemo(() => {
    const list = selectedWallets.size ? [...selectedWallets] : walletIds;
    return filterPortfolioView(flow.rebuildView(list), selectedChains);
  }, [flow.portfolio, flow.rebuildView, selectedWallets, selectedChains, walletIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Column drag-to-resize
  const startDrag = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
    let ratio = colRatio;
    const onMove = (ev) => {
      if (!columnsRef.current) return;
      const rect = columnsRef.current.getBoundingClientRect();
      ratio = Math.max(0.25, Math.min(0.75, (ev.clientX - rect.left) / rect.width));
      setColRatio(ratio);
    };
    const onUp = () => {
      setDragging(false);
      setLayout({ colRatio: ratio });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [colRatio]);

  // True while enrichment / pricing is running or before the first portfolio
  // build completes. Cards use this to show skeleton rows instead of "no data".
  const loading = flow.pricing || !flow.portfolio;

  // Per-section "updating data…" chips: each card spins only until its own data
  // settles (see flow.refreshing), so a card stops as soon as it's current.
  const r = flow.refreshing;

  const cardEls = {
    holdings: <Holdings view={view} loading={loading} updating={r.holdings} smallUsd={flow.prefs.smallBalanceUsd} />,
    shielded: <Shielded flow={flow} view={view} updating={r.shielded} />,
    defi: <DefiPositions view={view} loading={loading} updating={r.defi} />,
    activity: <Activity flow={flow} selectedChains={selectedChains} selectedWallets={selectedWallets} loading={loading} updating={r.activity} />,
    caps: <SpendingCaps flow={flow} view={view} loading={loading} updating={r.caps} />,
  };

  // No wallet yet → focused connect/demo overlay instead of a dead $0 dashboard.
  const noWallets = walletIds.length === 0;

  return (
    <>
      <TopBar flow={flow} onOpenSettings={() => setSettingsOpen(true)} />
      {noWallets && <ConnectOverlay flow={flow} />}
      {!noWallets && <NavPanel onOpenSettings={() => setSettingsOpen(true)} />}
      <main className="app">
        <Toolbar flow={flow} selectedChains={selectedChains} onToggleChain={toggleChain} onToggleAll={toggleAll}
          selectedWallets={selectedWallets} onToggleWallet={toggleWallet} />
        <div className="app-stack">
          <div id="sec-summary"><PortfolioSummary flow={flow} view={view} /></div>
          <div id="sec-assistant"><Assistant ctx={ctx} flow={flow} onOpenSettings={() => setSettingsOpen(true)} /></div>
          <div className="columns" ref={columnsRef}>
            <div className="col" style={{ flex: `${colRatio} 1 0` }}>
              {cardOrder.slice(0, COL1_SLOTS).map((id) => (
                <SortableCard key={id} id={id} onDropCard={swapCards}>{cardEls[id]}</SortableCard>
              ))}
            </div>
            <div className={`col-drag${dragging ? ' dragging' : ''}`} onPointerDown={startDrag} title="Drag to resize" />
            <div className="col" style={{ flex: `${1 - colRatio} 1 0` }}>
              {cardOrder.slice(COL1_SLOTS).map((id) => (
                <SortableCard key={id} id={id} onDropCard={swapCards}>{cardEls[id]}</SortableCard>
              ))}
            </div>
          </div>
          <div id="sec-details"><DetailsDrawer flow={flow} /></div>
        </div>
      </main>
      {settingsOpen && <Settings flow={flow} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
