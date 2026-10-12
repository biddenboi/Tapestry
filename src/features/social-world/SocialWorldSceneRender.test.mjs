import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildSocialWorldScene } from '@domain/social-world/SocialWorldScene.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({
  root,
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
});
test.after(() => server.close());
const { default: SocialWorldScene } = await server.ssrLoadModule(
  '/src/features/social-world/components/SocialWorldShell/SocialWorldScene.jsx',
);

test('the full social scene renders when historical locations have no current layout', () => {
  const scene = buildSocialWorldScene({
    viewerId: 'viewer',
    viewerIGT: 1000,
    viewerProfile: { UUID: 'viewer', username: 'Viewer' },
    residency: { friends: [], dynamic: [] },
    presences: {},
  });
  // The persisted semantic contract still includes Dojo after its UI retirement.
  assert.ok(scene.locations.some((location) => location.id === 'dojo'));
  const html = renderToStaticMarkup(createElement(SocialWorldScene, {
    scene, viewerIGT: 1000,
  }));
  assert.match(html, /data-location="commons"/);
  assert.match(html, /data-location="task-session"/);
  assert.doesNotMatch(html, /data-location="dojo"/);
  assert.match(html, /Away from the live scene/);
});
