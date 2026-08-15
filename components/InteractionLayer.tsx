"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

const REFRESH_THRESHOLD = 80;
const MAX_PULL = 80;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "a,button,input,textarea,select,summary,[contenteditable='true'],[role='slider'],[data-pull-refresh-ignore]"
    )
  );
}

function isHorizontalScroller(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  let node: Element | null = target;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const scrollable =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 4;
      if (scrollable) return true;
    }
    node = node.parentElement;
  }
  return false;
}

export default function InteractionLayer() {
  const router = useRouter();
  const [online, setOnline] = useState<boolean | null>(null);
  const [showTop, setShowTop] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef<{
    startX: number;
    startY: number;
    rawDistance: number;
    ignored: boolean;
  } | null>(null);

  useEffect(() => {
    const updateNetwork = () => setOnline(navigator.onLine);
    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    return () => {
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const updateScroll = () => {
      frame = 0;
      const scrolled = window.scrollY > 12;
      document.documentElement.dataset.scrolled = scrolled ? "true" : "false";
      setShowTop(window.scrollY > 300);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateScroll);
    };
    updateScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      delete document.documentElement.dataset.scrolled;
    };
  }, []);

  useEffect(() => {
    const coarsePointer = window.matchMedia?.("(pointer: coarse)");
    const onPointerDown = (event: PointerEvent) => {
      if (!coarsePointer?.matches || event.pointerType === "mouse") return;
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest("a[href],button,[role='button']") as HTMLElement | null;
      if (!action) return;
      if (
        action.hasAttribute("disabled") ||
        action.getAttribute("aria-disabled") === "true" ||
        action.dataset.haptic === "off"
      ) {
        return;
      }
      haptic("tap");
    };
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const content = () =>
      document.querySelector<HTMLElement>("[data-dashboard-content]");

    const resetPull = () => {
      const node = content();
      if (node) {
        node.style.transition = "transform 150ms ease-out";
        node.style.transform = "translate3d(0, 0, 0)";
        window.setTimeout(() => {
          node.style.transition = "";
        }, 170);
      }
      setPullDistance(0);
      pullRef.current = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || window.scrollY > 0 || refreshing) {
        pullRef.current = null;
        return;
      }
      const touch = event.touches[0];
      pullRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        rawDistance: 0,
        ignored:
          isInteractiveTarget(event.target) || isHorizontalScroller(event.target),
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const start = pullRef.current;
      const touch = event.touches[0];
      if (!start || !touch || start.ignored || window.scrollY > 0) return;

      const deltaX = touch.clientX - start.startX;
      const deltaY = touch.clientY - start.startY;
      if (deltaY <= 0 || Math.abs(deltaX) > deltaY * 0.8) {
        resetPull();
        return;
      }

      start.rawDistance = deltaY;
      const visualDistance = Math.min(MAX_PULL, deltaY * 0.55);
      setPullDistance(visualDistance);
      const node = content();
      if (node) {
        node.style.transition = "none";
        node.style.transform = `translate3d(0, ${visualDistance}px, 0)`;
      }
    };

    const onTouchEnd = () => {
      const start = pullRef.current;
      const shouldRefresh = Boolean(
        start && !start.ignored && start.rawDistance >= REFRESH_THRESHOLD
      );
      resetPull();
      if (!shouldRefresh) return;
      setRefreshing(true);
      haptic("tap");
      router.refresh();
      window.setTimeout(() => setRefreshing(false), 650);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", resetPull, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", resetPull);
    };
  }, [refreshing, router]);

  const refreshProgress = Math.min(1, pullDistance / (REFRESH_THRESHOLD * 0.55));
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <>
      {(pullDistance > 8 || refreshing) && (
        <div
          className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),0.5rem)] z-40 flex justify-center"
          aria-live="polite"
        >
          <div className="relife-refresh-pill flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow-md backdrop-blur">
            <span
              aria-hidden="true"
              className={`grid h-5 w-5 place-items-center transition-transform duration-100 ${
                refreshProgress >= 1 ? "text-amber-600" : "text-blue-700"
              }`}
              style={{ transform: `rotate(${Math.min(180, refreshProgress * 180)}deg)` }}
            >
              ↻
            </span>
            <span>
              {refreshing
                ? "Refreshing…"
                : refreshProgress >= 1
                  ? "Release to refresh"
                  : "Pull to refresh"}
            </span>
          </div>
        </div>
      )}

      {online === false && (
        <div
          className="relife-network-banner fixed inset-x-4 z-40 rounded-xl border-l-4 border-amber-600 bg-amber-100 px-4 py-3 text-amber-900 shadow-lg"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-semibold">No internet connection</p>
          <p className="mt-0.5 text-xs text-amber-800">
            Server data and write actions require an internet connection.
          </p>
        </div>
      )}

      {refreshing && (
        <div className="sr-only" role="status" aria-live="polite">
          <Spinner size="sm" label="Refreshing page data" />
        </div>
      )}

      <button
        type="button"
        aria-label="Scroll to top"
        onClick={() => {
          haptic("tap");
          window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
        }}
        className={`relife-scroll-top fixed right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-blue-800 text-lg font-semibold text-white shadow-lg transition-[opacity,transform,background-color] duration-200 ease-out hover:bg-blue-900 focus-visible:outline-blue-800 ${
          showTop ? "scale-100 opacity-100" : "pointer-events-none scale-0 opacity-0"
        }`}
      >
        ↑
      </button>
    </>
  );
}
