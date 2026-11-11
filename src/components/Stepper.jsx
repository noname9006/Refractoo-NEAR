const STEPS = ['wallets', 'clusterLoad', 'voicePrompt'];
const stageToIndex = { welcome: 0, wallets: 0, clusterLoad: 1, voicePrompt: 2, ready: 3 };

export default function Stepper({ stage }) {
  const current = stageToIndex[stage] ?? 0;
  return (
    <div className="stepper" aria-hidden="true">
      {STEPS.map((s, i) => (
        <span key={s} className={`step ${i < current ? 'done' : i === current ? 'active' : ''}`} />
      ))}
    </div>
  );
}
