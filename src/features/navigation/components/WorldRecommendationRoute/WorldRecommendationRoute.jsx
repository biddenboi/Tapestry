import useWorldRouteGeometry from './useWorldRouteGeometry.js';
import './WorldRecommendationRoute.css';

export default function WorldRecommendationRoute({
  route,
  worldViewportRef,
  originElement,
  destinationElement,
  visible = true,
}) {
  const recommendationId = route?.recommendationId
    || `${route?.locationId || 'none'}:${route?.label || ''}`;
  const { geometry, compact } = useWorldRouteGeometry({
    worldViewportRef,
    originElement,
    destinationElement,
    recommendationId,
    visible: visible && Boolean(route?.locationId),
  });

  if (!visible || !route?.locationId || !geometry || compact) return null;
  return (
    <svg
      className="world-recommendation-route"
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-route-from="commons"
      data-route-to={route.locationId}
    >
      <path className="world-recommendation-route__path" d={geometry.path} />
      <circle
        className="world-recommendation-route__origin-halo"
        cx={geometry.start.x}
        cy={geometry.start.y}
        r="5"
      />
      <circle
        className="world-recommendation-route__origin-core"
        cx={geometry.start.x}
        cy={geometry.start.y}
        r="2"
      />
      <circle
        className="world-recommendation-route__destination-ring"
        cx={geometry.end.x}
        cy={geometry.end.y}
        r="5"
      />
      <circle
        className="world-recommendation-route__destination-core"
        cx={geometry.end.x}
        cy={geometry.end.y}
        r="2.5"
      />
    </svg>
  );
}
