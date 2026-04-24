import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useEffect } from 'react';
import './UpgradePopup.css';

export default NiceModal.create(() => {
  const modal = useModal();

  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { modal.hide(); modal.remove(); } };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const benefits = [
    {
      icon: '⟳',
      title: 'Smart next-task suggestion',
      desc: 'Canopy automatically surfaces the most urgent, highest-priority task from your trees so you never wonder what to do next.',
    },
    {
      icon: '◷',
      title: 'Deadlines & duration estimates',
      desc: 'Set due dates and time estimates on tasks. Canopy uses these to schedule your work intelligently across your goal trees.',
    },
    {
      icon: '⊕',
      title: 'Unlimited trees',
      desc: 'Build as many goal trees as your life requires. Free accounts are limited to three.',
    },
  ];

  return modal.visible ? (
    <div className="modal-blanker upgrade-blanker">
      <div className="modal-card upgrade-card">
        <div className="upgrade-header">
          <div>
            <span className="upgrade-eyebrow">canopy full access</span>
            <h2 className="upgrade-title">Think in trees, not lists.</h2>
          </div>
          <button className="btn-ghost" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>

        <div className="upgrade-benefits">
          {benefits.map(b => (
            <div className="upgrade-benefit" key={b.title}>
              <div className="upgrade-benefit-icon">{b.icon}</div>
              <div>
                <p className="upgrade-benefit-title">{b.title}</p>
                <p className="upgrade-benefit-desc">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="upgrade-footer">
          <a
            className="upgrade-cta"
            href="#"
            onClick={e => e.preventDefault()}
            title="Purchase page coming soon"
          >
            Get access →
          </a>
          <span className="upgrade-coming-soon">Purchase page coming soon</span>
        </div>
      </div>
    </div>
  ) : null;
});
