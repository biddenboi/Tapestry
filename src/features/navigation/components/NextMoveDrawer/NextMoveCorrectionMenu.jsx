const CORRECTIONS = [
  ['already-handled', 'Already handled'],
  ['not-possible-now', 'Not possible now'],
  ['not-important', 'No longer important'],
  ['wrong-context', 'Wrong deadline or context'],
  ['need-shorter', 'I need something shorter'],
  ['need-plan', 'I need to plan first'],
  ['manual-choice', 'I want to choose manually'],
];

export default function NextMoveCorrectionMenu({ onChoose, onClose }) {
  return (
    <div className="next-move-corrections" role="menu" aria-label="Correct this suggestion">
      <header>
        <strong>Correct this move</strong>
        <button type="button" onClick={onClose} aria-label="Close correction menu">×</button>
      </header>
      {CORRECTIONS.map(([type, label]) => (
        <button type="button" role="menuitem" key={type} onClick={() => onChoose?.(type)}>
          {label}
        </button>
      ))}
    </div>
  );
}
