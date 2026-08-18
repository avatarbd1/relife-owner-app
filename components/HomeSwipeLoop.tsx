"use client";

import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  TouchEvent as ReactTouchEvent,
} from "react";
import { useRef } from "react";
import { haptic } from "@/lib/interactions";

type GestureAxis = "pending" | "horizontal" | "vertical";

type GestureStart = {
  x: number;
  y: number;
  at: number;
  axis: GestureAxis;
  ignored: boolean;
};

const SWIPE_THRESHOLD = 72;
const MAX_DURATION_MS = 800;
const EDGE_GUARD_PX = 24;
const DIRECTION_LOCK_PX = 12;
const HORIZONTAL_DOMINANCE = 1.35;

function isBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,input,textarea,select,summary,form,table,[contenteditable='true'],[role='button'],[role='slider'],[role='dialog'],[data-home-swipe-ignore]"
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

function nearestItemIndex(items: HTMLElement[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < items.length; index += 1) {
    const distance = Math.abs(items[index].getBoundingClientRect().top - 16);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export default function HomeSwipeLoop({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<GestureStart | null>(null);
  const suppressClickUntilRef = useRef(0);

  function resetGesture() {
    startRef.current = null;
  }

  function onTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) {
      resetGesture();
      return;
    }

    const touch = event.touches[0];
    const nearSystemEdge =
      touch.clientX <= EDGE_GUARD_PX ||
      touch.clientX >= window.innerWidth - EDGE_GUARD_PX;

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
      if (absY >= DIRECTION_LOCK_PX && absY > absX * 1.15) {
        start.axis = "vertical";
        return;
      }
      if (absX >= DIRECTION_LOCK_PX && absX >= absY * HORIZONTAL_DOMINANCE) {
        start.axis = "horizontal";
      }
    }
  }

  function onTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = startRef.current;
    resetGesture();
    if (!start || start.ignored || start.axis === "vertical") return;

    const touch = event.changedTouches[0];
    if (!touch || Date.now() - start.at > MAX_DURATION_MS) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (
      absX < SWIPE_THRESHOLD ||
      absX < absY * HORIZONTAL_DOMINANCE
    ) {
      return;
    }

    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(
      root.querySelectorAll<HTMLElement>("[data-home-swipe-item]")
    );
    if (items.length < 2) return;

    const currentIndex = nearestItemIndex(items);
    const nextIndex =
      deltaX < 0
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length;
    const target = items[nextIndex];

    suppressClickUntilRef.current = Date.now() + 450;
    haptic("tap");
    const targetTop = window.scrollY + target.getBoundingClientRect().top - 16;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div
      ref={rootRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={resetGesture}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}
