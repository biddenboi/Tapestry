import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { recordAnalyticsEvent } from '@domain/analytics/AnalyticsEvents.js';
import { formatDuration, formatWorldIGT } from '@domain/time/Time.js';
import { SEMANTIC_LOCATION_LABEL } from '@domain/social-world/PresencePresentation.js';
import { PRESENCE_STATE } from '@domain/social-world/SocialWorldContracts.js';
import {
  SOCIAL_WORLD_ANALYTICS_EVENT,
  SOCIAL_WORLD_EVALUATION_VERSION,
} from '@domain/social-world/SocialWorldEvaluation.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { buildProfileIdentity } from '@domain/profile/ProfileIdentity.js';
import DrawerFrame from '@shared/ui/DrawerFrame.jsx';
import './ProfilePresenceDrawer.css';

function dueLabel(value) {
  if (!value) return 'Unscheduled';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Committed';
  return `Due ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function liveNow(card, viewerIGT) {
  if (!card?.now) return null;
  const now = card.now;
  if (![PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(now.state)
      || now.startedIGT == null) return now;
  const end = now.endedIGT == null ? viewerIGT : Math.min(viewerIGT, now.endedIGT);
  const elapsedHere = Math.max(0, end - now.startedIGT);
  let activeElapsed = now.activeElapsed;
  if (now.state === PRESENCE_STATE.current && !now.paused && activeElapsed != null) {
    activeElapsed = Math.min(elapsedHere, activeElapsed + Math.max(0, viewerIGT - card.asOfIGT));
  }
  return { ...now, elapsedHere, activeElapsed };
}

function CardSection({ label, className = '', children }) {
  return (
    <section className={`profile-presence-card__section ${className}`}>
      <h3>{label}</h3>
      {children}
    </section>
  );
}

function ContextList({ items = [] }) {
  if (!items.length) return null;
  return (
    <ul className="profile-presence-card__context-list">
      {items.map((item) => (
        <li key={item.id}>
          <span>{item.text}</span>
          <small>
            {item.tentative ? 'Tentative · ' : ''}
            {item.audience}
            {item.expiresAt ? ` · until ${new Date(item.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}
          </small>
        </li>
      ))}
    </ul>
  );
}

