export default function NextMoveAlternatives({ alternatives = [], onChoose, onManual }) {
  return (
    <div className="next-move-alternatives" aria-label="Other moves">
      {alternatives.map((alternative) => (
        <button
          type="button"
          key={`${alternative.entityUUID || ''}:${alternative.title}`}
          onClick={() => onChoose?.(alternative)}
        >
          <span>Start something else</span>
          <strong>{alternative.title}</strong>
        </button>
      ))}
      <button type="button" onClick={onManual}>
        <span>Manual</span>
        <strong>Choose from Tasks</strong>
      </button>
    </div>
  );
}
