import { useState } from 'react';
import AudiencePicker from './AudiencePicker.jsx';
import FreshnessPicker, { expiryFromHours } from './FreshnessPicker.jsx';

const EMPTY_DECISIONS = [
  { type: 'now', text: '' },
  { type: 'near', text: '' },
];

export default function QuickContextEditor({
  people = [],
  saving,
  allowAvailability = false,
  onSave,
  onOpenStudio,
  onCancel,
}) {
  const [chapter, setChapter] = useState('');
  const [showUp, setShowUp] = useState('');
  const [decisions, setDecisions] = useState(EMPTY_DECISIONS);
  const [audience, setAudience] = useState('private');
  const [recipientIds, setRecipientIds] = useState([]);
  const [hours, setHours] = useState('72');
  const canSave = chapter.trim() || showUp.trim() || decisions.some((entry) => entry.text.trim());

  return (
    <form className="profile-context-quick" onSubmit={(event) => {
      event.preventDefault();
      onSave?.({
        chapter,
        showUp,
        decisions,
        audience,
        recipientIds,
        expiresAt: expiryFromHours(hours),
      });
    }}>
      <header>
        <div>
          <span>Quick context</span>
          <h2>Give people the useful outline</h2>
          <p>Share the situation, not your telemetry. Leave any field blank when it would not help.</p>
        </div>
        <button type="button" onClick={onOpenStudio}>Privacy & preview</button>
      </header>
      <section className="profile-context-quick__section">
        <div className="profile-context-quick__section-heading">
          <b>1</b>
          <div><strong>Name the chapter</strong><p>A single sentence that frames this stretch of life.</p></div>
        </div>
        <label>
          <span>Current chapter</span>
          <input value={chapter} maxLength={280} onChange={(event) => setChapter(event.target.value)} placeholder="e.g. Shipping a first draft this week" />
        </label>
      </section>
      <section className="profile-context-quick__section">
        <div className="profile-context-quick__section-heading">
          <b>2</b>
          <div><strong>Add the context that changes how people respond</strong><p>Choose a horizon, then write one broad and useful line.</p></div>
        </div>
        <div className="profile-context-decision-grid">
          {decisions.map((decision, index) => (
            <label key={index}>
              <select aria-label={`Context horizon ${index + 1}`} value={decision.type} onChange={(event) => setDecisions((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, type: event.target.value } : entry))}>
                <option value="now">Right now</option>
                <option value="near">Next 72 hours</option>
                <option value="recent">Recent arc</option>
                <option value="goal">Current Goal</option>
                {allowAvailability && <option value="availability">Availability</option>}
              </select>
              <input aria-label={`Context line ${index + 1}`} value={decision.text} maxLength={280} onChange={(event) => setDecisions((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, text: event.target.value } : entry))} placeholder="What would help someone understand this moment?" />
            </label>
          ))}
          {decisions.length < 4 && <button type="button" onClick={() => setDecisions((current) => [...current, { type: 'now', text: '' }])}>+ Add another context line</button>}
        </div>
      </section>
      <section className="profile-context-quick__section">
        <div className="profile-context-quick__section-heading">
          <b>3</b>
          <div><strong>Say how to support you</strong><p>Turn context into a usable social cue.</p></div>
        </div>
        <label>
          <span>How to show up</span>
          <input value={showUp} maxLength={280} onChange={(event) => setShowUp(event.target.value)} placeholder="e.g. Quiet encouragement is welcome" />
        </label>
      </section>
      <section className="profile-context-quick__section">
        <div className="profile-context-quick__section-heading">
          <b>4</b>
          <div><strong>Choose the boundary</strong><p>Decide who can see this and when it should disappear.</p></div>
        </div>
        <div className="profile-context-policy-grid">
          <AudiencePicker value={audience} onChange={setAudience} people={people} recipientIds={recipientIds} onRecipientsChange={setRecipientIds} />
          <FreshnessPicker value={hours} onChange={setHours} />
        </div>
      </section>
      <footer>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        <button className="primary" type="submit" disabled={!canSave || saving}>{saving ? 'Saving…' : 'Share context'}</button>
      </footer>
    </form>
  );
}
