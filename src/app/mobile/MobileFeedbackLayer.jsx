import { useEffect, useRef } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { useMobileSurface } from './MobileSurfaceContext.jsx';
import { mobileFeedbackHapticPattern } from './application/MobileFeedback.js';

function FeedbackCard({ event, onDismiss, player, reducedMotion }) {
  const announcedRef = useRef(false);
  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    const pattern = mobileFeedbackHapticPattern(event.significance, { reducedMotion });
    if (pattern != null && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
  }, [event.significance, reducedMotion]);

  return (
    <button
      type="button"
      className={`mobile-feedback-card is-${event.significance}`}
      onClick={() => onDismiss(event.id)}
      aria-label={`${event.title}. ${event.deltas.map(({ value, label }) => `${value > 0 ? '+' : ''}${value} ${label}`).join(', ')}`}
    >
      <div className="mobile-feedback-card__main">
        {player && <ProfileIdentity player={player} compact avatarOnly avatarSize={36} />}
        <div className="mobile-feedback-card__copy">
          <span>System event</span>
          <strong>{event.title}</strong>
          {!!event.deltas.length && (
            <div>{event.deltas.map(({ key, value, label }) => <b key={key}>{value > 0 ? '+' : ''}{value} {label}</b>)}</div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function MobileFeedbackLayer() {
  const { currentPlayer } = useAppContext();
  const { feedback, dismissFeedback } = useMobileSurface();
  return (
    <div className="mobile-feedback-layer" aria-live="polite" aria-atomic="true">
      {feedback.map((event) => <FeedbackCard key={event.id} event={event} onDismiss={dismissFeedback} player={currentPlayer} reducedMotion={currentPlayer?.reducedMotion === true} />)}
    </div>
  );
}
