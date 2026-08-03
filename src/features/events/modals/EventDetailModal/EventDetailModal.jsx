import '@features/events/modals/EventDetailModal/EventDetailModal.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { UTCStringToLocalDate, UTCStringToLocalTime } from '@domain/time/Time.js';
import { useResourceUrl } from '@shared/resource-image/ResourceImage.jsx';
import { EVENT_TERMINOLOGY } from '@features/events/terminology.js';

function formatDateTime(value) {
  if (!value) return null;
  return `${UTCStringToLocalDate(value)} ${UTCStringToLocalTime(value)}`;
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `$${Math.abs(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DetailMetric({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div>
      <span className="detail-k">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getActivityModel(item) {
  const type = item.originalType || item.type || 'event';
  const timestamp = item.loggedAt || item.completedAt || item.createdAt;
  const amount = Number(item.amount ?? item.cost);
  const hasAmount = Number.isFinite(amount) && (item.amount != null || item.cost != null);
  const isMoney = type === 'money_log' || type === 'transaction';
  const isItem = type === 'item_use';
  const isEventLog = item.loggedAt || item.eventUUID || item.status;

  if (isMoney) {
    const positive = type === 'money_log' || amount >= 0;
    return {
      eyebrow: type === 'money_log' ? 'ECONOMY LOG' : 'TRANSACTION',
      title: item.name || item.description || 'Economy record',
      tone: positive ? 'income' : 'expense',
      primary: `${positive ? '+' : '-'}${formatCurrency(amount) || '$0.00'}`,
      primaryLabel: positive ? 'INCOME' : 'SPEND',
      caption: item.description || 'Balance movement recorded.',
      kind: 'Economy',
      timestamp,
    };
  }

  if (isItem) {
    return {
      eyebrow: 'ITEM USE',
      title: item.name || 'Item used',
      tone: 'item',
      primary: 'USE',
      primaryLabel: item.category || item.itemType || 'ITEM',
      caption: item.description || `Used ${item.name || 'an item'}.`,
      kind: 'Inventory',
      imageUrl: item.bannerImageUrl || null,
      timestamp,
    };
  }

  if (isEventLog) {
    const activityType = type === 'quantity'
      ? EVENT_TERMINOLOGY.types.quantity
      : type === 'duration'
        ? EVENT_TERMINOLOGY.types.duration
        : type === 'special'
          ? EVENT_TERMINOLOGY.types.special
          : EVENT_TERMINOLOGY.types.oneTime;
    return {
      eyebrow: `${activityType.toUpperCase()} LOG`,
      title: item.name || item.title || titleCase(item.specialKind || activityType),
      tone: item.status === 'failure' ? 'warning' : 'event',
      primary: item.value != null ? Number(item.value || 0).toLocaleString() : titleCase(item.status || 'Log'),
      primaryLabel: item.specialKind ? titleCase(item.specialKind) : activityType,
      caption: item.description || `${titleCase(item.status || 'Logged')} ${activityType.toLowerCase()} activity.`,
      kind: activityType,
      timestamp,
    };
  }

  return {
    eyebrow: 'ACTIVITY DETAIL',
    title: item.description || item.title || item.name || 'Activity detail',
    tone: 'event',
    primary: titleCase(type).slice(0, 4).toUpperCase() || 'HAB',
    primaryLabel: titleCase(type || 'Habit'),
    caption: item.description || item.title || item.name || 'No additional details.',
    kind: titleCase(type || 'Habit'),
    timestamp,
  };
}

export default NiceModal.create(({ item }) => {
  const modal = useModal();
  const itemImageUrl = useResourceUrl(item?.bannerImageUrl);
  if (!modal.visible || !item) return null;

  const model = {
    ...getActivityModel(item),
    imageUrl: item?.bannerImageUrl ? itemImageUrl : null,
  };
  const timestamp = model.timestamp;
  const amount = item.amount ?? item.cost;
  const detailText = item.description || item.title || item.name;
  const showDetailText = detailText && detailText !== model.title && detailText !== model.caption;

  return (
    <div className="detail-overlay">
      <div className="blanker" onClick={() => { modal.hide(); modal.remove(); }} />
      <div className="detail-card event-detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-eyebrow">{model.eyebrow}</div>
            <h2 className="detail-title">{model.title}</h2>
          </div>
          <button className="close-btn" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>

        <div className="detail-body">
          <div className={`event-detail-summary event-detail-summary--${model.tone} ${model.imageUrl ? 'event-detail-summary--with-image' : ''}`}>
            {model.imageUrl && (
              <div className="event-detail-image" style={{ backgroundImage: `url(${model.imageUrl})` }} aria-hidden="true" />
            )}
            <div className="event-detail-summary-copy">
              <span className="event-detail-summary-k">{model.kind} record</span>
              <div className="event-detail-primary">
                <strong>{model.primary}</strong>
                <span>{model.primaryLabel}</span>
              </div>
              <p>{model.caption}</p>
            </div>
            <time className="event-detail-time">{timestamp ? formatDateTime(timestamp) : 'Unknown time'}</time>
          </div>

          <div className="detail-grid event-detail-stats">
            <DetailMetric label="Type" value={titleCase(item.originalType || item.type || '')} />
            <DetailMetric label="Category" value={item.category || item.itemType} />
            <DetailMetric label="Amount" value={amount != null ? formatCurrency(amount) : null} />
            <DetailMetric label="Quantity" value={item.quantity != null ? item.quantity : null} />
            <DetailMetric label="Status" value={item.status ? titleCase(item.status) : null} />
            <DetailMetric label="Logged Date" value={item.loggedDate} />
          </div>

          {(showDetailText || item.createdAt || item.completedAt || item.loggedAt) && <div className="event-detail-lower">
            {showDetailText && (
            <div className="detail-section">
              <div className="detail-k">Details</div>
              <p className="detail-copy">{detailText}</p>
            </div>
            )}
            {(item.loggedAt || item.completedAt || item.createdAt) && (
              <div className="detail-section event-detail-timestamps">
                <div className="detail-k">Timestamps</div>
                <dl>
                  {item.createdAt && (
                    <>
                      <dt>Created</dt>
                      <dd>{formatDateTime(item.createdAt)}</dd>
                    </>
                  )}
                  {item.completedAt && (
                    <>
                      <dt>Completed</dt>
                      <dd>{formatDateTime(item.completedAt)}</dd>
                    </>
                  )}
                  {item.loggedAt && (
                    <>
                      <dt>Logged</dt>
                      <dd>{formatDateTime(item.loggedAt)}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  );
});
