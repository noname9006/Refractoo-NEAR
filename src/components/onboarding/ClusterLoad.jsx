import { shortAddr } from '../dashboard/format.js';
import { ICheck } from '../dashboard/icons.jsx';

export default function ClusterLoad({ cluster, clusterData }) {
  const addresses = cluster.addresses || [];
  const loaded = (a) => clusterData[a] && !clusterData[a].error;
  return (
    <div className="ob-card">
      <div className="center">
        <h2>Loading your cluster</h2>
        <p className="muted">
          Fetching on-chain activity for {addresses.length} wallet{addresses.length === 1 ? '' : 's'} across Ethereum and L2s.
        </p>
      </div>
      <div className="ob-list">
        {addresses.map((a) => (
          <div className="item" key={a}>
            <code className="mono">{shortAddr(a)}</code>
            {loaded(a)
              ? <span className="badge ok"><span className="dot" /> loaded</span>
              : <span className="mini-spin" />}
          </div>
        ))}
      </div>
    </div>
  );
}
