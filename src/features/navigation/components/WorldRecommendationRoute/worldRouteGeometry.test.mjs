import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorldRouteGeometry,
  edgeAnchor,
  worldRouteGeometryChanged,
} from './worldRouteGeometry.js';

const rect = (left, top, width, height) => ({ left, top, width, height });
const viewport = rect(20.25, 40.5, 1200.5, 760.25);

function geometry(originRect, destinationRect, options = {}) {
  return buildWorldRouteGeometry({
    viewportRect: viewport,
    originRect,
    destinationRect,
    ...options,
  });
}

test('anchors connect the facing left and right edges', () => {
  const route = geometry(rect(120, 280, 180, 100), rect(820, 260, 200, 120));
  assert.ok(route.start.x > 279 && route.start.x < 283);
  assert.ok(route.end.x > 797 && route.end.x < 801);
  assert.ok(route.start.y > 245 && route.start.y < 310);
  assert.ok(route.path.startsWith('M '));
});

test('anchors connect the facing top and bottom edges', () => {
  const route = geometry(rect(420, 580, 180, 90), rect(430, 120, 180, 100));
  assert.ok(route.start.y < 541.5);
  assert.ok(route.end.y > 179);
});

test('diagonal routes stay clear of rounded corners', () => {
  const anchor = edgeAnchor(
    rect(0, 0, 200, 100),
    { x: 500, y: -300 },
    { cornerRadius: 18, outwardOffset: 0 },
  );
  assert.equal(anchor.y, 0);
  assert.ok(anchor.x >= 20 && anchor.x <= 180);
});

test('zero-distance anchors remain finite', () => {
  const anchor = edgeAnchor(rect(10, 20, 100, 80), { x: 60, y: 60 });
  assert.deepEqual(anchor, { x: 60, y: 60 });
});

test('wide, narrow, and fractional viewports preserve CSS-pixel geometry', () => {
  for (const candidateViewport of [
    rect(0, 0, 1800, 640),
    rect(3.75, 4.5, 360.25, 780.5),
    rect(12.125, 20.875, 999.75, 701.25),
  ]) {
    const route = buildWorldRouteGeometry({
      viewportRect: candidateViewport,
      originRect: rect(candidateViewport.left + 20.5, candidateViewport.top + 40.25, 90.5, 60.25),
      destinationRect: rect(candidateViewport.left + candidateViewport.width - 130.75, candidateViewport.top + 180.5, 100.25, 72.5),
    });
    assert.equal(route.width, candidateViewport.width);
    assert.equal(route.height, candidateViewport.height);
    assert.ok(Number.isFinite(route.start.x));
    assert.ok(Number.isFinite(route.end.y));
  }
});

test('sub-quarter-pixel changes do not churn geometry state', () => {
  const initial = geometry(rect(120, 280, 180, 100), rect(820, 260, 200, 120));
  const tiny = {
    ...initial,
    start: { ...initial.start, x: initial.start.x + 0.1 },
  };
  const material = {
    ...initial,
    end: { ...initial.end, y: initial.end.y + 0.25 },
  };
  assert.equal(worldRouteGeometryChanged(initial, tiny), false);
  assert.equal(worldRouteGeometryChanged(initial, material), true);
});
