export default function DayOrientation({ decision, onFollow }) {
  return (
    <section className="next-move-day-orientation">
      <span className="next-move-kicker">Today</span>
      <h2>{decision.title}</h2>
      <p>{decision.context}</p>
      <div className="next-move-day-orientation__row">
        <span>Now</span>
        <strong>Resolve the immediate ordering conflict</strong>
      </div>
      <div className="next-move-day-orientation__row">
        <span>Later anchor</span>
        <strong>Preserve the next fixed commitment</strong>
      </div>
      <button type="button" className="primary" onClick={onFollow}>Orient today</button>
    </section>
  );
}
