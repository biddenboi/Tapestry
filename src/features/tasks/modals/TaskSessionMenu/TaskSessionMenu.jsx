import '@features/tasks/modals/TaskCreationMenu/TaskCreationMenu.css';
import '@features/tasks/modals/TaskSessionMenu/TaskSessionMenu.css';
import { useCallback, useEffect } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskSessionExpanded from '@features/tasks/components/TaskSessionExpanded/TaskSessionExpanded.jsx';
import { useTaskSession } from '@features/tasks/context/TaskSessionProvider.jsx';

// NiceModal remains the launch/navigation boundary used by task preview,
// Match, and Dojo. Runtime ownership lives above it in TaskSessionProvider so
// switching this surface between expanded and docked never remounts a clock.
export default NiceModal.create(() => {
  const modal = useModal();
  const { snapshot, bindExpandedSurface } = useTaskSession();
  const close = useCallback(() => {
    modal.hide();
    modal.remove();
  }, [modal]);

  useEffect(() => bindExpandedSurface({ close }), [bindExpandedSurface, close]);

  if (!modal.visible || !snapshot || snapshot.mode !== 'expanded') return null;
  return <TaskSessionExpanded />;
});
