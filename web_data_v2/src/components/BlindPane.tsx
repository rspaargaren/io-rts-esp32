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

    const handleTouchStart = (e: TouchEvent) => {
      if (!paneRef.current) return;
      setDragging(true);
      e.preventDefault();
      applyDrag(pctFromEvent(e));
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragging) return;
      e.preventDefault();
      applyDrag(pctFromEvent(e));
    };

    const handleTouchEnd = () => {
      if (!dragging) return;
      setDragging(false);
      void commitPosition(lastPct);
    };

    const pane = paneRef.current;
    if (pane) {
      pane.addEventListener("mousedown", handleMouseDown);
      pane.addEventListener("touchstart", handleTouchStart, { passive: false });
      pane.addEventListener("touchmove", handleTouchMove, { passive: false });
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      if (pane) {
        pane.removeEventListener("mousedown", handleMouseDown);
        pane.removeEventListener("touchstart", handleTouchStart);
        pane.removeEventListener("touchmove", handleTouchMove);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [dragging, lastPct, pctFromEvent, applyDrag, commitPosition]);

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
