"use client";

import {
  Children,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { haptic } from "@/lib/interactions";

type GestureAxis = "pending" | "horizontal" | "vertical";

type GestureStart = {
  x: number;
  y: number;
  at: number;
  axis: GestureAxis;
  ignored: boolean;
};

const SWIPE_THRESHOLD = 44;
const MAX_DURATION_MS = 1200;
const EDGE_GUARD_PX = 12;
const DIRECTION_LOCK_PX = 10;
const HORIZONTAL_DOMINANCE = 1.15;

function isBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input,textarea,select,[contenteditable='true'],[role='slider'],[data-home-swipe-ignore]"
    )
  );
}

function isHorizontallyScrollable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  let node: Element | null = target;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const canScrollX =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 4;
      if (canScrollX) return true;
    }
    node = node.parentElement;
  }
  return false;
}

export default function HomeSwipeLoop({ children }: { children: ReactNode }) {
  const slides = useMemo(() => Children.toArray(children), [children]);
  const slideCount = slides.length;
  const loopSlides = useMemo(() => {
    if (slideCount < 2) return slides;
    return [slides[slideCount - 1], ...slides, slides[0]];
  }, [slideCount, slides]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<GestureStart | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [position, setPosition] = useState(slideCount < 2 ? 0 : 1);
  const [dragX, setDragX] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  const trackOffsetPercent = slideCount < 2 ? 0 : position * 100;
  const realIndex =
    slideCount < 2
      ? 0
      : position === 0
        ? slideCount - 1
        : position === slideCount + 1
          ? 0
          : position - 1;

  function resetGesture() {
    startRef.current = null;
  }

  function onTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (slideCount < 2 || event.touches.length !== 1) {
      resetGesture();
      return;
    }

    const touch = event.touches[0];
    const nearSystemEdge =
      touch.clientX <= EDGE_GUARD_PX ||
      touch.clientX >= window.innerWidth - EDGE_GUARD_PX;

    setTransitionEnabled(false);
    startRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      at: Date.now(),
      axis: "pending",
      ignored:
        nearSystemEdge ||
        isBlockedTarget(event.target) ||
        isHorizontallyScrollable(event.target),
    };
  }

  function onTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    const start = startRef.current;
    const touch = event.touches[0];
    if (!start || !touch || start.ignored || start.axis === "vertical") return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (start.axis === "pending") {
      if (absX < DIRECTION_LOCK_PX && absY < DIRECTION_LOCK_PX) return;
      if (absY >= DIRECTION_LOCK_PX && absY > absX * 1.1) {
        start.axis = "vertical";
        setDragX(0);
        return;
      }
      if (absX >= DIRECTION_LOCK_PX && absX >= absY * HORIZONTAL_DOMINANCE) {
        start.axis = "horizontal";
      } else {
        return;
      }
    }

    const width = viewportRef.current?.clientWidth || window.innerWidth;
    const maxDrag = Math.max(80, width * 0.9);
    setDragX(Math.max(-maxDrag, Math.min(maxDrag, deltaX)));
  }

  function onTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = startRef.current;
    resetGesture();
    setTransitionEnabled(true);

    if (!start || start.ignored || start.axis !== "horizontal") {
      setDragX(0);
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch || Date.now() - start.at > MAX_DURATION_MS) {
      setDragX(0);
      return;
    }

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const validSwipe =
      absX >= SWIPE_THRESHOLD &&
      absX >= absY * HORIZONTAL_DOMINANCE;

    setDragX(0);
    if (!validSwipe) return;

    suppressClickUntilRef.current = Date.now() + 450;
    haptic("tap");
    setPosition((current) => current + (deltaX < 0 ? 1 : -1));
  }

  function onTransitionEnd() {
    if (slideCount < 2) return;

    if (position === 0) {
      setTransitionEnabled(false);
      setPosition(slideCount);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTransitionEnabled(true));
      });
      return;
    }

    if (position === slideCount + 1) {
      setTransitionEnabled(false);
      setPosition(1);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTransitionEnabled(true));
      });
    }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  if (slideCount === 0) return null;
  if (slideCount === 1) return <>{slides[0]}</>;

  return (
    <div
      ref={viewportRef}
      className="w-full overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        resetGesture();
        setTransitionEnabled(true);
        setDragX(0);
      }}
      onClickCapture={onClickCapture}
      aria-roledescription="carousel"
      aria-label="Home sections"
    >
      <div
        className={`flex items-start ${transitionEnabled ? "transition-transform duration-300 ease-out" : ""}`}
        style={{
          transform: `translate3d(calc(-${trackOffsetPercent}% + ${dragX}px), 0, 0)`,
        }}
        onTransitionEnd={onTransitionEnd}
      >
        {loopSlides.map((slide, index) => {
          const logicalIndex =
            index === 0
              ? slideCount - 1
              : index === slideCount + 1
                ? 0
                : index - 1;
          const active = logicalIndex === realIndex && index === position;
          return (
            <div
              key={`home-slide-${index}`}
              className="min-w-full shrink-0"
              aria-hidden={!active}
            >
              {slide}
            </div>
          );
        })}
      </div>
    </div>
  );
}
