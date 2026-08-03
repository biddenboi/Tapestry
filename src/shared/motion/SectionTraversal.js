const ACTIVE_ATTRIBUTE = 'data-traversal-active';
const DIRECTION_ATTRIBUTE = 'data-traversal-direction';
const TOKEN_ATTRIBUTE = 'data-traversal-token';

function resolveTraversalScope(source) {
  if (!source?.closest) return null;
  return source.closest([
    '[data-traversal-surface]',
    '.hub-page',
    '.profile-page',
    '.settings-page',
    '.inventory-page',
    '.chronicle-page',
    '.dojo',
    '.match-section-shell',
  ].join(',')) || source.parentElement;
}

export function traversalDirection(fromIndex, toIndex) {
  if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || fromIndex === toIndex) {
    return 'replace';
  }
  return toIndex > fromIndex ? 'forward' : 'backward';
}

export function announceSectionTraversal(source, { fromIndex, toIndex } = {}) {
  if (typeof window === 'undefined') return null;
  const scope = resolveTraversalScope(source);
  if (!scope) return null;

  const token = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  scope.setAttribute(TOKEN_ATTRIBUTE, token);
  scope.setAttribute(DIRECTION_ATTRIBUTE, traversalDirection(fromIndex, toIndex));
  scope.removeAttribute(ACTIVE_ATTRIBUTE);

  window.requestAnimationFrame(() => {
    if (scope.getAttribute(TOKEN_ATTRIBUTE) !== token) return;
    scope.setAttribute(ACTIVE_ATTRIBUTE, 'true');
    window.setTimeout(() => {
      if (scope.getAttribute(TOKEN_ATTRIBUTE) !== token) return;
      scope.removeAttribute(ACTIVE_ATTRIBUTE);
      scope.removeAttribute(DIRECTION_ATTRIBUTE);
      scope.removeAttribute(TOKEN_ATTRIBUTE);
    }, 720);
  });

  return scope;
}

