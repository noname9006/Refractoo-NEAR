import { IMic, IShield } from './dashboard/icons.jsx';

export default function VoiceModal({ onEnable, onSkip }) {
  return (
    <div className="modal-scrim">
      <div className="modal fade-in">
        <span className="badge-accent"><IMic /> Optional voice input</span>
        <h2>Enable voice input?</h2>
        <p className="lead">
          Ask questions by speaking instead of typing. We’ll download a small speech model
          (~75 MB) the first time — it runs entirely on your device, with noise reduction built in.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onSkip}>Not now</button>
          <button className="btn primary" onClick={onEnable}>Enable voice</button>
        </div>
        <div className="modal-fine"><IShield style={{ color: 'var(--accent)' }} /> Runs locally · you can change this later in Details.</div>
      </div>
    </div>
  );
}
