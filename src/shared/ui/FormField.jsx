import '@shared/ui/UI.css';

export default function FormField({ label, hint, error, required, children, className = '' }) {
  return (
    <label className={`ui-form-field ${className}`}>
      <span className="ui-form-field__label">{label}{required ? ' *' : ''}</span>
      {children}
      {error ? <span className="ui-form-field__error">{error}</span> : hint ? <span className="ui-form-field__hint">{hint}</span> : null}
    </label>
  );
}
