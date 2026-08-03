import { useEffect, useRef } from 'react';
import {
  MobileDatePickerSheet,
  MobileSystemDirectionSheet,
  MobileTaskActionSheet,
  MobileTaskComposer,
} from '@features/tasks/mobile/MobileTaskSheets.jsx';
import {
  MobileReminderActionSheet,
  MobileReminderComposer,
} from '@features/reminders/mobile/MobileReminderSheets.jsx';
import MobileGoalUpdateSheet from '@features/goals/mobile/MobileGoalUpdateSheet.jsx';
import {
  MobileChronicleComposer,
  MobileChronicleEntrySheet,
} from '@features/chronicle/mobile/MobileChronicleSheets.jsx';
import MobileShopDetailSheet from '@features/shop/mobile/MobileShopSheets.jsx';
import { MobileNotificationsSheet, MobilePlayerSheet } from '@features/profile/mobile/MobileMoreSheets.jsx';
import { useMobileSurface } from './MobileSurfaceContext.jsx';

const SURFACES = Object.freeze({
  'date-picker': MobileDatePickerSheet,
  'system-direction': MobileSystemDirectionSheet,
  'task-actions': MobileTaskActionSheet,
  'task-composer': MobileTaskComposer,
  'reminder-actions': MobileReminderActionSheet,
  'reminder-composer': MobileReminderComposer,
  'goal-update': MobileGoalUpdateSheet,
  'chronicle-composer': MobileChronicleComposer,
  'chronicle-entry': MobileChronicleEntrySheet,
  'shop-detail': MobileShopDetailSheet,
  'player-sheet': MobilePlayerSheet,
  notifications: MobileNotificationsSheet,
});

export default function MobileOverlayHost() {
  const { surface, closeSurface } = useMobileSurface();
  const hostRef = useRef(null);

  useEffect(() => {
    if (!surface || !hostRef.current) return undefined;
    const host = hostRef.current;
    const stage = host.querySelector('.mobile-overlay-stage');
    const focusTarget = stage?.querySelector('[data-autofocus="true"], [autofocus]')
      || stage?.querySelector('input:not([type="hidden"]), textarea, select')
      || stage?.querySelector('button');
    window.requestAnimationFrame(() => focusTarget?.focus?.());
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSurface();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...stage.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeSurface, surface]);

  if (!surface) return <div id="mobile-overlay-root" className="mobile-overlay-root" aria-live="polite" />;
  const Component = SURFACES[surface.type];
  return (
    <div id="mobile-overlay-root" className="mobile-overlay-root is-open" ref={hostRef}>
      <button type="button" className="mobile-overlay-backdrop" tabIndex={-1} aria-hidden="true" onClick={() => closeSurface()} />
      <div className="mobile-overlay-stage">
        {Component ? <Component payload={surface.payload} /> : surface.payload?.content || null}
      </div>
    </div>
  );
}
