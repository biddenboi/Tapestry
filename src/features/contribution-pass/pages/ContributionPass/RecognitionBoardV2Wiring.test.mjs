import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [board, styles] = await Promise.all([
  read('./RecognitionBoardV2.jsx'),
  read('./RecognitionBoardV2.css'),
]);

test('frontier is a camera jump and never filters the continuous Road', () => {
  assert.match(board, /visibleNodes\s*=\s*useMemo\(\(\)\s*=>\s*progress\.nodes\.filter\(\(node\)\s*=>\s*node\.state\s*!==\s*'hidden'\)/);
  assert.match(board, />Frontier<\/button>/);
  assert.doesNotMatch(board, /className="recognition-v2__chapters"/);
  assert.doesNotMatch(styles, /\.recognition-v2__chapters/);
});

test('the compact Road header explains panning without claiming to hide chapters', () => {
  assert.match(board, /Every chapter remains on one continuous Road/);
  assert.match(board, /Return to frontier/);
  assert.match(board, /Home frontier/);
});

test('bundled reduced-motion and high-contrast settings affect the Board', () => {
  assert.match(styles, /\[data-reduced-motion='true'\] \.recognition-v2__canvas/);
  assert.match(styles, /\[data-high-contrast='true'\] \.recognition-node/);
});
