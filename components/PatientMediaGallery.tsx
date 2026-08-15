"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PatientMediaGalleryItem = {
  id: string;
  url: string;
  fileName: string;
  fileType: string;
  uploadDate: string;
  uploadedBy: string;
  photo: boolean;
};

type Transform = {
  scale: number;
  x: number;
  y: number;
};

type Point = {
  x: number;
  y: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function buttonClass(): string {
  return "flex h-11 min-w-11 items-center justify-center rounded-full bg-black/45 px-3 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur active:scale-95";
}

export default function PatientMediaGallery({
  items,
  patientName,
}: {
  items: PatientMediaGalleryItem[];
  patientName: string;
}) {
  const photoIndexes = useMemo(
    () => items.map((item, index) => (item.photo ? index : -1)).filter((index) => index >= 0),
    [items]
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<
    | {
        mode: "pan";
        pointerId: number;
        start: Point;
        origin: Transform;
      }
    | {
        mode: "pinch";
        distance: number;
        midpoint: Point;
        origin: Transform;
      }
    | null
  >(null);
  const lastTapRef = useRef(0);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const resetTransform = useCallback(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    setTransform({ scale: 1, x: 0, y: 0 });
  }, []);

  const closeViewer = useCallback(() => {
    setOpenIndex(null);
    resetTransform();
  }, [resetTransform]);

  const movePhoto = useCallback(
    (direction: -1 | 1) => {
      if (openIndex === null || photoIndexes.length < 2) return;
      const currentPhotoPosition = photoIndexes.indexOf(openIndex);
      if (currentPhotoPosition < 0) return;
      const nextPosition =
        (currentPhotoPosition + direction + photoIndexes.length) % photoIndexes.length;
      setOpenIndex(photoIndexes[nextPosition]);
      resetTransform();
    },
    [openIndex, photoIndexes, resetTransform]
  );

  useEffect(() => {
    if (openIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowLeft") movePhoto(-1);
      if (event.key === "ArrowRight") movePhoto(1);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeViewer, movePhoto, openIndex]);

  const setScale = useCallback((nextScale: number) => {
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (scale === 1) {
      setTransform({ scale: 1, x: 0, y: 0 });
      return;
    }
    setTransform((current) => ({ ...current, scale }));
  }, []);

  const toggleZoom = useCallback(() => {
    const current = transformRef.current;
    if (current.scale > 1.05) {
      setTransform({ scale: 1, x: 0, y: 0 });
    } else {
      setTransform({ scale: 2.5, x: 0, y: 0 });
    }
  }, []);

  const beginPointerGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      gestureRef.current = {
        mode: "pinch",
        distance: Math.max(1, distance(points[0], points[1])),
        midpoint: midpoint(points[0], points[1]),
        origin: transformRef.current,
      };
      return;
    }
    gestureRef.current = {
      mode: "pan",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: transformRef.current,
    };
  };

  const movePointerGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    const gesture = gestureRef.current;

    if (points.length >= 2) {
      if (!gesture || gesture.mode !== "pinch") {
        gestureRef.current = {
          mode: "pinch",
          distance: Math.max(1, distance(points[0], points[1])),
          midpoint: midpoint(points[0], points[1]),
          origin: transformRef.current,
        };
        return;
      }
      const nextDistance = Math.max(1, distance(points[0], points[1]));
      const nextMidpoint = midpoint(points[0], points[1]);
      const scale = clamp(
        gesture.origin.scale * (nextDistance / gesture.distance),
        MIN_SCALE,
        MAX_SCALE
      );
      const midpointScale = scale / gesture.origin.scale;
      setTransform({
        scale,
        x:
          gesture.origin.x +
          (nextMidpoint.x - gesture.midpoint.x) -
          (gesture.midpoint.x - window.innerWidth / 2) * (midpointScale - 1),
        y:
          gesture.origin.y +
          (nextMidpoint.y - gesture.midpoint.y) -
          (gesture.midpoint.y - window.innerHeight / 2) * (midpointScale - 1),
      });
      return;
    }

    if (
      points.length === 1 &&
      gesture?.mode === "pan" &&
      gesture.pointerId === event.pointerId &&
      gesture.origin.scale > 1
    ) {
      setTransform({
        ...gesture.origin,
        x: gesture.origin.x + (event.clientX - gesture.start.x),
        y: gesture.origin.y + (event.clientY - gesture.start.y),
      });
    }
  };

  const endPointerGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    const remaining = [...pointersRef.current.entries()];
    if (remaining.length === 1) {
      const [pointerId, point] = remaining[0];
      gestureRef.current = {
        mode: "pan",
        pointerId,
        start: point,
        origin: transformRef.current,
      };
    } else if (remaining.length === 0) {
      gestureRef.current = null;
    }

    if (event.pointerType === "touch") {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        toggleZoom();
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const activeItem = openIndex === null ? null : items[openIndex];
  const activePhotoPosition =
    openIndex === null ? -1 : photoIndexes.indexOf(openIndex);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Photos & reports</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Tap photo → full screen · pinch/double-tap to zoom
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {items.length}
        </span>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 p-3">
          {items.map((item, index) => {
            const content = item.photo ? (
              <>
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={`${patientName} · ${item.id}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition duration-200 group-active:scale-[0.99]"
                  />
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
                    Tap to zoom
                  </span>
                </div>
                <MediaCaption item={item} />
              </>
            ) : (
              <>
                <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 px-3 text-center">
                  <span className="text-sm font-semibold text-slate-600">
                    {item.fileType || "Document"}
                  </span>
                </div>
                <MediaCaption item={item} />
              </>
            );

            return item.photo ? (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setOpenIndex(index);
                  resetTransform();
                }}
                className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition active:scale-[0.98]"
              >
                {content}
              </button>
            ) : (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition active:scale-[0.98]"
              >
                {content}
              </a>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          কোনো patient photo/report নেই।
        </p>
      )}

      {activeItem?.photo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${patientName} photo viewer`}
          className="fixed inset-0 z-[100] flex flex-col bg-black"
        >
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button type="button" onClick={closeViewer} className={buttonClass()} aria-label="Close photo">
              ✕
            </button>
            <div className="min-w-0 flex-1 text-center text-white">
              <p className="truncate text-sm font-semibold">{activeItem.fileName || patientName}</p>
              <p className="text-[11px] text-white/70">
                {activePhotoPosition + 1}/{photoIndexes.length} · {Math.round(transform.scale * 100)}%
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScale(transformRef.current.scale + 0.5)}
              className={buttonClass()}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            style={{ touchAction: "none" }}
            onPointerDown={beginPointerGesture}
            onPointerMove={movePointerGesture}
            onPointerUp={endPointerGesture}
            onPointerCancel={endPointerGesture}
            onDoubleClick={toggleZoom}
            onWheel={(event) => {
              event.preventDefault();
              setScale(transformRef.current.scale + (event.deltaY < 0 ? 0.25 : -0.25));
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeItem.url}
              alt={`${patientName} · ${activeItem.id}`}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain will-change-transform"
              style={{
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
                transition: pointersRef.current.size > 0 ? "none" : "transform 120ms ease-out",
              }}
            />
          </div>

          {photoIndexes.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => movePhoto(-1)}
                className={`${buttonClass()} absolute left-3 top-1/2 z-20 -translate-y-1/2`}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => movePhoto(1)}
                className={`${buttonClass()} absolute right-3 top-1/2 z-20 -translate-y-1/2`}
                aria-label="Next photo"
              >
                ›
              </button>
            </>
          )}

          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8">
            <button
              type="button"
              onClick={() => setScale(transformRef.current.scale - 0.5)}
              className={buttonClass()}
              aria-label="Zoom out"
            >
              −
            </button>
            <button type="button" onClick={resetTransform} className={buttonClass()}>
              Reset
            </button>
            <button type="button" onClick={toggleZoom} className={buttonClass()}>
              {transform.scale > 1.05 ? "Fit" : "2.5×"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function MediaCaption({ item }: { item: PatientMediaGalleryItem }) {
  return (
    <div className="p-2.5">
      <p className="truncate text-xs font-semibold text-slate-800">
        {item.fileName || item.id}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-slate-500">
        {item.uploadDate || "Date unavailable"}
      </p>
      {item.uploadedBy && (
        <p className="truncate text-[10px] leading-4 text-slate-400">
          {item.uploadedBy}
        </p>
      )}
    </div>
  );
}
