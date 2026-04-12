import { useState, useEffect } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import './OnboardingModal.css';

// ── Storage key ───────────────────────────────────────────────────────────────
const SEEN_KEY = 'canopy-onboarding-v1-seen';
export const markOnboardingSeen   = () => localStorage.setItem(SEEN_KEY, '1');
export const hasSeenOnboarding    = () => !!localStorage.getItem(SEEN_KEY);

// ── Step illustrations (inline SVG) ──────────────────────────────────────────

function IllustrationWelcome() {
  return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="ob-illustration">
      {/* Concentric rings */}
      {[60,90,120].map(r => (
        <circle key={r} cx="160" cy="80" r={r} stroke="rgba(26,61,43,0.08)" strokeWidth="0.5"/>
      ))}
      {/* Root node */}
      <rect x="120" y="55" width="80" height="36" rx="7" fill="#1a3d2b" opacity="0.92"/>
      <text x="160" y="70" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="10" fontWeight="500" fill="rgba(255,255,255,0.9)">Launch Canopy</text>
      <text x="160" y="83" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="rgba(255,255,255,0.4)">Sep 2026</text>
      {/* Branches */}
      <path d="M160 91 C160 108, 100 112, 100 128" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <path d="M160 91 C160 108, 220 112, 220 128" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <rect x="60" y="128" width="80" height="28" rx="6" fill="white" stroke="rgba(26,61,43,0.15)" strokeWidth="0.5"/>
      <text x="100" y="143" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">Build MVP</text>
      <rect x="180" y="128" width="80" height="28" rx="6" fill="white" stroke="rgba(26,61,43,0.15)" strokeWidth="0.5"/>
      <text x="220" y="143" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">Ship it</text>
    </svg>
  );
}

function IllustrationTrees() {
  return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="ob-illustration">
      {/* Tree */}
      <path d="M160 46 C160 68, 100 72, 100 90" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <path d="M160 46 C160 68, 220 72, 220 90" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <path d="M100 118 C100 132, 64 136, 64 150" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <path d="M100 118 C100 132, 136 136, 136 150" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      {/* Root */}
      <rect x="118" y="28" width="84" height="34" rx="7" fill="#1a3d2b" opacity="0.9"/>
      <text x="160" y="42" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="rgba(255,255,255,0.9)">Goal (root)</text>
      <text x="160" y="53" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="rgba(255,255,255,0.4)">can't be deleted</text>
      {/* Label node - amber */}
      <rect x="64" y="90" width="72" height="28" rx="6" fill="#fef3dc" stroke="rgba(138,90,0,0.2)" strokeWidth="0.5"/>
      <text x="100" y="104" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#8a5a00">Milestone</text>
      <text x="100" y="114" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#b8922a">label</text>
      {/* Normal node */}
      <rect x="178" y="90" width="84" height="28" rx="6" fill="white" stroke="rgba(61,122,86,0.4)" strokeWidth="0.5"/>
      <circle cx="252" cy="97" r="4" fill="#3d7a56"/>
      <text x="216" y="104" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">Task node</text>
      <text x="216" y="114" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#3d7a56">has deadline</text>
      {/* Disconnected */}
      <rect x="24" y="150" width="80" height="26" rx="6" fill="white" stroke="rgba(26,61,43,0.12)" strokeWidth="0.5" strokeDasharray="3 2" opacity="0.45"/>
      <text x="64" y="165" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fill="#9a9082" opacity="0.7">disconnected</text>
      <rect x="116" y="150" width="60" height="26" rx="6" fill="white" stroke="rgba(26,61,43,0.15)" strokeWidth="0.5"/>
      <text x="146" y="165" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">subtask</text>
    </svg>
  );
}

