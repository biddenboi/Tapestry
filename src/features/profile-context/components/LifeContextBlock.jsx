import { useState } from 'react';
import QuickContextEditor from './QuickContextEditor.jsx';
import ContextStudio from './ContextStudio.jsx';

const SECTIONS = [
  { key: 'now', label: 'Right now', description: 'What currently has your attention' },
  { key: 'near', label: 'Next 72 hours', description: 'What is approaching soon' },
  { key: 'recent', label: 'Recent arc', description: 'What has been shaping this moment' },
  { key: 'goals', label: 'Current Goals', description: 'What your work is building toward' },
  { key: 'showUp', label: 'How to show up', description: 'How others can support you well' },
];

export default function LifeContextBlock({
  ownerId,
  isOwner,
  projection,
  ownerState,
  people,
  loading,
  saving,
  onSaveQuick,
  onRefreshSuggestions,
  onResolveSuggestion,
  onRevoke,
  onPreview,
  onSavePreferences,
}) {
  const [editing, setEditing] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const visibleCount = projection?.items?.length || 0;
  if (editing && isOwner) {
    return (
      <QuickContextEditor
        people={people}
        saving={saving}
        onCancel={() => setEditing(false)}
        onOpenStudio={() => { setEditing(false); setStudioOpen(true); }}
        onSave={async (payload) => {
          await onSaveQuick(payload);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="profile-life-context">
      <header>
        <div className="profile-life-context__title">
          <span>Life context</span>
          <h2>What’s shaping this season</h2>
          <p>{isOwner ? 'Share only the context that helps people understand how to meet you right now.' : 'Shared for this relationship and this moment.'}</p>
        </div>
        {isOwner && (
          <div className="profile-life-context__actions">
            <button type="button" className="primary" onClick={() => setEditing(true)}>Edit context</button>
            <button type="button" onClick={() => setStudioOpen(true)}>Manage sharing</button>
          </div>
        )}
      </header>
      {loading ? (
        <div className="profile-context-empty">Checking this viewer’s context policy…</div>
      ) : visibleCount === 0 ? (
        <div className="profile-life-context__presence-only">
          <i aria-hidden="true" />
          <div>
            <strong>{isOwner ? 'Presence only' : 'Working privately'}</strong>
            <p>{isOwner ? 'Your Social World presence still works. Add context only when it helps.' : 'No additional situation has been shared with you.'}</p>
          </div>
          {isOwner && <button type="button" onClick={() => setEditing(true)}>Add context</button>}
        </div>
      ) : (
        <>
          <div className="profile-life-context__status">
            <i aria-hidden="true" />
            <div>
              <strong>{visibleCount} context item{visibleCount === 1 ? '' : 's'} visible here</strong>
              <small>{isOwner ? 'Every item keeps its own audience and expiry.' : 'This view already reflects what was shared with you.'}</small>
            </div>
          </div>
          {projection.chapter && (
            <div className="profile-life-context__chapter">
              <small>The chapter I’m in</small>
              <strong>{projection.chapter.text}</strong>
              {projection.chapter.tentative && <em>tentative</em>}
            </div>
          )}
          <div className="profile-life-context__grid">
            {SECTIONS.map((section) => {
              const items = projection[section.key] || [];
              if (!items.length) return null;
              return (
                <section key={section.key} className={`profile-life-context__section is-${section.key}`}>
                  <header>
                    <h3>{section.label}</h3>
                    <p>{section.description}</p>
                  </header>
                  <ul>
                    {items.map((item) => (
                    <li key={item.id}>
                      <span>{item.text}</span>
                      {item.tentative && <small>tentative</small>}
                    </li>
                  ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
      <ContextStudio
        open={studioOpen}
        ownerId={ownerId}
        people={people}
        ownerState={ownerState}
        saving={saving}
        onClose={() => setStudioOpen(false)}
        onSaveQuick={onSaveQuick}
        onRefreshSuggestions={onRefreshSuggestions}
        onResolveSuggestion={onResolveSuggestion}
        onRevoke={onRevoke}
        onPreview={onPreview}
        onSavePreferences={onSavePreferences}
      />
    </div>
  );
}
