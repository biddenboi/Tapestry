import { useCallback, useEffect, useRef, useState } from 'react';

export function useEdgeReveal({
  edge = 'right',
  open,
  onOpen,
  dwellMs = 260,
  hideDelayMs = 700,
} = {}) {
  const showTimerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [lipVisible, setLipVisible] = useState(false);
  const clearShow = useCallback(() => {
    if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
  }, []);
  const clearHide = useCallback(() => {
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);
  const enter = useCallback(() => {
    if (open) return;
    clearShow();
    clearHide();
    showTimerRef.current = window.setTimeout(() => {
      setLipVisible(true);
      showTimerRef.current = null;
    }, dwellMs);
  }, [clearHide, clearShow, dwellMs, open]);
  const scheduleHide = useCallback(() => {
    clearShow();
    clearHide();
    if (open) return;
    hideTimerRef.current = window.setTimeout(() => {
      setLipVisible(false);
      hideTimerRef.current = null;
    }, hideDelayMs);
  }, [clearHide, clearShow, hideDelayMs, open]);
  const keepVisible = useCallback(() => {
    if (open) return;
    clearHide();
    setLipVisible(true);
  }, [clearHide, open]);
  const activate = useCallback(() => {
    clearShow();
    clearHide();
    setLipVisible(false);
    onOpen?.('edge');
  }, [clearHide, clearShow, onOpen]);
  useEffect(() => () => {
    clearShow();
    clearHide();
  }, [clearHide, clearShow]);
  useEffect(() => {
    if (open) {
      clearShow();
      clearHide();
      setLipVisible(false);
    }
  }, [clearHide, clearShow, open]);
  return {
    edge,
    lipVisible,
    edgeProps: {
      onPointerEnter: enter,
      onPointerLeave: scheduleHide,
      onPointerDown: activate,
    },
    lipProps: {
      onClick: activate,
      onPointerEnter: keepVisible,
      onPointerLeave: scheduleHide,
      onPointerDown: keepVisible,
    },
  };
}

export default useEdgeReveal;