function IllustrationInteractions() {
  return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="ob-illustration">
      {/* Central node */}
      <rect x="105" y="58" width="110" height="44" rx="8" fill="#e6f1fb" stroke="#185fa5" strokeWidth="1.5"/>
      <text x="160" y="76" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="10" fontWeight="500" fill="#185fa5">selected node</text>
      <text x="160" y="91" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="#185fa5" opacity="0.6">click to select</text>
      {/* Double click label */}
      <rect x="222" y="30" width="88" height="22" rx="5" fill="white" stroke="rgba(26,61,43,0.15)" strokeWidth="0.5"/>
      <text x="266" y="45" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fill="#5a5548">double-click → edit</text>
      <line x1="222" y1="42" x2="215" y2="62" stroke="rgba(26,61,43,0.2)" strokeWidth="0.8" strokeDasharray="2 2"/>
      {/* Right click context menu */}
      <rect x="10" y="80" width="90" height="68" rx="5" fill="white" stroke="rgba(26,61,43,0.15)" strokeWidth="0.5" filter="drop-shadow(0 2px 6px rgba(0,0,0,0.06))"/>
      <text x="18" y="96" fontFamily="system-ui,sans-serif" fontSize="8" fontWeight="600" fill="#9a9082">RIGHT CLICK</text>
      <line x1="10" y1="100" x2="100" y2="100" stroke="rgba(26,61,43,0.08)" strokeWidth="0.5"/>
      <text x="18" y="113" fontFamily="system-ui,sans-serif" fontSize="9" fill="#1a3d2b">+ Add child</text>
      <text x="18" y="126" fontFamily="system-ui,sans-serif" fontSize="9" fill="#1a3d2b">◻ Add label</text>
      <text x="18" y="139" fontFamily="system-ui,sans-serif" fontSize="9" fill="#c0392b">✕ Remove</text>
      <line x1="105" y1="80" x2="100" y2="108" stroke="rgba(26,61,43,0.2)" strokeWidth="0.8" strokeDasharray="2 2"/>
      {/* Shift multi-select */}
      <rect x="220" y="96" width="90" height="50" rx="5" fill="white" stroke="rgba(26,61,43,0.12)" strokeWidth="0.5"/>
      <rect x="226" y="103" width="36" height="18" rx="4" fill="#f2f1ed" stroke="rgba(26,61,43,0.2)" strokeWidth="0.5"/>
      <rect x="268" y="103" width="36" height="18" rx="4" fill="#f2f1ed" stroke="rgba(26,61,43,0.2)" strokeWidth="0.5"/>
      <rect x="247" y="127" width="36" height="14" rx="4" fill="#e6f1fb" stroke="#185fa5" strokeWidth="0.5"/>
      <text x="265" y="136" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#185fa5">selected</text>
      <text x="265" y="120" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="8" fill="#5a5548">Shift+click</text>
      <text x="265" y="108" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="8" fill="#5a5548">multi-select</text>
    </svg>
  );
}

