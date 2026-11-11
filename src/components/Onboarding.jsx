import Stepper from './Stepper.jsx';
import Welcome from './onboarding/Welcome.jsx';
import WalletStep from './onboarding/WalletStep.jsx';
import ClusterLoad from './onboarding/ClusterLoad.jsx';
import VoiceModal from './VoiceModal.jsx';
import { ICheck } from './dashboard/icons.jsx';

// Guided setup (re-skinned to the Quiet system): welcome → wallets →
// clusterLoad → voicePrompt → ready. The dashboard takes over once
// flow.stage === 'ready'; the AI model finishes loading in the background.
export default function Onboarding({ flow }) {
  const { stage } = flow;
  return (
    <div className="ob">
      <div className="ob-inner fade-in">
        <div className="ob-brand">
          <span className="wm">refractoo</span>
          <small>· your private defi consultant</small>
        </div>
        {stage !== 'welcome' && <Stepper stage={stage} />}

        {stage === 'welcome' && (
          <Welcome onConnect={flow.connect} busy={flow.busy} error={flow.error}
            returningCount={flow.cluster.addresses.length} />
        )}

        {stage === 'wallets' && (
          <WalletStep cluster={flow.cluster} currentAddress={flow.wallet?.address}
            onAddAnother={flow.addAnother} onContinue={flow.continueFromWallets}
            onRemove={flow.removeFromCluster} busy={flow.busy} error={flow.error} />
        )}

        {stage === 'clusterLoad' && <ClusterLoad cluster={flow.cluster} clusterData={flow.clusterData} />}

        {stage === 'voicePrompt' && (
          <>
            <div className="ob-card center">
              <div className="ob-icon" style={{ background: 'var(--pos-wash)', color: 'var(--pos)' }}><ICheck /></div>
              <div><h1>You’re all set</h1><p className="muted" style={{ marginTop: 6 }}>Your wallets are loaded. Your private AI is finishing setup in the background.</p></div>
            </div>
            <VoiceModal onEnable={() => flow.chooseVoice(true)} onSkip={() => flow.chooseVoice(false)} />
          </>
        )}
      </div>
    </div>
  );
}
