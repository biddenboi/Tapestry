const DEFAULT_CORNER_CLEARANCE = 2;
const DEFAULT_EDGE_OFFSET = 2;

const finite = (value) => Number.isFinite(Number(value));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function normalizeRect(rect) {
  if (!rect) return null;
  const left = Number(rect.left ?? rect.x);
  const top = Number(rect.top ?? rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(finite) || width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

export function toLocalRect(rect, viewportRect) {
  const normalized = normalizeRect(rect);
  const viewport = normalizeRect(viewportRect);
  if (!normalized || !viewport) return null;
  return {
    left: normalized.left - viewport.left,
    top: normalized.top - viewport.top,
    width: normalized.width,
    height: normalized.height,
    right: normalized.right - viewport.left,
    bottom: normalized.bottom - viewport.top,
  };
}

export function rectCenter(rect) {
  const normalized = normalizeRect(rect);
  if (!normalized) return null;
  return {
    x: normalized.left + normalized.width / 2,
    y: normalized.top + normalized.height / 2,
  };
}

export function parseRenderedCornerRadius(style) {
  if (!style) return 0;
  const values = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ];
  return values.reduce((largest, value) => {
    const parsed = Number.parseFloat(String(value || '0'));
    return Number.isFinite(parsed) ? Math.max(largest, parsed) : largest;
  }, 0);
}

export function edgeAnchor(rect, target, {
  cornerRadius = 0,
  cornerClearance = DEFAULT_CORNER_CLEARANCE,
  outwardOffset = DEFAULT_EDGE_OFFSET,
} = {}) {
  const normalized = normalizeRect(rect);
  if (!normalized || !finite(target?.x) || !finite(target?.y)) return null;

  const center = rectCenter(normalized);
  const deltaX = Number(target.x) - center.x;
  const deltaY = Number(target.y) - center.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < Number.EPSILON) return center;

  const halfWidth = normalized.width / 2;
  const halfHeight = normalized.height / 2;
  const xRatio = Math.abs(deltaX) / halfWidth;
  const yRatio = Math.abs(deltaY) / halfHeight;
  const scale = 1 / Math.max(xRatio, yRatio);
  let x = center.x + deltaX * scale;
  let y = center.y + deltaY * scale;

  const safeInset = clamp(
    Math.max(0, Number(cornerRadius) || 0) + Math.max(0, Number(cornerClearance) || 0),
    0,
    Math.max(0, Math.min(halfWidth, halfHeight) - 0.5),
  );
  if (xRatio >= yRatio) {
    y = clamp(y, normalized.top + safeInset, normalized.bottom - safeInset);
  } else {
    x = clamp(x, normalized.left + safeInset, normalized.right - safeInset);
  }

  const offset = Math.max(0, Number(outwardOffset) || 0);
  return {
    x: x + (deltaX / distance) * offset,
    y: y + (deltaY / distance) * offset,
  };
}

export function buildRoutePath(start, end) {
  if (![start?.x, start?.y, end?.x, end?.y].every(finite)) return '';
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const horizontal = Math.abs(deltaX) >= Math.abs(deltaY);
  const bend = horizontal
    ? Math.min(44, Math.abs(deltaY) * 0.18)
    : Math.min(44, Math.abs(deltaX) * 0.18);
  const bendSign = (deltaX * deltaY >= 0 ? 1 : -1);
  const control1 = horizontal
    ? { x: start.x + deltaX * 0.34, y: start.y + bend * bendSign }
    : { x: start.x + bend * bendSign, y: start.y + deltaY * 0.34 };
  const control2 = horizontal
    ? { x: end.x - deltaX * 0.34, y: end.y - bend * bendSign }
    : { x: end.x - bend * bendSign, y: end.y - deltaY * 0.34 };
  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `C ${control1.x.toFixed(2)} ${control1.y.toFixed(2)}`,
    `${control2.x.toFixed(2)} ${control2.y.toFixed(2)}`,
    `${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
  ].join(' ');
}

export function buildWorldRouteGeometry({
  viewportRect,
  originRect,
  destinationRect,
  originCornerRadius = 0,
  destinationCornerRadius = 0,
} = {}) {
  const viewport = normalizeRect(viewportRect);
  const origin = toLocalRect(originRect, viewportRect);
  const destination = toLocalRect(destinationRect, viewportRect);
  if (!viewport || !origin || !destination) return null;

  const originCenter = rectCenter(origin);
  const destinationCenter = rectCenter(destination);
  const start = edgeAnchor(origin, destinationCenter, { cornerRadius: originCornerRadius });
  const end = edgeAnchor(destination, originCenter, { cornerRadius: destinationCornerRadius });
  if (!start || !end) return null;

  return {
    width: viewport.width,
    height: viewport.height,
    start,
    end,
    path: buildRoutePath(start, end),
  };
}

export function worldRouteGeometryChanged(previous, next, tolerance = 0.25) {
  if (!previous || !next) return previous !== next;
  const fields = [
    previous.width - next.width,
    previous.height - next.height,
    previous.start.x - next.start.x,
    previous.start.y - next.start.y,
    previous.end.x - next.end.x,
    previous.end.y - next.end.y,
  ];
  return fields.some((difference) => Math.abs(difference) >= tolerance);
}
