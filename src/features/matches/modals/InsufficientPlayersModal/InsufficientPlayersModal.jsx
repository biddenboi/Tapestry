import NiceModal, { useModal } from '@ebay/nice-modal-react';
import '@features/matches/modals/InsufficientPlayersModal/InsufficientPlayersModal.css';
import ActionRow from '@shared/ui/ActionRow.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';

/**
 * Shown when matchmaking is blocked because the candidate pool is too small.
 * At Silver+ we no longer fall back to synthetic Echo fillers — the player
 * has to grow the profile pool to keep playing.
 *
 * No match record is written when this modal fires; see Lobby.handleFindMatch.
 */
export default NiceModal.create(({ available = 0, rankLabel = '' }) => {
  const modal = useModal();
  const close = () => { modal.hide(); modal.remove(); };

  return (
    <ModalFrame
      onClose={close}
      title="Not enough opponents"
      subtitle={rankLabel ? `Current rank: ${rankLabel}` : undefined}
      eyebrow="Matchmaking"
      size="sm"
      accent="var(--color-match)"
      className="insufficient-modal"
      footer={<ActionRow><button className="primary" onClick={close}>Close</button></ActionRow>}
    >
        <div className="insufficient-icon" aria-hidden="true">◈</div>
        <p className="insufficient-body">
          Pair Match needs three other rated players in range. Add profiles or try again later.
        </p>
        <p className="insufficient-stat">{available} / 3 players available</p>
    </ModalFrame>
  );
});