function IllustrationAlgorithm() {
  return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="ob-illustration">
      {/* Tree side */}
      <text x="10" y="16" fontFamily="monospace" fontSize="8" fill="#9a9082" letterSpacing="1">TREE</text>
      <path d="M75 36 C75 52, 44 56, 44 72" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <path d="M75 36 C75 52, 106 56, 106 72" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <path d="M44 96 C44 108, 28 112, 28 124" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      <path d="M44 96 C44 108, 60 112, 60 124" stroke="rgba(26,61,43,0.2)" strokeWidth="1.5"/>
      {/* Root node */}
      <rect x="35" y="20" width="80" height="32" rx="6" fill="#1a3d2b" opacity="0.88"/>
      <text x="75" y="35" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="rgba(255,255,255,0.9)">Launch App</text>
      <text x="75" y="46" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="rgba(255,255,255,0.35)">no deadline</text>
      {/* Mid node - has deadline, but has children with deadlines too */}
      <rect x="14" y="72" width="60" height="26" rx="5" fill="white" stroke="rgba(26,61,43,0.15)" strokeWidth="0.5"/>
      <text x="44" y="85" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fill="#1a3d2b" fontWeight="500">Build MVP</text>
      <text x="44" y="95" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#9a9082">May 1</text>
      {/* Leaf with deadline - THIS one shows */}
      <rect x="8" y="124" width="40" height="26" rx="5" fill="white" stroke="rgba(61,122,86,0.5)" strokeWidth="1"/>
      <circle cx="40" cy="130" r="3.5" fill="#3d7a56"/>
      <text x="28" y="136" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="8" fontWeight="500" fill="#1a3d2b">Auth</text>
      <text x="28" y="145" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#3d7a56">Apr 12 ✓</text>
      {/* Sibling leaf */}
      <rect x="42" y="124" width="40" height="26" rx="5" fill="white" stroke="rgba(61,122,86,0.5)" strokeWidth="1"/>
      <circle cx="74" cy="130" r="3.5" fill="#3d7a56"/>
      <text x="62" y="136" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="8" fontWeight="500" fill="#1a3d2b">DB</text>
      <text x="62" y="145" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#3d7a56">Apr 15 ✓</text>
      {/* Right sibling no children */}
      <rect x="76" y="72" width="60" height="26" rx="5" fill="white" stroke="rgba(61,122,86,0.4)" strokeWidth="1"/>
      <circle cx="128" cy="78" r="3.5" fill="#3d7a56"/>
      <text x="106" y="85" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">Ship</text>
      <text x="106" y="95" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#3d7a56">Jul 15 ✓</text>
      {/* Arrow */}
      <path d="M150 80 L174 80" stroke="rgba(26,61,43,0.3)" strokeWidth="1.5" markerEnd="url(#arr)"/>
      <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="rgba(26,61,43,0.4)"/></marker></defs>
      {/* Todo list side */}
      <text x="180" y="16" fontFamily="monospace" fontSize="8" fill="#9a9082" letterSpacing="1">TODO LIST</text>
      <rect x="178" y="22" width="132" height="130" rx="8" fill="white" stroke="rgba(26,61,43,0.1)" strokeWidth="0.5"/>
      {/* Next banner */}
      <rect x="184" y="28" width="120" height="26" rx="5" fill="#e1f5ee" stroke="rgba(29,158,117,0.3)" strokeWidth="0.5"/>
      <text x="192" y="38" fontFamily="monospace" fontSize="7" fill="#0f6e56" letterSpacing="0.5">SUGGESTED NEXT</text>
      <text x="192" y="49" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#0f6e56">Auth</text>
      {/* Items */}
      {[['Auth', 'Apr 12', true], ['DB', 'Apr 15', false], ['Ship', 'Jul 15', false]].map(([name, date, isNext], i) => (
        <g key={name}>
          <rect x="184" y={62 + i * 27} width="6" height="6" rx="1.5" fill="none" stroke="rgba(26,61,43,0.25)" strokeWidth="1.2"/>
          <text x="196" y={70 + i * 27} fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">{name}</text>
          <text x="290" y={70 + i * 27} textAnchor="end" fontFamily="monospace" fontSize="7" fill="#9a9082">{date}</text>
        </g>
      ))}
    </svg>
  );
}

