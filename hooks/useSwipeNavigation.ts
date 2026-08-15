"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { haptic } from "@/lib/interactions";

export type SwipeRoute = {
  href: string;
  matches: string[];
};

export type SwipeDirection = "next" | "previous" | null;

type SwipeNavigationOptions = {
  pathname: string;
  routes: SwipeRoute[];
  threshold?: number;
  maxDurationMs?: number;
  edgeGuardPx?: number;
};

function routeMatches(pathname: string, matches: string[]): boolean {
  return matches.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "a,button,input,textarea,select,summary,[contenteditable='true'],[role='slider'],[data-swipe-nav-ignore]"
    )
  );
}

function isHorizontalScroller(target: EventTarget | null): boolean {
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

export function useSwipeNavigation({
  pathname,
  routes,
  threshold = 52,
  maxDurationMs = 800,
  edgeGuardPx = 24,
}: SwipeNavigationOptions) {
  const router = useRouter();
  const startRef = useRef<{
    x: number;
    y: number;
    at: number;
    ignored: boolean;
  } | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection>(null);

  const routeKey = useMemo(
    () => routes.map((route) => `${route.href}:${route.matches.join(",")}`).join("|"),
    [routes]
  );

  useEffect(() => {
    setIsNavigating(false);
    setSwipeProgress(0);
    setSwipeDirection(null);
  }, [pathname]);

  useEffect(() => {
    const activeIndex = routes.findIndex((route) =>
      routeMatches(pathname, route.matches)
    );
    if (activeIndex < 0 || routes.length < 2) return;

    function resetGesture() {
      startRef.current = null;
      if (!isNavigating) {
        setSwipeProgress(0);
        setSwipeDirection(null);
      }
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || isNavigating) {
        resetGesture();
        return;
      }
      const touch = event.touches[0];
      const nearSystemEdge =
        touch.clientX <= edgeGuardPx ||
        touch.clientX >= window.innerWidth - edgeGuardPx;
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        at: Date.now(),
        ignored:
          nearSystemEdge ||
          isInteractiveTarget(event.target) ||
          isHorizontalScroller(event.target),
      };
    }

    function onTouchMove(event: TouchEvent) {
      const start = startRef.current;
      const touch = event.touches[0];
      if (!start || !touch || start.ignored || isNavigating) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX < 10 || absX <= absY * 1.15) {
        if (absY > absX) {
          setSwipeProgress(0);
          setSwipeDirection(null);
        }
        return;
      }

      const direction: SwipeDirection = deltaX < 0 ? "next" : "previous";
      const nextIndex = direction === "next" ? activeIndex + 1 : activeIndex - 1;
      if (!routes[nextIndex]) {
        setSwipeProgress(0);
        setSwipeDirection(null);
        return;
      }

      setSwipeDirection(direction);
      setSwipeProgress(Math.min(absX / threshold, 1));
    }

    function onTouchEnd(event: TouchEvent) {
      const start = startRef.current;
      startRef.current = null;
      if (!start || start.ignored || isNavigating) {
        setSwipeProgress(0);
        setSwipeDirection(null);
        return;
      }

      const duration = Math.max(1, Date.now() - start.at);
      if (duration > maxDurationMs) {
        setSwipeProgress(0);
        setSwipeDirection(null);
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const velocity = absX / duration;
      const validDistance = absX >= threshold || (absX >= 32 && velocity >= 0.55);

      if (!validDistance || absX <= absY * 1.2) {
        setSwipeProgress(0);
        setSwipeDirection(null);
        return;
      }

      const nextIndex = deltaX < 0 ? activeIndex + 1 : activeIndex - 1;
      const next = routes[nextIndex];
      if (!next) {
        setSwipeProgress(0);
        setSwipeDirection(null);
        return;
      }

      haptic("tap");
      setSwipeProgress(1);
      setSwipeDirection(deltaX < 0 ? "next" : "previous");
      setIsNavigating(true);
      router.push(next.href);
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", resetGesture, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", resetGesture);
    };
  }, [edgeGuardPx, isNavigating, maxDurationMs, pathname, routeKey, router, routes, threshold]);

  return {
    isNavigating,
    setIsNavigating,
    swipeProgress,
    swipeDirection,
  };
}
