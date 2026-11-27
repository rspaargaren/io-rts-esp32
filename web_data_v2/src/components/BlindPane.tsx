import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Device } from "../models/Types";

interface BlindPaneProps {
  device: Device;
  targetPosition?: number | null;
  onPositionChange?: (newPosition: number) => void | Promise<void>;
}

export function BlindPane({
  device,
  targetPosition,
  onPositionChange,
}: BlindPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [lastPct, setLastPct] = useState(
    device.position >= 0 ? device.position : 0,
  );
  // Touch: the pane is a vertical slider, the same direction the page scrolls. A drag starts
  // only after the finger rests LONG_PRESS_MS without moving; moving earlier is a scroll.
  const touchStartY = useRef<number | null>(null);
  const touchDragging = useRef(false);
  const touchMoved = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DRAG_THRESHOLD = 10;
  const LONG_PRESS_MS = 250;

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => () => clearLongPress(), []); // unmount

  const pctFromEvent = useCallback((e: MouseEvent | TouchEvent) => {
    if (!paneRef.current) return 0;
    const rect = paneRef.current.getBoundingClientRect();
    const y =
      (e as MouseEvent).clientY || (e as TouchEvent).touches?.[0]?.clientY || 0;
    return Math.max(
      0,
      Math.min(100, Math.round(((y - rect.top) / rect.height) * 100)),
    );
  }, []);

  const applyDrag = useCallback((p: number) => {
    setLastPct(p);
  }, []);

  useEffect(() => {
    if (dragging) return;
    setLastPct(device.position >= 0 ? device.position : 0);
  }, [device.position, dragging]);

  const commitPosition = useCallback(
    async (position: number) => {
      if (!onPositionChange) return;

      try {
        await onPositionChange(position);
      } catch {
        setLastPct(device.position >= 0 ? device.position : 0);
      }
    },
    [device.position, onPositionChange],
  );

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!paneRef.current) return;
      setDragging(true);
      e.preventDefault();
      applyDrag(pctFromEvent(e));
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      applyDrag(pctFromEvent(e));
    };

    const handleMouseUp = () => {
      if (!dragging) return;
      setDragging(false);
      void commitPosition(lastPct);
    };

    const resetTouch = () => {
      clearLongPress();
      touchStartY.current = null;
      touchDragging.current = false;
      touchMoved.current = false;
    };

    // Abandon a touch drag without sending anything and show the real position again
    const cancelTouchDrag = () => {
      const wasDragging = touchDragging.current;
      resetTouch();
      if (wasDragging) {
        setDragging(false);
        setLastPct(device.position >= 0 ? device.position : 0);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!paneRef.current) return;
      resetTouch();
      touchStartY.current = e.touches[0].clientY;
      // Nothing changes on screen yet: the touch may still turn out to be a scroll
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        if (touchStartY.current === null) return;
        touchDragging.current = true;
        setDragging(true);
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartY.current === null) return;
      if (!touchDragging.current) {
        // Moved before the long press fired: the user is scrolling, leave the gesture to the page
        if (Math.abs(e.touches[0].clientY - touchStartY.current) >= DRAG_THRESHOLD) resetTouch();
        return;
      }
      if (!e.cancelable) {
        // The browser already scrolls this gesture; following the finger would move the blind
        cancelTouchDrag();
        return;
      }
      e.preventDefault();
      touchMoved.current = true;
      applyDrag(pctFromEvent(e));
    };

    const handleTouchEnd = () => {
      const commit = touchDragging.current && touchMoved.current;
      const wasDragging = touchDragging.current;
      resetTouch();
      if (!wasDragging) return;
      setDragging(false);
      // A long press without moving is not a position change
      if (commit) void commitPosition(lastPct);
      else setLastPct(device.position >= 0 ? device.position : 0);
    };

    const handleTouchCancel = () => cancelTouchDrag();

    const pane = paneRef.current;
    if (pane) {
      pane.addEventListener("mousedown", handleMouseDown);
      pane.addEventListener("touchstart", handleTouchStart, { passive: false });
      pane.addEventListener("touchmove", handleTouchMove, { passive: false });
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      if (pane) {
        pane.removeEventListener("mousedown", handleMouseDown);
        pane.removeEventListener("touchstart", handleTouchStart);
        pane.removeEventListener("touchmove", handleTouchMove);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [dragging, lastPct, pctFromEvent, applyDrag, commitPosition, device.position]);

  const pos = lastPct;

  return (
    <div ref={paneRef} className="blind-pane">
      <div className="blind-fill" style={{ height: `${pos}%` }} />
      <div className="blind-handle" style={{ top: `${pos}%` }} />
      <div
        className="blind-target"
        style={{
          display: targetPosition === null ? "none" : "block",
          top: `${targetPosition ?? 0}%`,
        }}
      />
      <div className="blind-caption">
        {dragging || device.position >= 0 ? `${pos}%` : "—"}
      </div>
    </div>
  );
}
