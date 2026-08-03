export default function NextMoveExplanation({ explanation }) {
  return (
    <div className="next-move-explanation">
      <section>
        <span>Why now</span>
        <p>{explanation.whyNow}</p>
      </section>
      <section>
        <span>Why this</span>
        <p>{explanation.whyThis}</p>
      </section>
      <section>
        <span>What it unlocks</span>
        <p>{explanation.whatItUnlocks}</p>
      </section>
    </div>
  );
}
