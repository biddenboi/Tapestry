import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { DAY, STORES } from '@domain/constants.js';
import {
  GATE_KINDS, GATE_RULES, GATE_STEPS, GATE_SETTING_ID, GATE_SCHEMA_VERSION,
  gateConditions, todayLock, gateItemPrice, gateItemMissing, isGateItemReady,
  captureGateItem, editGateItem, deleteGateItem, openGateWindow, advanceGateItem,
  addGateCheck, toggleGateCheck, returnGateItem, releaseGateWindow,
} from '@domain/gate/Gate.js';
import { buildDesignPrompt, buildBuildPrompt } from '@domain/gate/GatePrompts.js';
import { loadGate, saveGate, loadGateInputs, lockItemWithCoins } from '@features/gate/gateCommands.js';
import './Gate.css';

const dateLabel = (value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const priceLabel = (kind) => gateItemPrice(kind) ? `${gateItemPrice(kind)} ◈` : 'free';
const emptyDraft = () => ({ kind: 'bug', text: '', why: '', replaces: '' });
const errors = {
  'missing-estimate': 'Enter the estimate in whole minutes from the design note.',
  'insufficient-coins': 'You do not have enough coins to lock this item.',
  'checks-open': 'Add at least one hand check and tick every check before finishing.',
  'missing-name': 'Give this release a name.',
  'not-earned': 'Meet all three conditions before opening a release window.',
  'item-not-ready': 'Finish the why and replacement before locking this item.',
  'window-full': 'Release is full.',
};

function ItemForm({ initial, disabled, submitLabel, onSubmit, onCancel }) {
  const [draft, setDraft] = useState(() => initial || emptyDraft());
  const field = (key) => ({ value: draft[key], onChange: (event) => setDraft({ ...draft, [key]: event.target.value }) });
  return <form className="gate-item-form" onSubmit={async (event) => {
    event.preventDefault();
    if (await onSubmit(draft)) setDraft(emptyDraft());
  }}>
    <fieldset disabled={disabled}>
      <div className="gate-capture-line">
        <label className="gate-grow">One line<input required placeholder="One line: what bothered you?" {...field('text')} /></label>
        <label>Kind<select {...field('kind')}>{GATE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <button className="gate-primary" type="submit">{submitLabel}</button>
      </div>
      <label>Why<input placeholder="A one-line why" {...field('why')} /></label>
      {draft.kind === 'add' && <label>Replaces or deletes<input placeholder="What it replaces or deletes" {...field('replaces')} /></label>}
      {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
    </fieldset>
  </form>;
}
function Condition({ label, value, needed, met, display }) {
  return <div className="gate-condition">
    <div className="gate-row"><span>{label}</span><span className={met ? 'gate-success' : ''}>{display}</span></div>
    <progress aria-label={label} value={Math.min(value, needed)} max={needed} />
  </div>;
}
function CheckForm({ onAdd, disabled }) {
  const [text, setText] = useState('');
  return <form className="gate-check-form" onSubmit={async (event) => {
    event.preventDefault(); if (await onAdd(text)) setText('');
  }}><label className="gate-grow">Add a hand check<input disabled={disabled} required value={text} onChange={(event) => setText(event.target.value)} placeholder="What will you check by hand?" /></label><button disabled={disabled} type="submit">Add check</button></form>;
}

export default function Gate() {
  const { databaseConnection: db, currentPlayer, invalidateDomains, domainRevisions, replacePanel } = useAppContext();
  const [gate, setGate] = useState(null);
  const [inputs, setInputs] = useState({ completedTasks: [], todos: [] });
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const writeInFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [estimates, setEstimates] = useState({});
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [releaseName, setReleaseName] = useState('');
  const [notes, setNotes] = useState('');
  const [installed, setInstalled] = useState(false);
  const refresh = useCallback(async () => {
    const [state, nextInputs] = await Promise.all([loadGate(db), loadGateInputs(db)]);
    setGate(state); setInputs(nextInputs); setNow(new Date());
  }, [db]);
  useEffect(() => {
    let active = true;
    (async () => {
      // Persist creation time so remounting never restarts the earning period.
      const record = await db.get(STORES.appSetting, GATE_SETTING_ID);
      if (record?.value?.schemaVersion !== GATE_SCHEMA_VERSION) await saveGate(db, await loadGate(db));
      if (active) await refresh();
    })().catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [db, refresh, domainRevisions.tasks, domainRevisions.dailyLifecycle]);
  useEffect(() => {
    const timer = setInterval(() => refresh().catch(reason => setError(reason.message)), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = async (operation, { capture = false } = {}) => {
    if (writeInFlight.current) return false;
    writeInFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const [fresh, freshInputs] = await Promise.all([loadGate(db), loadGateInputs(db)]);
      setGate(fresh); setInputs(freshInputs);
      if (!capture && todayLock(freshInputs.todos, new Date(), freshInputs.r1).locked) {
        setError("Locked until today's tasks are done"); return false;
      }
      await operation(fresh, freshInputs);
      invalidateDomains(['dailyLifecycle', 'tasks']);
      await refresh();
      return true;
    } catch (reason) { setError(errors[reason.code] || reason.message || 'The Gate could not save. Try again.'); return false; }
    finally { writeInFlight.current = false; setBusy(false); }
  };
  const write = (transform, options) => run(async (state, nextInputs) => saveGate(db, transform(state, nextInputs)), options);
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice('Prompt copied.'); }
    catch { setError('Could not copy the prompt. Check clipboard access and try again.'); }
  };
  if (!gate) return <div className="gate-panel"><p role={error ? 'alert' : 'status'}>{error || 'Loading the Gate…'}</p></div>;
  const conditions = gateConditions(gate, { completedTasks: inputs.completedTasks, now });
  const lock = todayLock(inputs.todos, now, inputs.r1);
  const disabled = busy || lock.locked;
  const status = gate.window ? 'Open' : conditions.allMet ? 'Ready' : 'Closed';
  const full = gate.window?.items.length >= GATE_RULES.maxItemsPerRelease;
  const selectedRelease = gate.releases.find((release) => release.number === selected);
  const hasDone = gate.window?.items.some((item) => item.step === 'done');
  const day = gate.window ? Math.max(1, Math.min(7, Math.floor((now - new Date(gate.window.openedAt)) / DAY) + 1)) : 0;

  return <section className={`gate-panel ${gate.window ? 'gate-panel--open' : ''}`} aria-label="The Gate">
    {error && <p className="gate-banner" role="alert">{error}</p>}
    {notice && <p className="gate-success" role="status">{notice}</p>}
    <div className="gate-layout">
    {lock.locked && <div className="gate-banner gate-lock-banner gate-row" role="status"><div><strong>{lock.margin ? 'Locked while work is behind pace' : "Locked until today's tasks are done"}</strong><p>{lock.count} left: {lock.names.slice(0, 3).join(', ')}{lock.count > 3 ? '…' : ''}. Capturing to the inbox still works.</p></div><button type="button" onClick={() => replacePanel('tasks')}>Open Tasks</button></div>}
      <aside className="gate-overview">
        <header className="gate-card">
          <div className="gate-row"><h1>The Gate</h1><div className="gate-row gate-header-status"><span className="gate-coins">◈ {currentPlayer?.tokens ?? 0}</span><span className={`gate-pill gate-pill--${status.toLowerCase()}`}>{status}</span></div></div>
          <p className="gate-muted">{gate.installedRelease == null ? 'Before the Gate' : `Running release v${gate.installedRelease}`}. Capture anything; nothing changes until the Gate opens.</p>
        </header>
        {!gate.window ? <section className="gate-card gate-conditions">
          <h2>To open, all three</h2>
          <div className="gate-row"><strong>Earned by use</strong><span className={conditions.allMet ? 'gate-success' : 'gate-warning'}>{conditions.allMet ? 'Ready' : 'Not yet'}</span></div>
          <Condition label="Tracked work since last release" value={conditions.use.hours} needed={conditions.use.needed} met={conditions.use.met} display={`${Math.floor(conditions.use.hours)} h ${Math.floor(conditions.use.hours * 60 + 1e-6) % 60} m / ${conditions.use.needed} h`} />
          <Condition label="Days since last release" value={conditions.days.elapsed} needed={conditions.days.needed} met={conditions.days.met} display={`${Math.floor(conditions.days.elapsed)} / ${conditions.days.needed}`} />
          <Condition label="Something to do" value={conditions.inbox.ready} needed={1} met={conditions.inbox.met} display={`${conditions.inbox.ready} ready`} />
          <p className="gate-muted gate-slack">Slack: {inputs.r1?.mode === 'margin' ? 'behind pace' : 'on pace'}</p>
          <div className="gate-condition-action"><button type="button" className="gate-primary gate-wide" disabled={disabled || !conditions.allMet} onClick={() => write((state, nextInputs) => openGateWindow(state, { conditions: gateConditions(state, { completedTasks: nextInputs.completedTasks, now: new Date() }), now: new Date() }))}>Open release window</button><p className="gate-muted">Items are paid for when you lock them at triage.</p></div>
        </section> : <section className="gate-card">
          <div className="gate-row"><h2>Release v{gate.window.release}</h2><span>{gate.window.items.length} of 3</span></div>
          <strong>Day {day} of 7 · ends {dateLabel(gate.window.endsAt)}</strong>
          <div className="gate-days" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index} className={index < day ? 'is-elapsed' : ''} />)}</div>
          <p className="gate-muted">Pick up to 3 for this release. Only ready items can be locked.</p>
        </section>}
      </aside>
      <section className="gate-card gate-inbox">
        <div className="gate-row"><h2>Inbox</h2><span className="gate-muted gate-prices">Prices: add {gateItemPrice('add')} · change {gateItemPrice('change')} · remove {gateItemPrice('remove')} · bug free</span></div>
        <ItemForm disabled={busy} submitLabel="Capture" onSubmit={(draft) => write((state) => captureGateItem(state, draft, { now: new Date(), id: uuid() }), { capture: true })} />
        <div className="gate-inbox-counts"><span className="gate-pill">All {gate.inbox.length}</span><span>Ready {conditions.inbox.ready}</span><span>Raw {gate.inbox.length - conditions.inbox.ready}</span></div>
        <div className="gate-item-list">{gate.inbox.map((item) => <article className={`gate-item ${!isGateItemReady(item) ? 'gate-item--raw' : ''}`} key={item.id}>
          <div className="gate-item-line"><span className={`gate-kind gate-kind--${item.kind}`}>{item.kind}</span><div className="gate-grow"><strong>{item.text}</strong>{item.why && <p className="gate-muted">Why: {item.why}</p>}{item.replaces && <p className="gate-muted">Replaces: {item.replaces}</p>}{!isGateItemReady(item) && <p className="gate-warning">Needs: {gateItemMissing(item).join('; ')}</p>}</div><span className={gateItemPrice(item.kind) ? 'gate-coins' : 'gate-muted'}>{priceLabel(item.kind)}</span></div>
          {gate.window && isGateItemReady(item) && <label>Estimate from design note (minutes)<input type="number" min="1" step="1" disabled={disabled || full} value={estimates[item.id] || ''} onChange={event => setEstimates({ ...estimates, [item.id]: event.target.value })} /></label>}
          <fieldset disabled={disabled} className="gate-item-actions"><button type="button" onClick={() => setEditing(editing === item.id ? null : item.id)}>Edit</button><button type="button" onClick={() => write((state) => deleteGateItem(state, item.id))}>Delete</button>{gate.window && isGateItemReady(item) && <button type="button" disabled={disabled || full} onClick={() => run(async (state) => {
            const player = await db.get(STORES.player, currentPlayer.UUID);
            const result = await lockItemWithCoins(db, player || currentPlayer, state, item.id, { estimateMinutes: Number(estimates[item.id]) });
            if (result.price > 0) invalidateDomains(DOMAIN_INVALIDATION.walletWrite);
          })}>{full ? 'Release is full' : `Lock · ${priceLabel(item.kind)}`}</button>}</fieldset>
          {editing === item.id && <ItemForm initial={item} disabled={disabled} submitLabel="Save" onCancel={() => setEditing(null)} onSubmit={async (patch) => { const saved = await write((state) => editGateItem(state, item.id, patch)); if (saved) setEditing(null); return saved; }} />}
        </article>)}</div>
        {!gate.inbox.length && <p className="gate-muted gate-empty">Capture something that needs to change.</p>}
        {gate.window && <p className="gate-muted gate-refunds">No refunds. Unshipped items return to the inbox and are paid for again.</p>}
      </section>
      <aside className="gate-history">
        <section className="gate-card"><h2>Past updates</h2>{!gate.releases.length && <p className="gate-muted">Your releases will appear here.</p>}{gate.releases.map((release) => <button type="button" key={release.number} disabled={disabled} className={`gate-history-item ${selected === release.number ? 'is-selected' : ''}`} onClick={() => setSelected(selected === release.number ? null : release.number)}><span className="gate-row"><strong>v{release.number} · {release.name}</strong><span>{dateLabel(release.releasedAt)}</span></span><span className="gate-muted">{release.items.length} items · {release.items.reduce((sum, item) => sum + item.price, 0)} ◈ spent</span></button>)}</section>
        {selectedRelease && <section className="gate-card gate-release-detail"><h2>v{selectedRelease.number} · {selectedRelease.name}</h2><h3>What went in</h3>{selectedRelease.items.map((item, index) => <div className="gate-history-detail-item" key={index}><span className={`gate-kind gate-kind--${item.kind}`}>{item.kind}</span><strong>{item.text}</strong><p className="gate-muted">{item.why}</p>{item.replaces && <p className="gate-muted">Replaces: {item.replaces}</p>}</div>)}<h3>Release notes</h3><p className="gate-notes">{selectedRelease.notes || 'No release notes.'}</p><h3>Rollback</h3><p className="gate-muted">Check out tag v{selectedRelease.number - 1}, build, install, then import the save bundle from before v{selectedRelease.number}.</p></section>}
      </aside>
      {gate.window && <>
        <section className="gate-window"><h2>Locked items</h2>{!gate.window.items.length && <p className="gate-muted">Lock a ready item from the inbox to begin.</p>}{gate.window.items.map((item) => <article className="gate-card gate-locked-item" key={item.id}>
          <div className="gate-item-line"><span className={`gate-kind gate-kind--${item.kind}`}>{item.kind}</span><strong className="gate-grow">{item.text}</strong><span className="gate-coins">paid {item.price} ◈ · {item.estimateMinutes || '?'} min</span></div>
          <ol className="gate-steps">{GATE_STEPS.map((step, index) => <li key={step} className={index < GATE_STEPS.indexOf(item.step) ? 'is-done' : item.step === step ? 'is-current' : ''} aria-current={item.step === step ? 'step' : undefined}>{step}{index < GATE_STEPS.indexOf(item.step) ? ' ✓' : ''}</li>)}</ol>
          <fieldset disabled={disabled} className="gate-item-actions"><button type="button" onClick={() => copy(buildDesignPrompt(item, gate.window.release))}>Copy design prompt</button>{item.step !== 'done' && <button type="button" onClick={() => write((state) => advanceGateItem(state, item.id))}>Advance to {GATE_STEPS[GATE_STEPS.indexOf(item.step) + 1]}</button>}<button type="button" onClick={() => write((state) => returnGateItem(state, item.id))}>Return to inbox</button></fieldset>
          {item.step === 'verify' && <div className="gate-checks"><h3>Your hand checks · {item.checks.filter((check) => check.done).length} of {item.checks.length}</h3>{item.checks.map((check) => <label className="gate-checkbox" key={check.id}><input type="checkbox" disabled={disabled} checked={check.done} onChange={() => write((state) => toggleGateCheck(state, item.id, check.id))} />{check.text}</label>)}<CheckForm disabled={disabled} onAdd={(text) => write((state) => addGateCheck(state, item.id, text, { checkId: uuid() }))} /></div>}
        </article>)}</section>
        <aside className="gate-card gate-release-form"><h2>Prompt for the AI</h2><pre className="gate-prompt">{buildBuildPrompt(gate.window)}</pre><button className="gate-wide" type="button" disabled={disabled} onClick={() => copy(buildBuildPrompt(gate.window))}>Copy build prompt</button><h2 className="gate-divider">Release checks</h2><p className="gate-muted">{gate.window.items.filter((item) => item.step === 'done').length} of {gate.window.items.length} items done. Unfinished items return to the inbox.</p>
          <form onSubmit={async (event) => { event.preventDefault(); if (!installed || !hasDone || disabled) return; if (await write((state) => releaseGateWindow(state, { name: releaseName, notes, now: new Date() }))) { setReleaseName(''); setNotes(''); setInstalled(false); } }}><fieldset disabled={disabled || !hasDone}><label>Release name<input required value={releaseName} onChange={(event) => setReleaseName(event.target.value)} /></label><label>Release notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><label className="gate-checkbox"><input type="checkbox" checked={installed} onChange={(event) => setInstalled(event.target.checked)} required />I exported a save bundle and installed this build</label><button className="gate-primary gate-wide" type="submit" disabled={disabled || !hasDone || !installed || !releaseName.trim()}>Release v{gate.window.release}</button></fieldset></form>
        </aside>
      </>}
    </div>
  </section>;
}
