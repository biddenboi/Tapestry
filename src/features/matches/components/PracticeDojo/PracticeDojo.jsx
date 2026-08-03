import { useEffect, useState } from 'react';
import { timeAsHHMMSS } from '@domain/time/Time.js';
import ProfilePresenceDrawer from '@features/social-world/components/ProfilePresenceDrawer/ProfilePresenceDrawer.jsx';
import DojoRecommendationFeed from './DojoRecommendationFeed.jsx';
import DojoRoom from './DojoRoom.jsx';
import DojoStandings from './DojoStandings.jsx';
import useDojoRoomController from './useDojoRoomController.js';
import useDojoStandingsController from './useDojoStandingsController.js';
import usePracticeDojoController from './usePracticeDojoController.js';
import './PracticeDojo.css';

export default function PracticeDojo() {
  const controller = usePracticeDojoController();
  const [activeTab, setActiveTab] = useState('room');
  const [socialOpen, setSocialOpen] = useState(false);
  const [standingsActive, setStandingsActive] = useState(false);
  useEffect(() => {
    if (activeTab === 'standings') {
      setStandingsActive(true);
      return undefined;
    }
    if (typeof window === 'undefined') return undefined;
    const activate = () => setStandingsActive(true);
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(activate, { timeout: 5000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(activate, 1200);
    return () => window.clearTimeout(id);
  }, [activeTab]);
  const room = useDojoRoomController({
    dojoSessionUUID: controller.dojoSessionUUID,
    viewerSessionPoints: controller.sessionPoints,
    clockTick: controller.elapsed,
  });
  const standings = useDojoStandingsController({
    active: standingsActive,
    scene: room.scene,
    dojoSessionUUID: controller.dojoSessionUUID,
  });

  useEffect(() => {
    if (!socialOpen) return undefined;
    const close = (event) => {
      if (event.key === 'Escape') setSocialOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [socialOpen]);

  return (
    <div className="dojo">
      <div className="dojo-bg" aria-hidden="true" />

      <header className="dojo-header">
        <div className="dojo-header-left">
          <span className="dojo-eyebrow">PRACTICE MODE</span>
          <span className="dojo-session-time">{timeAsHHMMSS(controller.elapsed)}</span>
        </div>
        <div className="dojo-header-right">
          <button className="dojo-people-btn" onClick={() => setSocialOpen(true)}>PEOPLE ({room.rows.length})</button>
          <button className="dojo-add-btn" onClick={controller.handleAddTask} disabled={controller.inTask}>+ TASK</button>
          <button className="dojo-queue-btn" onClick={controller.handleOpenQueue}>TASKS ({controller.todoCount})</button>
          <button
            className="dojo-exit-btn danger"
            onClick={controller.handleExitDojo}
            disabled={controller.inTask}
            title={controller.inTask ? 'Finish current session first' : 'Leave dojo'}
          >
            EXIT
          </button>
        </div>
      </header>

      <div className="dojo-arena">
        {socialOpen && <button type="button" className="dojo-social-backdrop" aria-label="Close people drawer" onClick={() => setSocialOpen(false)} />}
        {socialOpen && <aside className="dojo-social-sidebar" aria-label="Dojo room and standings">
          <header className="dojo-social-sidebar__header">
            <strong>People in the Dojo</strong>
            <button type="button" className="dojo-social-close" onClick={() => setSocialOpen(false)} aria-label="Close people drawer">×</button>
          </header>
          <nav className="dojo-social-tabs" aria-label="Dojo sidebar views">
            <button
              type="button"
              className={activeTab === 'room' ? 'active' : ''}
              aria-selected={activeTab === 'room'}
              onClick={() => setActiveTab('room')}
            >
              ROOM <span>{room.rows.length}</span>
            </button>
            <button
              type="button"
              className={activeTab === 'standings' ? 'active' : ''}
              aria-selected={activeTab === 'standings'}
              onClick={() => setActiveTab('standings')}
            >
              STANDINGS <span>{standings.around.length}</span>
            </button>
          </nav>

          <div className="dojo-social-sidebar__body">
            <div className="dojo-pane" hidden={activeTab !== 'room'}>
              <DojoRoom
                rows={room.rows}
                loading={room.loading}
                error={room.error}
                onInspectProfile={room.inspectProfile}
              />
            </div>
            <div className="dojo-pane" hidden={activeTab !== 'standings'}>
              <DojoStandings
                controller={standings}
                onInspectProfile={room.inspectProfile}
                topSessions={standings.top}
                currentPlayerId={controller.currentPlayer?.UUID}
              />
            </div>
          </div>
        </aside>}

        <main className="dojo-task-panel">
          <DojoRecommendationFeed controller={controller} />
        </main>
      </div>

      <ProfilePresenceDrawer
        analyticsSurface="dojo"
        open={Boolean(room.selectedProfileId)}
        summary={room.selectedMember}
        card={room.profileCard}
        loading={Boolean(room.selectedProfileId && !room.profileCard && !room.profileCardError)}
        error={room.profileCardError}
        viewerIGT={room.viewerIGT}
        onClose={room.closeProfile}
        onEncounterVisible={room.recordVisibleEncounter}
        onOpenProfile={room.openFullProfile}
      />
    </div>
  );
}
