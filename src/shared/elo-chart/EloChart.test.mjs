import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./EloChart.jsx', import.meta.url), 'utf8');
source = source
  .replace("import '@shared/elo-chart/EloChart.css';", '')
  .replace(/import \{[^\n]+\} from 'react';/, '');
source = source.slice(0, source.indexOf('export default function EloChart'));
const chart = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const DAY = 86_400_000;

test('IGT projection excludes future results and carries only the cutoff baseline', () => {
  const data = [
    { t: 100, elo: 1000, baseline: true },
    { t: 200, elo: 1020, matchUUID: 'visible' },
    { t: 300, elo: 1040, matchUUID: 'future' },
  ];
  const projected = chart.projectEloChartSpan(data, {
    timeBasis: 'igt', viewerIGT: 250, span: 'all',
  });
  assert.deepEqual(projected.points.map((point) => point.matchUUID || 'baseline'), ['baseline', 'visible']);
  assert.equal(projected.resultCount, 1);
});

test('Today means the current IGT day and uses the prior visible result as baseline', () => {
  const projected = chart.projectEloChartSpan([
    { t: 0, elo: 1000, baseline: true },
    { t: DAY - 10, elo: 1010, matchUUID: 'prior' },
    { t: DAY + 5, elo: 1025, matchUUID: 'today' },
    { t: DAY + 20, elo: 1050, matchUUID: 'future' },
  ], {
    timeBasis: 'igt', viewerIGT: DAY + 10, span: 'today',
  });
  assert.equal(projected.cutoff, DAY);
  assert.deepEqual(projected.points.map((point) => point.matchUUID), ['prior', 'today']);
  assert.equal(projected.points[0].carried, true);
  assert.equal(projected.resultCount, 1);
  assert.equal(chart.formatEloChartIGT(DAY + 3_720_000), 'D2 01:02');
});