function IllustrationDuration() {
  return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="ob-illustration">
      {/* Task card */}
      <rect x="10" y="20" width="130" height="80" rx="8" fill="white" stroke="rgba(26,61,43,0.12)" strokeWidth="0.5"/>
      <text x="22" y="36" fontFamily="monospace" fontSize="7" fill="#9a9082" letterSpacing="0.8">TASK</text>
      <text x="22" y="50" fontFamily="system-ui,sans-serif" fontSize="10" fontWeight="600" fill="#1a3d2b">Write outline</text>
      {/* Duration field */}
      <rect x="18" y="57" width="52" height="20" rx="4" fill="#f2f1ed" stroke="rgba(26,61,43,0.12)" strokeWidth="0.5"/>
      <text x="26" y="67" fontFamily="monospace" fontSize="7" fill="#9a9082">DURATION</text>
      <text x="26" y="76" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">45 min</text>
      {/* Due date field */}
      <rect x="76" y="57" width="56" height="20" rx="4" fill="#f2f1ed" stroke="rgba(26,61,43,0.12)" strokeWidth="0.5"/>
      <text x="84" y="67" fontFamily="monospace" fontSize="7" fill="#9a9082">DUE DATE</text>
      <text x="84" y="76" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">Apr 15</text>
      {/* Divider */}
      <line x1="10" y1="100" x2="140" y2="100" stroke="rgba(26,61,43,0.06)" strokeWidth="0.5"/>
      <text x="22" y="114" fontFamily="monospace" fontSize="7" fill="#9a9082">DAYS UNTIL DUE: 4</text>
      {/* Arrow + formula */}
      <path d="M148 60 L168 60" stroke="rgba(26,61,43,0.25)" strokeWidth="1.5" markerEnd="url(#arr2)"/>
      <defs><marker id="arr2" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="rgba(26,61,43,0.35)"/></marker></defs>
      {/* Formula box */}
      <rect x="172" y="30" width="136" height="55" rx="8" fill="#1a3d2b" opacity="0.9"/>
      <text x="240" y="48" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="rgba(255,255,255,0.5)" letterSpacing="0.5">WORK PER DAY</text>
      <text x="240" y="63" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="11" fontWeight="500" fill="white">45 ÷ 4 = 11.25</text>
      <text x="240" y="77" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="rgba(255,255,255,0.4)">min/day</text>
      {/* Weight bar */}
      <rect x="172" y="98" width="136" height="10" rx="5" fill="#f2f1ed" stroke="rgba(26,61,43,0.08)" strokeWidth="0.5"/>
      <rect x="172" y="98" width="90" height="10" rx="5" fill="#3d7a56" opacity="0.7"/>
      <text x="240" y="122" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#9a9082">higher WPD → more likely to be suggested</text>
      {/* Next banner below */}
      <rect x="10" y="138" width="300" height="18" rx="5" fill="#e1f5ee" stroke="rgba(29,158,117,0.3)" strokeWidth="0.5"/>
      <text x="18" y="148" fontFamily="monospace" fontSize="7" fill="#0f6e56" letterSpacing="0.5">SUGGESTED NEXT</text>
      <text x="100" y="149" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#0f6e56">Write outline</text>
      <text x="300" y="149" textAnchor="end" fontFamily="monospace" fontSize="8" fill="#0f6e56" opacity="0.7">Apr 15</text>
    </svg>
  );
}

