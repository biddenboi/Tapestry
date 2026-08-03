import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import QuickContextEditor from './QuickContextEditor.jsx';
import ContextInbox from './ContextInbox.jsx';
import ContextPreview from './ContextPreview.jsx';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';

const STUDIO_TABS = Object.freeze([
  { id: 'author', label: 'Write context', description: 'Create a new time-limited context update.' },
  { id: 'inbox', label: 'Suggestions', description: 'Review private suggestions before anything is shared.' },
  { id: 'preview', label: 'Preview', description: 'See exactly what a particular relationship can see.' },
  { id: 'active', label: 'Active items', description: 'Inspect or revoke context that is currently visible.' },
  { id: 'preferences', label: 'Defaults', description: 'Set privacy defaults without granting blanket permission.' },
]);

export default function ContextStudio({
  open,
  ownerId,
  people,
  ownerState,
  saving,
  onClose,
  onSaveQuick,
  onRefreshSuggestions,
  onResolveSuggestion,
  onRevoke,
  onPreview,
  onSavePreferences,
}) {
  const [tab, setTab] = useState('author');
  const [preferences, setPreferences] = useState(ownerState?.preferences || {});
  useEffect(() => {
    setPreferences(ownerState?.preferences || {});
  }, [ownerState?.preferences]);
  if (!open) return null;
  const activeItems = (ownerState?.items || []).filter((item) => item.status === 'active');
  const suggestions = (ownerState?.suggestions || []).filter((item) => item.status === 'pending');
  const tabItems = STUDIO_TABS.map((item) => ({
    ...item,
    label: item.id === 'active'
      ? `${item.label} (${activeItems.length})`
      : item.id === 'inbox' && suggestions.length
        ? `${item.label} (${suggestions.length})`
        : item.label,
  }));
  const studio = (
    <ModalFrame
      onClose={onClose}
      title="Context Studio"
      subtitle="Author, inspect, and revoke the context your profile projects."
      eyebrow="Profile context"
      size="xl"
      accent="var(--color-profile)"
      className="profile-context-studio"
    >
      <LocalSectionNav
        items={tabItems}
        value={tab}
        onChange={setTab}
        label="Context Studio sections"
        className="profile-context-studio__tabs"
      />
      {tab === 'author' && (
        <QuickContextEditor
          people={people}
          saving={saving}
          allowAvailability={ownerState?.preferences?.allowAvailability === true}
          onSave={onSaveQuick}
          onOpenStudio={() => setTab('preview')}
        />
      )}
      {tab === 'inbox' && (
        <ContextInbox
          suggestions={suggestions}
          saving={saving}
          onRefresh={onRefreshSuggestions}
          onResolve={onResolveSuggestion}
        />
      )}
      {tab === 'preview' && <ContextPreview ownerId={ownerId} people={people} onPreview={onPreview} />}
      {tab === 'active' && (
        <section className="profile-context-active-list">
          {activeItems.length ? activeItems.map((item) => (
            <article key={item.UUID}>
              <span>{item.type} · {item.audience}</span>
              <strong>{item.text}</strong>
              <small>{item.expiresAt ? `Expires ${new Date(item.expiresAt).toLocaleString()}` : 'No expiry recorded'}</small>
              <button type="button" onClick={() => onRevoke(item.UUID)} disabled={saving}>Revoke now</button>
            </article>
          )) : <div className="profile-context-empty">No active context. Presence still works without it.</div>}
        </section>
      )}
      {tab === 'preferences' && (
        <form className="profile-context-preferences" onSubmit={async (event) => {
          event.preventDefault();
          await onSavePreferences(preferences);
        }}>
          <header>
            <span>Disclosure preferences</span>
            <p>These are policy inputs, not blanket permission. Every item still needs its own audience and expiry.</p>
          </header>
          <label>
            <input
              type="checkbox"
              checked={preferences.allowAvailability === true}
              onChange={(event) => setPreferences((current) => ({ ...current, allowAvailability: event.target.checked }))}
            />
            <span><b>Allow authored availability</b><small>Enables an Availability horizon. Tapestry never infers it.</small></span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferences.showActivityDetails === true}
              onChange={(event) => setPreferences((current) => ({ ...current, showActivityDetails: event.target.checked }))}
            />
            <span><b>Allow optional activity details</b><small>Still requires an explicit shared item; exact task labels stay private by default.</small></span>
          </label>
          <label className="profile-context-preferences__select">
            <span>Default audience</span>
            <select value={preferences.defaultAudience || 'private'} onChange={(event) => setPreferences((current) => ({ ...current, defaultAudience: event.target.value }))}>
              <option value="private">Only me</option>
              <option value="selected">Selected people</option>
              <option value="collaborators">Collaborators</option>
              <option value="fellows">Fellows</option>
              <option value="cast">My cast</option>
            </select>
          </label>
          <button className="primary" type="submit" disabled={saving}>Save preferences</button>
        </form>
      )}
    </ModalFrame>
  );
  return typeof document === 'undefined' ? studio : createPortal(studio, document.body);
}
