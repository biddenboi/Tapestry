import { Suspense, useEffect, useMemo, useState } from 'react';

function LocalPageFrame({ page, active, children }) {
  return (
    <section
      id={`local-page-${page.deepLinkKey || page.id}`}
      className="local-section-page"
      role="tabpanel"
      aria-labelledby={`local-tab-${page.deepLinkKey || page.id}`}
      aria-hidden={!active}
      hidden={!active}
      tabIndex={active ? 0 : -1}
      data-local-page={page.id}
    >
      {children}
    </section>
  );
}

export default function LocalSectionRouteOutlet({
  pages = [],
  activePageId,
  pageProps = {},
  fallback = <div className="local-section-loading">Loading section…</div>,
}) {
  const initial = useMemo(() => new Set(activePageId ? [activePageId] : []), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [visited, setVisited] = useState(initial);

  useEffect(() => {
    if (!activePageId) return;
    setVisited((current) => (
      current.has(activePageId) ? current : new Set([...current, activePageId])
    ));
  }, [activePageId]);

  return pages.map((page) => {
    if (!visited.has(page.id) && page.id !== activePageId) return null;
    const Component = page.lazyComponent;
    return (
      <LocalPageFrame key={page.id} page={page} active={page.id === activePageId}>
        <Suspense fallback={fallback}>
          <Component {...pageProps} page={page} active={page.id === activePageId} />
        </Suspense>
      </LocalPageFrame>
    );
  });
}