function IllustrationJournal() {
  return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="ob-illustration">
      {/* Mini calendar */}
      <rect x="10" y="10" width="120" height="110" rx="8" fill="white" stroke="rgba(26,61,43,0.1)" strokeWidth="0.5"/>
      <text x="22" y="26" fontFamily="monospace" fontSize="7" fill="#9a9082" letterSpacing="0.8">APRIL 2026</text>
      {/* Calendar grid header */}
      {['S','M','T','W','T','F','S'].map((d,i) => (
        <text key={i} x={22 + i * 14} y="38" fontFamily="monospace" fontSize="7" fill="#9a9082">{d}</text>
      ))}
      {/* Days */}
      {Array.from({length:30}).map((_,i) => {
        const day = i + 1;
        const hasEntry = [2,5,8,11,14,17,19,22,25].includes(day);
        const isToday  = day === 11;
        const x = 22 + ((day + 2) % 7) * 14;
        const y = 52 + Math.floor((day + 2) / 7) * 14;
        return (
          <g key={day}>
            <rect x={x-5} y={y-9} width="11" height="11" rx="3"
              fill={hasEntry ? '#e1f5ee' : isToday ? '#f2f1ed' : 'none'}
              stroke={isToday ? 'rgba(26,61,43,0.2)' : 'none'}
            />
            <text x={x} y={y} textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="7"
              fill={hasEntry ? '#0f6e56' : '#6b6a65'}
              fontWeight={isToday ? '600' : '400'}
            >{day}</text>
          </g>
        );
      })}
      {/* Entry card */}
      <rect x="140" y="10" width="170" height="68" rx="8" fill="white" stroke="rgba(26,61,43,0.1)" strokeWidth="0.5"/>
      <text x="152" y="26" fontFamily="system-ui,sans-serif" fontSize="10" fontWeight="600" fill="#1a3d2b">April 11 entry</text>
      <text x="152" y="38" fontFamily="monospace" fontSize="7" fill="#9a9082">10:22 am</text>
      <text x="152" y="52" fontFamily="system-ui,sans-serif" fontSize="9" fill="#6b6a65">Finished the auth module.</text>
      <text x="152" y="64" fontFamily="system-ui,sans-serif" fontSize="9" fill="#6b6a65">Feels good to ship that.</text>
      {/* Completed task in timeline */}
      <rect x="140" y="86" width="170" height="36" rx="8" fill="#f2f1ed" stroke="rgba(26,61,43,0.08)" strokeWidth="0.5"/>
      <rect x="148" y="93" width="22" height="22" rx="4" fill="#e1f5ee" stroke="rgba(29,158,117,0.3)" strokeWidth="0.5"/>
      <text x="159" y="108" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#0f6e56">TSK</text>
      <text x="178" y="101" fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="500" fill="#1a3d2b">Write auth module</text>
      <text x="178" y="114" fontFamily="monospace" fontSize="7" fill="#9a9082">completed · +450 pts</text>
      {/* Arrow from calendar day to entry */}
      <path d="M130 55 L140 40" stroke="rgba(26,61,43,0.15)" strokeWidth="0.8" strokeDasharray="2 2"/>
    </svg>
  );
}

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  {
    id:    'welcome',
    title: 'Welcome to Canopy',
    illustration: <IllustrationWelcome />,
    body: (
      <>
        <p>Canopy is a workflow and life management system built around one idea: your goals are not flat lists. They're trees — goals break into milestones, milestones into steps, steps into tasks.</p>
        <p>This walkthrough covers everything you need to get the most out of it. It takes about 2 minutes.</p>
      </>
    ),
  },
  {
    id:    'trees',
    title: 'Goal trees',
    illustration: <IllustrationTrees />,
    body: (
      <>
        <p>Each tree starts with a <strong>root node</strong> — your goal. Add branches and leaves to break it down. There are three node types:</p>
        <ul>
          <li><span className="ob-tag ob-tag--root">root</span> The goal itself. Can't be deleted without deleting the tree.</li>
          <li><span className="ob-tag ob-tag--label">label</span> A milestone or category — organises structure, doesn't need a deadline.</li>
          <li><span className="ob-tag ob-tag--task">task node</span> An actionable item. Give it a deadline and duration to surface it in your todo list.</li>
        </ul>
        <p>Nodes without a path back to the root appear <span style={{opacity:0.5}}>greyed and dashed</span> — disconnected.</p>
      </>
    ),
  },
  {
    id:    'interactions',
    title: 'Tree interactions',
    illustration: <IllustrationInteractions />,
    body: (
      <>
        <p>The tree graph responds to several gestures:</p>
        <ul>
          <li><kbd>Click</kbd> a node to select it and open the side panel.</li>
          <li><kbd>Double-click</kbd> to open the full edit form for that node.</li>
          <li><kbd>Right-click</kbd> a node for a quick context menu — add a child, add a label node, or remove the node.</li>
          <li><kbd>Shift + click</kbd> multiple nodes to select them all, then drag them together to reposition a whole branch.</li>
          <li><kbd>Drag an edge endpoint</kbd> from one node onto another to reparent — change what a node's parent is.</li>
        </ul>
      </>
    ),
  },
  {
    id:    'algorithm',
    title: 'How the deadline algorithm works',
    illustration: <IllustrationAlgorithm />,
    body: (
      <>
        <p>Not every tree node appears in your todo list — only the ones that matter right now.</p>
        <p>Canopy walks each branch from root to leaf and finds the <strong>deepest node that has a deadline</strong>. That's the prerequisite — the thing you need to do before anything above it can happen.</p>
        <ul>
          <li>If a leaf has a deadline → the leaf shows in your list.</li>
          <li>If only the parent has a deadline → the parent shows, with its children listed inline as subtasks.</li>
          <li>Nodes with no deadline, or disconnected from the root, are never surfaced.</li>
        </ul>
      </>
    ),
  },
  {
    id:    'duration',
    title: 'Duration, deadlines & suggested next',
    illustration: <IllustrationDuration />,
    body: (
      <>
        <p>Two inputs drive the <strong>suggested next task</strong> in the green banner:</p>
        <ul>
          <li><strong>Estimated duration</strong> — how many minutes you think this task takes.</li>
          <li><strong>Due date</strong> — when it needs to be done by.</li>
        </ul>
        <p>Canopy calculates <em>work-per-day</em> (duration ÷ days remaining) for each task. The higher the ratio, the more urgent it is. The algorithm weights tasks by this urgency and picks one — with overdue tasks always going first. You can always choose a different task from the list.</p>
        <p className="ob-note">You need full access to use deadlines and duration estimates.</p>
      </>
    ),
  },
  {
    id:    'journal',
    title: 'The journal',
    illustration: <IllustrationJournal />,
    body: (
      <>
        <p>The journal keeps a longitudinal record of your work — not just what you did, but what you thought about it.</p>
        <ul>
          <li>Write entries from the <strong>Journal</strong> tab or via <em>+ journal entry</em> on the dashboard.</li>
          <li>The calendar highlights days you've written an entry — green means something was recorded.</li>
          <li>Your timeline shows journal entries and completed tasks interleaved in chronological order.</li>
          <li>Entries are editable and deletable at any time from the Journal page.</li>
        </ul>
        <p>Think of it as your working memory — the context that connects the tasks you complete to the goals they serve.</p>
      </>
    ),
  },
];

