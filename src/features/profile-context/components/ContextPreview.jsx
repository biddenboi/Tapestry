import { useEffect, useState } from 'react';

const VIEWERS = [
  ['self', 'You', 'self'],
  ['fellow', 'A Fellow', 'dynamic'],
  ['collaborator', 'A collaborator', 'friend'],
  ['cast', 'Another cast member', 'dynamic'],
  ['outside', 'Outside your cast', 'outside'],
];

export default function ContextPreview({ ownerId, people = [], onPreview }) {
  const [viewerType, setViewerType] = useState('fellow');
  const [namedViewerId, setNamedViewerId] = useState('');
  const [projection, setProjection] = useState(null);
  const selected = VIEWERS.find(([id]) => id === viewerType) || VIEWERS[1];
  const previewViewerId = viewerType === 'self'
    ? ownerId
    : namedViewerId || `profile-context-preview:${viewerType}`;

  useEffect(() => {
    let active = true;
    onPreview?.({ previewViewerId, previewTier: selected[2] })
      .then((value) => { if (active) setProjection(value); });
    return () => { active = false; };
  }, [onPreview, previewViewerId, selected]);

  return (
    <section className="profile-context-preview">
      <header>
        <div>
          <span>Preview as viewer</span>
          <p>This runs the same disclosure policy used by Social World.</p>
        </div>
        <select value={viewerType} onChange={(event) => setViewerType(event.target.value)}>
          {VIEWERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </header>
      {viewerType !== 'self' && people.length > 0 && (
        <label>
          Named person (optional)
          <select value={namedViewerId} onChange={(event) => setNamedViewerId(event.target.value)}>
            <option value="">Generic policy preview</option>
            {people.map((person) => (
              <option key={person.UUID} value={person.UUID}>{person.username}</option>
            ))}
          </select>
        </label>
      )}
      <div className="profile-context-preview__surface">
        <small>{projection?.reason === 'shared-context' ? `${projection.items.length} visible item${projection.items.length === 1 ? '' : 's'}` : 'No context visible'}</small>
        {projection?.capsule?.length ? projection.capsule.map((item) => (
          <p key={item.id}><b>{item.type}</b>{item.text}</p>
        )) : <p>Only presence would appear for this viewer.</p>}
      </div>
    </section>
  );
}

