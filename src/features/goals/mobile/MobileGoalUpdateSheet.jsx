import { useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { simpleMobileFeedback } from '@app/mobile/application/MobileFeedback.js';

export default function MobileGoalUpdateSheet({ payload }) {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const { closeSurface, presentFeedback } = useMobileSurface();
  const { detail, onPosted } = payload;
  const [summary, setSummary] = useState('');
  const [metricValue, setMetricValue] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const post = async (event) => {
    event.preventDefault();
    if (!summary.trim() || posting) return;
    setPosting(true);
    setError('');
    try {
      const result = await databaseConnection.getRepository('goals').postUpdate(detail.goal, currentPlayer, {
        summary: summary.trim(),
        metricCurrentValue: detail.goal.progressType === 'metric' && metricValue !== '' ? Number(metricValue) : undefined,
        origin: 'mobile',
      });
      invalidateDomains(DOMAIN_INVALIDATION.goalWrite);
      presentFeedback(simpleMobileFeedback('goal-progress', `${detail.goal.name} updated`, {
        significance: 'meaningful',
        sourceId: result.update?.UUID || result.goal.UUID,
      }));
      await onPosted?.(result);
      closeSurface({ force: true });
    } catch (postError) {
      setError(postError?.message || 'The Goal update could not be posted.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <form className="mobile-sheet mobile-sheet--editor mobile-goal-update-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-goal-update-title" onSubmit={post}>
      <header><button type="button" onClick={() => closeSurface()}>Cancel</button><h2 id="mobile-goal-update-title">Progress update</h2><button type="submit" className="primary" disabled={posting || !summary.trim()}>{posting ? 'Posting…' : 'Post'}</button></header>
      <div className="mobile-sheet-scroll">
        <p className="mobile-sheet-context">{detail.goal.name}</p>
        <label className="mobile-field mobile-field--hero"><span>What moved forward?</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={500} rows={7} autoFocus data-autofocus="true" /></label>
        {detail.goal.progressType === 'metric' && <label className="mobile-field"><span>Current {detail.goal.metric?.unit || 'value'}</span><input type="number" value={metricValue} onChange={(event) => setMetricValue(event.target.value)} /></label>}
        {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
      </div>
      <footer><button type="submit" className="primary" disabled={posting || !summary.trim()}>{posting ? 'Posting…' : 'Post update'}</button></footer>
    </form>
  );
}
