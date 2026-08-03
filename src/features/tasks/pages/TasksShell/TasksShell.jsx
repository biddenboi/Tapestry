import PageHeader from '@shared/ui/PageHeader.jsx';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import useOpeningTrail from '@features/opening-trail/useOpeningTrail.js';

export const TASK_LOCAL_PAGES = Object.freeze([
  { id: 'now', label: 'Now', icon: 'play', deepLinkKey: 'tasks-now', requiredDomains: ['tasks'], description: 'Choose one clear current move and begin a focused session.' },
  { id: 'queue', label: 'Queue', icon: 'list', deepLinkKey: 'tasks-queue', requiredDomains: ['tasks'], capability: 'tasks.queue', description: 'Order the work that is ready without crowding the current move.' },
  { id: 'all', label: 'All Tasks', icon: 'checklist', deepLinkKey: 'tasks-all', requiredDomains: ['tasks'], capability: 'tasks.all', description: 'Search and manage the complete task collection.' },
  { id: 'planning', label: 'Planning', icon: 'calendar', deepLinkKey: 'tasks-planning', requiredDomains: ['tasks', 'reminders'], capability: 'tasks.planning', description: 'Shape reminders, timing, and future work before it becomes current.' },
  { id: 'history', label: 'History', icon: 'history', deepLinkKey: 'tasks-history', requiredDomains: ['tasks'], capability: 'tasks.history', description: 'Review settled sessions and completed work evidence.' },
]);

export default function TasksShell({
  activePageId,
  onPageChange,
  actions,
  children,
  className = '',
}) {
  const openingTrail = useOpeningTrail();
  const navItems = TASK_LOCAL_PAGES.map((item) => ({
    ...item,
    silhouette: Boolean(item.capability && !openingTrail.isRevealed(item.capability)),
    revealHint: item.capability ? `Reveals after ${item.id === 'queue' ? 'your first task' : item.id === 'all' ? 'your first session outcome' : item.id === 'history' ? 'two task completions or a successful resume' : 'a reminder or three queued tasks'}.` : null,
  }));
  return (
    <div className={`tasks-shell ${className}`}>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        className="todo-hub-header"
        actions={actions}
      />
      <LocalSectionNav
        items={navItems}
        value={activePageId}
        onChange={onPageChange}
        label="Task sections"
        compact
      />
      {children}
    </div>
  );
}
