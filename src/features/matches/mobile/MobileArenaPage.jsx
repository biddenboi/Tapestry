import { useLayoutEffect, useRef } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { GAME_STATE } from '@domain/constants.js';

import MobileDojoRuntime from './MobileDojoRuntime.jsx';
import MobileMatchRuntime from './MobileMatchRuntime.jsx';

export default function MobileArenaPage({ onBack }) {
  const { gameState: [gameState, setGameState] } = useAppContext();
  const runtimeRef = useRef(null);
  useLayoutEffect(() => {
    const panel = runtimeRef.current?.closest('.mobile-tab-panel');
    if (panel) panel.scrollTop = 0;
  }, [gameState]);
  const leave = () => {
    setGameState(GAME_STATE.idle);
    onBack?.();
  };
  if (![GAME_STATE.dojo, GAME_STATE.match].includes(gameState)) return null;
  return (
    <section ref={runtimeRef} className="mobile-arena-runtime mobile-page">
      {gameState === GAME_STATE.dojo
        ? <MobileDojoRuntime onBack={leave} />
        : <MobileMatchRuntime onBack={leave} />}
    </section>
  );
}
