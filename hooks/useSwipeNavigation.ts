"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type SwipeRoute = {
  href: string;
  matches: string[];
};

type SwipeNavigationOptions = {
  pathname: string;
  routes: SwipeRoute[];
  threshold?: number;
  maxDurationMs?: number;
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
  threshold = 56,
  maxDurationMs = 700,
}: SwipeNavigationOptions) {
  const router = useRouter();
  const startRef = useRef<{
    x: number;
    y: number;
    at: number;
    ignored: boolean;
  } | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  const routeKey = useMemo(
    () => routes.map((route) => `${route.href}:${route.matches.join(",")}`).join("|"),
    [routes]
  );

  useEffect(() => {
    setIsNavigating(false);
  }, [pathname]);

  useEffect(() => {
    const activeIndex = routes.findIndex((route) =>
      routeMatches(pathname, route.matches)
    );
    if (activeIndex < 0 || routes.length < 2) return;

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || isNavigating) {
        startRef.current = null;
        return;
      }
      const touch = event.touches[0];
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        at: Date.now(),
        ignored:
          isInteractiveTarget(event.target) || isHorizontalScroller(event.target),
      };
    }

    function onTouchEnd(event: TouchEvent) {
      const start = startRef.current;
      startRef.current = null;
      if (!start || start.ignored || isNavigating) return;
      if (Date.now() - start.at > maxDurationMs) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Horizontal intent must be clear enough that normal vertical scrolling wins.
      if (absX < threshold || absX <= absY * 1.25) return;

      const nextIndex = deltaX < 0 ? activeIndex + 1 : activeIndex - 1;
      const next = routes[nextIndex];
      if (!next) return;

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(8);
      }

      setIsNavigating(true);
      router.push(next.href);
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isNavigating, maxDurationMs, pathname, routeKey, router, routes, threshold]);

  return { isNavigating, setIsNavigating };
}
