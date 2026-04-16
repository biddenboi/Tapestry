import './NotificationCenter.css';

export default function NotificationCenter({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast-card toast-${toast.kind || 'info'}`}
          onClick={() => onDismiss?.(toast.id)}
        >
          <span className="toast-title">{toast.title || 'Notice'}</span>
          <span className="toast-message">{toast.message}</span>
        </button>
      ))}
    </div>
  );
}
