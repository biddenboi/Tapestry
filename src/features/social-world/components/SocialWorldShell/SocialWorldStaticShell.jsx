import './SocialWorldShell.css';
import { occupantGroupHeadingId } from '../../navigation/OccupantFocusReturn.js';

export default function SocialWorldStaticShell({ label = 'Loading world' }) {
  return (
    <section className="social-world-shell social-world-shell--static" aria-label="Tapestry social world">
      <div className="social-world-atmosphere" aria-hidden="true" />
      <div className="social-world-route-map social-world-route-map--loading" aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
      </div>
      <div className="social-world-static-card" role="status">
        <span>Tapestry</span>
        <strong id={occupantGroupHeadingId('social-world')} tabIndex="-1">{label}</strong>
        <i aria-hidden="true" />
      </div>
    </section>
  );
}
