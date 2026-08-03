import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampNextMovePosition,
  NEXT_MOVE_EDGE_SNAP_PX,
} from '../../services/NextMovePlacementService.js';

export function useDraggableNextMove({
  panelRef,
  position,
  width,
  onCommit,
  onKeyboardCommit,
} = {}) {
  const dragRef = useRef(null);
  const frameRef = useRef(null);
  const snapEdgeRef = useRef(null);
  const [transient, setTransient] = useState(null);
  const [snapEdge, setSnapEdge] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const keyboardOriginRef = useRef(null);

  const updateFrame = useCallback((next) => {
    dragRef.current.next = next;
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = dragRef.current?.next;
      if (pending) setTransient(pending);
    });
  }, []);

  const finish = useCallback((event, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      if (event?.currentTarget?.hasPointerCapture?.(drag.pointerId)) {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    dragRef.current = null;
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const final = drag.next || transient || { x: drag.startX, y: drag.startY };
    if (!cancelled && drag.moved) onCommit?.({ ...final, dockEdge: snapEdgeRef.current });
    setTransient(null);
    setDragging(false);
    snapEdgeRef.current = null;
    setSnapEdge(null);
  }, [onCommit, transient]);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originClientY: event.clientY,
      startX: position.x,
      startY: position.y,
      next: { x: position.x, y: position.y },
      moved: false,
    };
    setDragging(true);
  }, [position.x, position.y]);

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.originClientX;
    const dy = event.clientY - drag.originClientY;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    const rect = panelRef.current?.getBoundingClientRect();
    const next = clampNextMovePosition({
      x: drag.startX + dx,
      y: drag.startY + dy,
      width,
      height: rect?.height || 560,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    const leftDistance = event.clientX;
    const rightDistance = window.innerWidth - event.clientX;
    const nextSnapEdge = leftDistance <= NEXT_MOVE_EDGE_SNAP_PX
      ? 'left'
      : rightDistance <= NEXT_MOVE_EDGE_SNAP_PX ? 'right' : null;
    snapEdgeRef.current = nextSnapEdge;
    setSnapEdge(nextSnapEdge);
    updateFrame(next);
  }, [panelRef, updateFrame, width]);

  const startKeyboardMove = useCallback(() => {
    keyboardOriginRef.current = { x: position.x, y: position.y };
    setTransient({ x: position.x, y: position.y });
    setKeyboardMode(true);
  }, [position.x, position.y]);

  const onKeyboardMove = useCallback((event) => {
    if (!keyboardMode) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setTransient(null);
      setKeyboardMode(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onKeyboardCommit?.(transient || keyboardOriginRef.current);
      setTransient(null);
      setKeyboardMode(false);
      return;
    }
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!directions[event.key]) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const [dx, dy] = directions[event.key];
    setTransient((current) => clampNextMovePosition({
      x: (current?.x ?? position.x) + dx * step,
      y: (current?.y ?? position.y) + dy * step,
      width,
      height: panelRef.current?.getBoundingClientRect?.().height || 560,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }, [keyboardMode, onKeyboardCommit, panelRef, position.x, position.y, transient, width]);

  useEffect(() => () => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
  }, []);

  return {
    style: transient
      ? {
          left: `${transient.x}px`,
          top: `${transient.y}px`,
          transform: 'none',
          transition: 'none',
        }
      : undefined,
    dragging,
    snapEdge,
    keyboardMode,
    startKeyboardMove,
    grabProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => finish(event, false),
      onPointerCancel: (event) => finish(event, true),
      onKeyDown: onKeyboardMove,
      tabIndex: 0,
      role: 'button',
      'aria-label': 'Move Next Move',
      'aria-pressed': keyboardMode,
    },
  };
}

export default useDraggableNextMove;
