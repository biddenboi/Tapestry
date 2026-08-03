import { useState } from 'react';
import { continueInThisInstance } from '@shared/runtime/InstanceHandoff.js';
import './InstanceStandbyGate.css';

export default function InstanceStandbyGate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resume = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await continueInThisInstance();
    } catch (resumeError) {
      setError(resumeError?.message || 'Tapestry could not resume in this window.');
      setBusy(false);
    }
  };
  return (
    <main className="instance-standby-gate">
      <div>
        <span>Storage handoff complete</span>
        <h1>Tapestry continued in another window.</h1>
        <p>This copy is resting so the other window can safely use your local data.</p>
        <button type="button" className="primary" disabled={busy} onClick={resume}>
          {busy ? 'Requesting control…' : 'Resume here'}
        </button>
        {error && <small role="alert">{error}</small>}
      </div>
    </main>
  );
}
