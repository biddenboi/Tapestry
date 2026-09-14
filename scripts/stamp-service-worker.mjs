import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function stampServiceWorker(directory) {
  const path = join(directory, 'service-worker.js');
  const source = readFileSync(path, 'utf8');
  const buildId = createHash('sha256')
    .update(readFileSync(join(directory, 'index.html')))
    .update(source)
    .digest('hex').slice(0, 16);
  writeFileSync(path, source.replaceAll('__TAPESTRY_BUILD_ID__', buildId));
}
