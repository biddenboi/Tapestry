import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { queryMobileWorkspaceGoals } from '@app/mobile/application/MobileGoalsQueryService.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import {
  buildMobileGoalDetailFacts,
  mobileGoalActivityLabel,
  mobileGoalProgressLabel,
  selectMobileGoalCards,
} from './MobileGoalPresentation.js';

function goalIdFromLocation() {
  if (typeof window === 'undefined') return null;
  return window.location.hash.match(/^#\/m\/goals\/([^/?#]+)/)?.[1] || null;
}

export default function MobileGoalsPage() {
  const { databaseConnection, currentPlayer, domainRevisions } = useAppContext();
  const { openSurface } = useMobileSurface();
  const [overview, setOverview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const viewerIGT = useMemo(() => getCurrentIGT(currentPlayer), [currentPlayer]);

  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    setLoading(true);
    setError('');
    try {
      setOverview(await queryMobileWorkspaceGoals(databaseConnection, {
        playerUUID: currentPlayer.UUID,
        viewerIGT,
      }));
    } catch (loadError) {
      setError(loadError?.message || 'Goals could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentPlayer?.UUID, databaseConnection, viewerIGT]);

  const openGoal = useCallback(async (goalUUID, { fromHistory = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      const next = await databaseConnection.getRepository('goals').getGoalDetail(goalUUID, viewerIGT);
      if (!next) throw new Error('This Goal is no longer available.');
      setDetail(next);
      if (!fromHistory) {
        window.history.pushState(
          { tapestryMobileTab: 'goals', tapestryMobileGoal: goalUUID },
          '',
          `${window.location.pathname}${window.location.search}#/m/goals/${goalUUID}`,
        );
      }
    } catch (loadError) {
      setError(loadError?.message || 'This Goal could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [databaseConnection, viewerIGT]);

  useEffect(() => {
    if (!currentPlayer?.UUID) return;
    void load().then(() => {
      const routeGoal = goalIdFromLocation();
      if (routeGoal) void openGoal(routeGoal, { fromHistory: true });
    });
  }, [currentPlayer?.UUID, domainRevisions.goals, load, openGoal]);

  useEffect(() => {
    const onPopState = () => {
      const routeGoal = goalIdFromLocation();
      if (routeGoal) void openGoal(routeGoal, { fromHistory: true });
      else setDetail(null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [openGoal]);

  const refreshDetail = async () => {
    if (!detail?.goal?.UUID) return;
    const next = await databaseConnection.getRepository('goals').getGoalDetail(detail.goal.UUID, viewerIGT);
    setDetail(next);
    await load();
  };

  const openLinkedWork = async (item) => {
    if (!['todo', 'task'].includes(item.entityType)) return;
    const task = item.entityType === 'todo'
      ? await databaseConnection.get('todos', item.UUID || item.entityUUID)
      : item;
    if (task) openSurface('task-actions', { task, onChanged: refreshDetail });
  };

  if (detail) {
    const facts = buildMobileGoalDetailFacts(detail);
    return (
      <section className="mobile-page mobile-goals-page mobile-goal-detail">
        <button type="button" className="mobile-page-back" onClick={() => window.history.back()}>← Goals</button>
        <header className="mobile-page-header"><div><span>{detail.area?.name || 'Goal'}</span><h1>{detail.goal.name}</h1></div></header>
        <article className="mobile-goal-summary">
          <strong>{mobileGoalProgressLabel(detail.progress)}</strong>
          <span>{facts.finishCondition}</span>
        </article>
        <dl className="mobile-goal-facts">
          {facts.nextAction && <div><dt>Next action</dt><dd>{facts.nextAction}</dd></div>}
          {facts.blocker && <div className="is-blocked"><dt>Blocker</dt><dd>{facts.blocker}</dd></div>}
          {facts.nextMilestone && <div><dt>Next milestone</dt><dd>{facts.nextMilestone.title}</dd></div>}
        </dl>
        <button type="button" className="primary mobile-goal-update-button" onClick={() => openSurface('goal-update', { detail, onPosted: refreshDetail })}>Add progress update</button>
        <section className="mobile-goal-section"><h2>Linked work</h2>{detail.linkedWork?.length ? detail.linkedWork.slice(0, 12).map((item) => (
          <button className="mobile-goal-linked-work" key={`${item.entityType}:${item.UUID}`} type="button" onClick={() => openLinkedWork(item)} disabled={!['todo', 'task'].includes(item.entityType)}><b>{item.name || item.title || item.text || item.entry || item.entityType}</b><small>{item.entityType}</small></button>
        )) : <p>No linked tasks or habits yet.</p>}</section>
        <section className="mobile-goal-section"><h2>Recent activity</h2>{detail.timeline?.length ? detail.timeline.slice(0, 8).map((item, index) => (
          <article key={item.UUID || `${item.type}:${index}`}><b>{item.title || item.summary || item.label || item.type || 'Goal activity'}</b><small>{mobileGoalActivityLabel(item.createdAt || item.occurredAt || item.updatedAt)}</small></article>
        )) : <p>No recent activity.</p>}</section>
        {error && <div className="mobile-page-error" role="alert">{error}</div>}
      </section>
    );
  }

  const selected = selectMobileGoalCards(overview);
  return (
    <section className="mobile-page mobile-goals-page">
      <header className="mobile-page-header"><div><span>Direction</span><h1>Goals</h1></div></header>
      {overview && <div className="mobile-goal-stats"><span><b>{selected.active.length}</b>Active</span><span className={selected.blocked.length ? 'is-blocked' : ''}><b>{selected.blocked.length}</b>Blocked</span></div>}
      <div className="mobile-goal-list">
        {selected.cards.map((card) => {
          const isBlocked = card.healthStatus === 'blocked';
          const summary = isBlocked
            ? card.goal.blocker?.summary || card.goal.blockedReason || 'Waiting on a blocker'
            : card.goal.nextAction?.summary || card.nextAction?.summary || card.finishCondition || 'Open Goal';
          return <button key={card.goalUUID} type="button" className={isBlocked ? 'is-blocked' : ''} onClick={() => openGoal(card.goalUUID)}><span>{isBlocked ? 'Blocked' : card.area?.name || 'Active Goal'}</span><strong>{card.name}</strong><small>{summary}</small><b>{isBlocked ? 'Blocked' : mobileGoalProgressLabel(card.progress)}</b></button>;
        })}
        {!loading && overview && !selected.cards.length && <p className="mobile-compact-empty">No active or blocked Goals.</p>}
      </div>
      {loading && <div className="mobile-feature-loading">Loading Goals…</div>}
      {error && <div className="mobile-page-error" role="alert">{error}</div>}
    </section>
  );
}
