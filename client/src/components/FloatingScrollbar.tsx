import React, { useEffect, useRef, useState } from "react";

/**
 * A horizontal scrollbar pinned to the bottom of the window for a wide table.
 * The table's own scrollbar sits at its bottom edge and is off-screen while you are at the top or
 * in the middle of a long list; this copy stays visible whenever the table is on screen and its own
 * scrollbar is not, and scrolls the table in sync.
 */
export function FloatingScrollbar({
  targetRef,
  label = "Горизонтальная прокрутка таблицы",
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  label?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [box, setBox] = useState<{
    left: number;
    width: number;
    scrollWidth: number;
  } | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = targetRef.current;
        if (!target) return setBox(null);
        const rect = target.getBoundingClientRect();
        const overflowing = target.scrollWidth > target.clientWidth + 1;
        const onScreen = rect.top < window.innerHeight - 40 && rect.bottom > 0;
        // The table's own scrollbar (its bottom edge) is below the fold.
        const ownBarHidden = rect.bottom > window.innerHeight;
        if (!overflowing || !onScreen || !ownBarHidden) return setBox(null);
        setBox(previous => {
          const next = {
            left: rect.left + target.clientLeft,
            width: target.clientWidth,
            scrollWidth: target.scrollWidth,
          };
          return previous &&
            previous.left === next.left &&
            previous.width === next.width &&
            previous.scrollWidth === next.scrollWidth
            ? previous
            : next;
        });
      });
    };
    measure();
    // Capture phase: also catches scrolling inside the table and any scrolling parent.
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const target = targetRef.current;
    if (target && observer) {
      observer.observe(target);
      if (target.firstElementChild) observer.observe(target.firstElementChild);
    }
    const retry = window.setInterval(measure, 1000); // rows loaded / filters changed
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", measure, { capture: true } as any);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      window.clearInterval(retry);
    };
  }, [targetRef]);

  // Table → floating bar
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const onScroll = () => {
      const bar = barRef.current;
      if (!bar || syncing.current) {
        syncing.current = false;
        return;
      }
      if (Math.abs(bar.scrollLeft - target.scrollLeft) > 1) {
        syncing.current = true;
        bar.scrollLeft = target.scrollLeft;
      }
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [targetRef, box !== null]);

  useEffect(() => {
    const target = targetRef.current;
    if (box && barRef.current && target) barRef.current.scrollLeft = target.scrollLeft;
  }, [box, targetRef]);

  if (!box) return null;
  return (
    <div
      ref={barRef}
      className="floating-scrollbar"
      role="scrollbar"
      aria-orientation="horizontal"
      aria-label={label}
      aria-controls={targetRef.current?.id || undefined}
      style={{ left: box.left, width: box.width }}
      onScroll={event => {
        const target = targetRef.current;
        if (!target) return;
        if (syncing.current) {
          syncing.current = false;
          return;
        }
        const left = (event.currentTarget as HTMLDivElement).scrollLeft;
        if (Math.abs(target.scrollLeft - left) > 1) {
          syncing.current = true;
          target.scrollLeft = left;
        }
      }}
    >
      <div style={{ width: box.scrollWidth, height: 1 }} />
    </div>
  );
}
