import { useEffect, useRef, useState } from 'react';
import { runSweep } from '../utils/bench-runner.js';
import { detectResources, fetchHostInfo } from '../utils/system-info.js';
import { detectGPU } from '../utils/gpu-detector.js';
import { markOrphanedSweepsInterrupted } from '../storage/benchStore.js';
import BenchSetup from './bench/BenchSetup.jsx';
import BenchLiveRun from './bench/BenchLiveRun.jsx';
import BenchResults from './bench/BenchResults.jsx';

function parseUserAgent(ua = '') {
  let browser = 'Unknown';
  let browserVersion = '';
  const patterns = [
    [/Edg\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of patterns) {
    const m = ua.match(re);
    if (m) { browser = name; browserVersion = m[1]; break; }
  }
  let os = 'Unknown';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, browserVersion, os };
}

// Best-effort, one-time device snapshot taken right as a sweep starts. Prefers
// the local helper server's /api/sysinfo (accurate free RAM/VRAM); falls back
// to browser-only signals when it's unreachable (mirrors Settings.jsx).
async function captureHardwareSnapshot() {
  const [host, browserResources, gpuInfo] = await Promise.all([
    fetchHostInfo().catch(() => null),
    detectResources().catch(() => null),
    detectGPU().catch(() => null),
  ]);
  return {
    host,
    browserResources,
    gpuInfo,
    userAgent: navigator.userAgent,
    userAgentDataPlatform: navigator.userAgentData?.platform ?? null,
    parsedBrowserOS: parseUserAgent(navigator.userAgent),
  };
}

export default function Bench() {
  const [section, setSection] = useState('benchmark'); // 'benchmark' | 'results'
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ index: 0, total: 0, combo: null });
  const [live, setLive] = useState(null);
  const [completed, setCompleted] = useState([]);
  const [lastSweepSummary, setLastSweepSummary] = useState(null);
  const abortControllerRef = useRef(null);
  const completedRef = useRef([]);
  const [resultsRefreshToken, setResultsRefreshToken] = useState(0);

  // A fresh mount of /bench means this tab has no live sweep in flight yet
  // (running starts false above) — so any sweep row still marked 'running'
  // in IndexedDB is left over from a previous tab/session that never got to
  // finish it (refresh, navigation, crash). Relabel those before the Results
  // list renders, so "running" always means "actually running right now".
  useEffect(() => {
    (async () => {
      await markOrphanedSweepsInterrupted();
      setResultsRefreshToken((t) => t + 1);
    })();
  }, []);

  // presetCombos, when given, reruns exactly those combinations (backs
  // "retry failed") instead of deriving the matrix from config.
  async function handleStart(config, presetCombos = null) {
    completedRef.current = [];
    setCompleted([]);
    setProgress({ index: 0, total: 0, combo: null });
    setLive(null);
    setLastSweepSummary(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setRunning(true);

    const hardwareSnapshot = await captureHardwareSnapshot();

    let sweepId = null;
    let failed = false;
    try {
      sweepId = await runSweep(config, hardwareSnapshot, {
        onProgress: (p) => { setProgress(p); setLive(null); },
        onLiveMetric: (m) => setLive(m),
        onCombinationResult: (run) => {
          completedRef.current = [...completedRef.current, run];
          setCompleted(completedRef.current);
        },
        signal: controller.signal,
      }, presetCombos);
    } catch (err) {
      failed = true;
      console.error('[Bench] sweep failed', err);
    }

    setRunning(false);
    setLastSweepSummary({
      id: sweepId,
      count: completedRef.current.length,
      cancelled: controller.signal.aborted,
      failed,
    });
  }

  // Reruns just the failed combinations from a past sweep, switching to the
  // live-run view. The combos are reconstructed from the failed runs' own
  // stored parameters — no need to re-derive ranges/fractions/modelArchs.
  function handleRetryFailed(sweep, failedRuns) {
    const presetCombos = failedRuns.map((r) => ({
      modelId: r.modelId, threads: r.threads, nCtx: r.nCtx, gpuLayers: r.gpuLayers,
      warmup: r.warmup, promptPreset: r.promptPreset || 'medium',
    }));
    const config = {
      iterations: sweep.config?.iterations || 1,
      targetTokens: sweep.config?.targetTokens || 128,
      retryOf: sweep.id,
    };
    setSection('benchmark');
    handleStart(config, presetCombos);
  }

  function handleCancel() {
    console.info('[Bench] Sweep cancel requested by user');
    abortControllerRef.current?.abort();
  }

  return (
    <div className="app bench-page">
      <div className="toolbar bench-toolbar">
        <h1 className="bench-title">Benchmark</h1>
        <span className="spacer" />
        <div className="seg" role="tablist" aria-label="Bench section">
          <button role="tab" aria-selected={section === 'benchmark'} className={section === 'benchmark' ? 'on' : ''}
            onClick={() => setSection('benchmark')}>Benchmark</button>
          <button role="tab" aria-selected={section === 'results'} className={section === 'results' ? 'on' : ''}
            onClick={() => setSection('results')}>Results</button>
        </div>
      </div>

      {section === 'benchmark' ? (
        running ? (
          <BenchLiveRun progress={progress} live={live} completed={completed} onCancel={handleCancel} />
        ) : (
          <div className="app-stack">
            {lastSweepSummary && (
              <div className="card bench-done-banner">
                <div className="card-pad bench-done-row">
                  <p>
                    {lastSweepSummary.cancelled ? 'Sweep cancelled' : lastSweepSummary.failed ? 'Sweep stopped early' : 'Sweep finished'}
                    {' — '}{lastSweepSummary.count} run{lastSweepSummary.count === 1 ? '' : 's'} recorded.
                  </p>
                  <button className="btn sm" onClick={() => setSection('results')}>View results</button>
                </div>
              </div>
            )}
            <BenchSetup onStart={handleStart} />
          </div>
        )
      ) : (
        <BenchResults refreshToken={resultsRefreshToken} onRetryFailed={handleRetryFailed} />
      )}
    </div>
  );
}