export default function ProfilePresenceDrawer({
  open,
  summary,
  card,
  loading,
  error,
  viewerIGT,
  onClose,
  onOpenProfile,
  onEncounterVisible,
  analyticsSurface = 'profile-drawer',
}) {
  const { databaseConnection, currentPlayer } = useAppContext();
  const recordedRef = useRef(new Set());
  const now = useMemo(() => liveNow(card, viewerIGT), [card, viewerIGT]);
  const identity = useMemo(() => (
    card?.identity?.profileId === currentPlayer?.UUID
      ? buildProfileIdentity(currentPlayer)
      : card?.identity
  ), [card?.identity, currentPlayer]);
  const subjectProfileId = card?.identity?.profileId || null;
  const hasMeaningfulContext = Boolean(
    card?.context?.chapter
    || card?.context?.near?.length
    || card?.context?.goals?.length
    || card?.context?.showUp?.length,
  );
  const recordSocialEvent = useCallback((eventName) => {
    if (!subjectProfileId || !currentPlayer?.UUID || subjectProfileId === currentPlayer.UUID) return;
    recordAnalyticsEvent(databaseConnection, currentPlayer, {
      eventName,
      surface: analyticsSurface,
      targetType: 'profile',
      targetUUID: subjectProfileId,
      metadata: {
        evaluationVersion: SOCIAL_WORLD_EVALUATION_VERSION,
      },
    }, { dedupeWindowMs: 30_000 }).catch((nextError) => {
      console.warn('[SocialWorld] Evaluation event could not be recorded:', nextError);
    });
  }, [analyticsSurface, currentPlayer, databaseConnection, subjectProfileId]);

  useEffect(() => {
    if (!open || !card?.identity?.profileId) return;
    recordSocialEvent(SOCIAL_WORLD_ANALYTICS_EVENT.profileDrawerOpened);
    const preview = card.new?.preview || [];
    const key = `${card.identity.profileId}:${card.asOfIGT}:profile-drawer:${preview.map((fact) => fact.versionToken).join(',')}`;
    if (recordedRef.current.has(key)) return;
    recordedRef.current.add(key);
    onEncounterVisible?.({
      profileId: card.identity.profileId,
      surface: 'profile-drawer',
      visibleFacts: preview,
    });
  }, [card, onEncounterVisible, open, recordSocialEvent]);

  return (
    <DrawerFrame
      open={open}
      onClose={onClose}
      title="Profile moment"
      subtitle={loading ? 'Preparing compact presence' : null}
      eyebrow="Social world"
      width="min(420px, 100vw)"
      className="profile-presence-drawer"
    >
      {loading && (
        <div className="profile-presence-card__loading" role="status">
          <i /><i /><i /><span>Preparing factual profile moment…</span>
        </div>
      )}
      {!loading && (error || !card) && (
        <div className="profile-presence-card__unavailable" role="status">
          <strong>Compact presence unavailable</strong>
          <p>This profile is not available through the current cast boundary.</p>
        </div>
      )}
      {!loading && card && (
        <div className="profile-presence-card">
          <header className="profile-presence-card__identity">
            <button
              type="button"
              className="profile-presence-card__identity-button"
              onClick={() => card.actions?.canOpenProfile && onOpenProfile?.(card.identity.profileId)}
              disabled={!card.actions?.canOpenProfile}
              aria-label={`Open ${identity.username} profile`}
            >
              <ProfileIdentity
                identity={identity}
                avatarSize={58}
                rank="compact"
                meta={card.lastActive.label}
                isViewer={card.role === 'self'}
              />
            </button>
          </header>

          {hasMeaningfulContext ? (
            <>
              {card.context?.chapter && (
                <CardSection label="Current chapter" className="profile-presence-card__section--chapter">
                  <div className="profile-presence-card__chapter">
                    <strong>{card.context.chapter.text}</strong>
                    <small>
                      {card.context.chapter.tentative ? 'Tentative · ' : ''}
                      {card.context.chapter.audience}
                      {card.context.chapter.expiresAt
                        ? ` · until ${new Date(card.context.chapter.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                        : ''}
                    </small>
                  </div>
                </CardSection>
              )}

              <CardSection label="Now" className="profile-presence-card__section--now">
                <div className="profile-presence-card__now" data-state={now.state}>
                  <span><i aria-hidden="true" />{now.presentation?.statusLabel || now.state}</span>
                  <strong>{SEMANTIC_LOCATION_LABEL[now.location] || 'Away from the live scene'}</strong>
                  <p>{now.activityLabel}</p>
                  {card.role === 'self' && (
                    <dl>
                      <div><dt>Here</dt><dd>{now.elapsedHere == null ? '—' : formatDuration(now.elapsedHere)}</dd></div>
                      {now.activeElapsed != null && (
                        <div><dt>Focused</dt><dd>{formatDuration(now.activeElapsed)}</dd></div>
                      )}
                    </dl>
                  )}
                </div>
                <ContextList items={card.context?.now} />
              </CardSection>

              {Boolean(card.context?.near?.length) && <CardSection label="Next 72 hours"><ContextList items={card.context.near} /></CardSection>}
              {Boolean(card.context?.recent?.length) && <CardSection label="Recent arc"><ContextList items={card.context.recent} /></CardSection>}
              {Boolean(card.context?.goals?.length) && <CardSection label="Current goals"><ContextList items={card.context.goals} /></CardSection>}
              {Boolean(card.context?.showUp?.length) && <CardSection label="How to show up"><ContextList items={card.context.showUp} /></CardSection>}
            </>
          ) : (
            <div className="profile-presence-card__private">
              <strong>Working privately</strong>
              <p>Presence is available, but no additional situation was shared with this relationship.</p>
            </div>
          )}
        </div>
      )}
    </DrawerFrame>
  );
}
