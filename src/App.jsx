import { useRef } from 'react';
import { InferenceRouter } from './utils/inference-router.js';
import { useAppFlow } from './state/useAppFlow.js';
import Onboarding from './components/Onboarding.jsx';
import Dashboard from './components/Dashboard.jsx';
import Landing from './components/Landing.jsx';
import Bench from './components/Bench.jsx';

export default function App() {
  // Three pages: the marketing landing at "/", the app flow at "/app", and
  // the model benchmark tool at "/bench". Bench returns before
  // InferenceRouter/useAppFlow are constructed below so visiting it never
  // touches the main app's onboarding/model-recommendation flow.
  const path = window.location.pathname;
  if (path === '/bench' || path.startsWith('/bench/')) return <Bench />;

  const isApp = path === '/app' || path.startsWith('/app/');

  // One long-lived inference context for the whole session (routes to the
  // on-device model or an external API depending on prefs).
  const ctxRef = useRef(null);
  if (!ctxRef.current) ctxRef.current = new InferenceRouter();

  const flow = useAppFlow(ctxRef.current, { initialStage: isApp ? 'ready' : 'welcome' });

  if (!isApp) return <Landing />;

  return flow.stage === 'ready'
    ? <Dashboard ctx={ctxRef.current} flow={flow} />
    : <Onboarding flow={flow} />;
}