// ── Modal ─────────────────────────────────────────────────────────────────────
export default NiceModal.create(() => {
  const modal = useModal();
  const [step, setStep] = useState(0);
  const total = STEPS.length;
  const current = STEPS[step];

  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight' && step < total - 1) setStep(s => s + 1);
      if (e.key === 'ArrowLeft'  && step > 0)         setStep(s => s - 1);
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [step]);

  const handleClose = () => {
    markOnboardingSeen();
    modal.hide();
    modal.remove();
  };

  const handleNext = () => {
    if (step < total - 1) setStep(s => s + 1);
    else handleClose();
  };

  return modal.visible ? (
    <div className="modal-blanker ob-blanker">
      <div className="ob-card">
        {/* Close */}
        <button className="btn-ghost ob-dismiss" onClick={handleClose} title="Skip">✕</button>

        {/* Illustration */}
        <div className="ob-illustration-wrap">
          {current.illustration}
        </div>

        {/* Content */}
        <div className="ob-content">
          <div className="ob-step-label">
            {step + 1} of {total}
          </div>
          <h2 className="ob-title">{current.title}</h2>
          <div className="ob-body">{current.body}</div>
        </div>

        {/* Footer */}
        <div className="ob-footer">
          <div className="ob-dots">
            {STEPS.map((_, i) => (
              <button
                key={i}
                className={`ob-dot ${i === step ? 'ob-dot--active' : ''}`}
                onClick={() => setStep(i)}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>

          <div className="ob-nav">
            {step > 0 && (
              <button className="btn-ghost ob-btn-back" onClick={() => setStep(s => s - 1)}>
                ← Back
              </button>
            )}
            <button className="btn-primary ob-btn-next" onClick={handleNext}>
              {step < total - 1 ? 'Next →' : 'Get started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;
});