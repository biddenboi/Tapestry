import { useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import {
  completeDailyLifecycle,
  completeDailyLifecycleLaunch,
  enterDailyLifecycle,
  getDailyLifecycleAppLaunchId,
  requireDailyLifecycleProfileSelection,
  setDurableEndOfDayState,
} from './DailyLifecycleService.js';

function DayPrompt({ endWork = false, lifecycleFlowId = '' }) {
  const modal = useModal();
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const title = endWork ? 'End work' : 'Start day';
  const submit = async () => {
    if (submitting || !currentPlayer?.UUID) return;
    setSubmitting(true);
    setError('');
    try {
      if (endWork) {
        const now = new Date();
        const endedAt = now.toISOString();
        const eodDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        await completeDailyLifecycle({ databaseConnection, player: currentPlayer, endedAt });
        await setDurableEndOfDayState(databaseConnection, currentPlayer.UUID, eodDateStr, 'shown');
        await requireDailyLifecycleProfileSelection(databaseConnection, {
          sourcePlayerUUID: currentPlayer.UUID, endedAt, eodDateStr,
          sourceLaunchId: getDailyLifecycleAppLaunchId(),
        });
      } else {
        const result = await enterDailyLifecycle({ databaseConnection, player: currentPlayer });
        if (!result) throw new Error('Select an active profile to start the day.');
        if (lifecycleFlowId) await completeDailyLifecycleLaunch(databaseConnection, { flowId: lifecycleFlowId });
      }
      await databaseConnection.flushWrites?.();
      invalidateDomains(DOMAIN_INVALIDATION.dailyLifecycleWrite);
      modal.resolve(true);
      modal.remove();
    } catch (nextError) {
      setError(nextError.message || 'The day boundary could not be saved.');
      setSubmitting(false);
    }
  };
  return (
    <ModalFrame open={modal.visible} title={title} size="sm" onClose={endWork ? () => modal.remove() : undefined}
      closeOnBackdrop={endWork && !submitting} closeOnEscape={endWork && !submitting}
      showCloseButton={endWork && !submitting}
      footer={<button type="button" className="primary" onClick={submit} disabled={submitting || !currentPlayer?.UUID}>{submitting ? 'Saving…' : title}</button>}>
      <p>{endWork ? 'Close today’s work window.' : 'Open today’s work window.'}</p>
      {error && <p role="alert">{error}</p>}
    </ModalFrame>
  );
}

export const StartDayPrompt = NiceModal.create((props) => <DayPrompt {...props} />);
export const EndWorkPrompt = NiceModal.create((props) => <DayPrompt {...props} endWork />);
