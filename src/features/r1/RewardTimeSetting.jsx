import { useEffect, useState } from 'react';
import { setRewardMinutes } from '@features/r1/r1Commands.js';
export default function RewardTimeSetting({ databaseConnection }) {
  const [minutes, setMinutes] = useState(20); const [error, setError] = useState('');
  useEffect(() => { let alive = true; databaseConnection.get('appSettings', 'r1.rewardMinutes').then((r) => { if (alive) setMinutes(Number(r?.value ?? 20)); }).catch((e) => setError(e.message)); return () => { alive = false; }; }, [databaseConnection]);
  return <label className="settings-row">Reward time per day (minutes)<input type="number" min="0" max="1440" step="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} onBlur={async () => { try { await setRewardMinutes(databaseConnection, Number(minutes)); setError(''); } catch (e) { setError(e.message); } }} />{error && <span role="alert">{error}</span>}</label>;
}
