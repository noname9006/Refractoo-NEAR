// Portfolio value sparkline. Smooth Catmull-Rom curve, hover crosshair with
// value tooltip, and dotted high/low guides showing the period's range.
// H/L labels and the range selector are rendered by the parent (sum-chart).
import { useState, useRef, useEffect } from 'react';
import { usd } from './format.js';

// Catmull-Rom → cubic Bezier so the line is a continuous smooth curve.
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    // DeBank-style: nearly straight segments with only a hint of rounding
    // (divisor 14 → 60 flattens the curve to keep the jagged, honest look).
    const c1x = p1[0] + (p2[0] - p0[0]) / 60;
    const c1y = p1[1] + (p2[1] - p0[1]) / 60;
    const c2x = p2[0] - (p3[0] - p1[0]) / 60;
    const c2y = p2[1] - (p3[1] - p1[1]) / 60;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export default function Sparkline({ series, loading, drawKey }) {
  const W = 160, H = 80, pad = 6;
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null); // { pctX, svgX, svgY, value, date } | null

  const pts = (series || []).filter((p) => isFinite(p.value));
  const targetVals = pts.map((p) => p.value);
  const valsKey = targetVals.join(',');

  // Chart animation logic:
  //   1. On load the chart appears as-is — the cached curve, shown immediately
  //      with no draw-in (so it looks "as it was" from the previous session).
  //   2. As the data updates within the SAME timeframe, the line MORPHS to the
  //      new values (rises/falls into place) rather than being recreated.
  // dispVals is what's actually drawn; it snaps on load / timeframe change and
  // tweens toward targetVals on a same-timeframe value refresh.
  const [dispVals, setDispVals] = useState(targetVals);
  const rafRef = useRef(0);
  const dispRef = useRef(dispVals);
  dispRef.current = dispVals;
  const keyRef = useRef(drawKey);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = dispRef.current;
    // Timeframe change, first paint, or any point-count change → snap to the new
    // curve immediately (show the cached/new shape as-is, no draw-in animation).
    if (keyRef.current !== drawKey || from.length !== targetVals.length) {
      keyRef.current = drawKey;
      setDispVals(targetVals);
      return;
    }
    if (!targetVals.length || from.every((v, i) => v === targetVals[i])) return;
    // Same timeframe & point count, new values → morph the line up/down.
    const to = targetVals;
    const start = from.slice();
    const dur = 450;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      setDispVals(to.map((v, i) => start[i] + (v - start[i]) * e));
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawKey, valsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  let basePts = [[0, H / 2], [W, H / 2]];
  let scaledPts = [], minY = H / 2, maxY = H / 2;
  const hasData = dispVals.length >= 2;

  if (hasData) {
    let min = Math.min(...dispVals), max = Math.max(...dispVals);
    if (max - min < 1e-9) { max += 1; min -= 1; }
    const xFn = (i) => (i / (dispVals.length - 1)) * W;
    const yFn = (v) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
    basePts = dispVals.map((v, i) => [xFn(i), yFn(v)]);
    scaledPts = basePts;
    minY = yFn(min); maxY = yFn(max);
  }

  // Only draw the curve/area when we actually have data — never fall back to the
  // flat baseline (a straight line through the middle reads as a real, bogus
  // chart). With no data the SVG paths are empty and the loading/empty state shows.
  const line = hasData ? smoothPath(basePts) : '';
  const area = hasData ? `${line} L${W},${H} L0,${H} Z` : '';

  const onMove = (e) => {
    if (!hasData || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pctX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const fi = pctX * (scaledPts.length - 1);
    const i0 = Math.min(scaledPts.length - 2, Math.floor(fi));
    const t = fi - i0;
    const svgY = scaledPts[i0][1] + t * (scaledPts[i0 + 1][1] - scaledPts[i0][1]);
    const val = pts[i0].value + t * (pts[i0 + 1].value - pts[i0].value);
    const ni = Math.max(0, Math.min(pts.length - 1, Math.round(fi)));
    const date = pts[ni]?.t
      ? new Date(pts[ni].t * 1000).toLocaleString('en-US',
          drawKey === '24H' || drawKey === '7D' || drawKey === '30D'
            ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
            : { month: 'short', day: 'numeric' })
      : null;
    setHover({ pctX, svgX: pctX * W, svgY, value: val, date });
  };

  // End-point dot position (last data point), always visible when there's data.
  const endY = hasData ? scaledPts[scaledPts.length - 1][1] : null;

  return (
    // chart-col: grows to fill sum-chart, SVG fills it via width/height:100%
    <div className="chart-col" ref={svgRef}
        style={{ cursor: hasData ? 'crosshair' : 'default' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg className="trend" viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.20" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Area fill + smooth line. No draw-in: the curve appears as-is on load
              and morphs in place on value updates (see the tween above). */}
          <g>
            <path fill="url(#tg)" d={area} />
            <path fill="none" stroke="currentColor" strokeWidth="1"
              strokeLinejoin="round" strokeLinecap="round" d={line} />
          </g>

          {/* High / low dotted guides */}
          {hasData && (
            <>
              <line x1="0" y1={maxY} x2={W} y2={maxY}
                stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" strokeOpacity="0.28" />
              <line x1="0" y1={minY} x2={W} y2={minY}
                stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" strokeOpacity="0.28" />
            </>
          )}

          {/* Hover: vertical rule (dot is HTML so it stays a circle regardless of SVG scaling) */}
          {hover && (
            <line x1={hover.svgX} y1={0} x2={hover.svgX} y2={H}
              stroke="currentColor" strokeWidth="1" strokeOpacity="0.35" />
          )}
        </svg>

        {/* Loading overlay — shown while data is in-flight and chart is empty */}
        {loading && !hasData && (
          <div className="chart-loading-overlay">
            <span className="mini-spin" />
          </div>
        )}

        {/* End-point dot — HTML so it's always a perfect circle */}
        {hasData && endY != null && !hover && (
          <div className="chart-end-dot"
            style={{ left: '100%', top: `${(endY / H) * 100}%` }} />
        )}

        {/* Hover dot — HTML, perfect circle, replaces end-dot while hovering */}
        {hover && (
          <div className="hover-dot"
            style={{ left: `${hover.pctX * 100}%`, top: `${(hover.svgY / H) * 100}%` }} />
        )}

        {/* Value + date tooltip */}
        {hover && (
          <div className="chart-tip"
            style={{ left: `clamp(30px, ${hover.pctX * 100}%, calc(100% - 30px))` }}>
            <span className="chart-tip-val">{usd(hover.value)}</span>
            {hover.date && <span className="chart-tip-date">{hover.date}</span>}
          </div>
        )}
      </div>
  );
}
