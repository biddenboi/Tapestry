import '@app/rewards/RewardFloatLayer.css';

export default function RewardFloatLayer({ gains = [] }) {
  if (!gains.length) return null;
  return (
    <div className="reward-float-layer" aria-live="polite" aria-label="Reward gains">
      {gains.map((gain) => (
        <span
          key={gain.id}
          className={`reward-float reward-float--${gain.kind || 'default'}`}
          style={{
            '--reward-x': `${gain.x}%`,
            '--reward-y': `${gain.y}%`,
            '--reward-delay': `${gain.delayMs || 0}ms`,
            '--reward-drift-x': `${gain.driftX || 0}px`,
            '--reward-drift-y': `${gain.driftY || 44}px`,
          }}
        >
          {gain.label}
        </span>
      ))}
    </div>
  );
}
