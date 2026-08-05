import { useEffect, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { readDayPenalty, reportDayPenalty } from '@domain/profile/DayPenalty.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';

export default function MobileDayPenaltySheet() {
  const { databaseConnection, currentPlayer } = useAppContext();
  const { closeSurface } = useMobileSurface();
  const [penalty, setPenalty] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPenalty(readDayPenalty(databaseConnection, currentPlayer)), [currentPlayer, databaseConnection]);
  const report = async () => {
    if (busy || !window.confirm('Report a deliberate rule violation for the current IGT day?')) return;
    setBusy(true);
    const next = reportDayPenalty(databaseConnection, currentPlayer);
    setPenalty(next);
    if (next.limitReached) {
      closeSurface({ force: true });
      const BanModal = (await import('@features/profile/modals/BanModal/BanModal.jsx')).default;
      await NiceModal.show(BanModal, { forceFinal: true });
    }
    setBusy(false);
  };
  return (
    <section className="mobile-sheet mobile-penalty-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-penalty-title">
      <header><div><span>Current IGT day</span><h2 id="mobile-penalty-title">Day penalties</h2></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <div className="mobile-sheet-scroll"><p>Use this only for deliberate rule violations: knowingly farming points, repeatedly using unpaid rewards, or editing save data for advantage. Ordinary mistakes and forgotten work do not qualify.</p><div className="mobile-penalty-count"><span>Strikes this IGT day</span><strong>{Number(penalty?.strikes || 0)}</strong><small>The daily limit is intentionally hidden and resets on the next IGT day.</small></div><div className="mobile-penalty-consequence"><strong>At the limit</strong><p>Profile identity, cosmetics, progress, and Match history are reset. Household tasks, Goals, Events, reminders, and journal content remain.</p></div></div>
      <footer><button type="button" className="danger" disabled={busy || penalty?.limitReached} onClick={report}>{busy ? 'Reporting…' : 'Report penalty'}</button></footer>
    </section>
  );
}
