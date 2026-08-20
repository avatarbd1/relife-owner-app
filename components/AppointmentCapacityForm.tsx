"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PHYSIO_CHAMBER_STARTS } from "@/lib/domain/chamber/hours";
import { haptic } from "@/lib/interactions";

type Clinician = {
  staffId: string;
  fullName: string;
  department: "Physio" | "Dental";
};

type Patient = {
  patientId: string;
  fullName: string;
  department: "Physio" | "Dental" | "All";
  gender?: string;
};

type Validation = {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  roomId: string;
  sessionMinutes: number;
  toleranceMinutes: number;
  conflicts: Array<{ type: string; message: string }>;
  warnings: Array<{ type: string; message: string }>;
  expectedDemand: Array<{
    resourceId: string;
    resourceName: string;
    durationMin: number;
    expectedThisHour: number;
  }>;
};

type SlotValidation = {
  date: string;
  validation: Validation | null;
  error: string;
};

function addDaysIso(startDate: string, days: number): string {
  const [year, month, day] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(Date.UTC(year, month - 1, day, 6)));
}

function timeLabel(value: string): string {
  const [hourRaw, minute] = value.split(":");
  const hour = Number(hourRaw);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

export default function AppointmentCapacityForm({
  patient,
  clinicians,
  startDate,
}: {
  patient: Patient;
  clinicians: Clinician[];
  startDate: string;
}) {
  const router = useRouter();
  const physioClinicians = useMemo(
    () => clinicians.filter((item) => item.department === "Physio"),
    [clinicians]
  );
  const quickDates = useMemo(
    () => Array.from({ length: 21 }, (_, index) => addDaysIso(startDate, index)),
    [startDate]
  );
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set([startDate]));
  const [time, setTime] = useState<string>(PHYSIO_CHAMBER_STARTS[0]);
  const [therapist, setTherapist] = useState("");
  const [remarks, setRemarks] = useState("");
  const [checks, setChecks] = useState<SlotValidation[]>([]);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string[]>([]);

  const dates = useMemo(() => [...selectedDates].sort(), [selectedDates]);

  useEffect(() => {
    if (!dates.length || !time) {
      setChecks([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setChecking(true);
      setError("");
      const next = await Promise.all(
        dates.map(async (date): Promise<SlotValidation> => {
          try {
            const response = await fetch("/api/appointments/capacity-booking", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "validate",
                patientId: patient.patientId,
                date,
                time,
                therapist,
                remarks,
              }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) {
              return {
                date,
                validation: payload.validation || null,
                error: payload.detail || payload.error || "Validation failed",
              };
            }
            return { date, validation: payload.validation as Validation, error: "" };
          } catch {
            return { date, validation: null, error: "Network error" };
          }
        })
      );
      if (!cancelled) {
        setChecks(next);
        setChecking(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dates, patient.patientId, remarks, therapist, time]);

  function toggleDate(date: string) {
    setSelectedDates((current) => {
      const next = new Set(current);
      if (next.has(date)) {
        if (next.size > 1) next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
    setSuccess([]);
    haptic("tap");
  }

  const allValid = checks.length === dates.length && checks.every((item) => item.validation?.isValid);

  async function createBookings() {
    if (!allValid || creating) return;
    setCreating(true);
    setError("");
    setSuccess([]);
    const created: string[] = [];
    try {
      for (const date of dates) {
        const response = await fetch("/api/appointments/capacity-booking", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create",
            patientId: patient.patientId,
            date,
            time,
            therapist,
            remarks,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          const detail = payload.validation?.conflicts?.map((item: { message: string }) => item.message).join(" · ");
          throw new Error(detail || payload.detail || payload.error || `Booking failed for ${date}`);
        }
        created.push(String(payload.appointmentId || date));
      }
      setSuccess(created);
      haptic("success");
      router.refresh();
      if (dates.length === 1) router.push("/appointments");
    } catch (createError) {
      haptic("error");
      setError(createError instanceof Error ? createError.message : "Booking failed");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  const primaryValidation = checks[0]?.validation;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
        <p className="text-xs font-bold text-emerald-950">General treatment · 60 ± 5 min</p>
        <p className="mt-1 text-[11px] leading-5 text-emerald-800">
          Booking শুধু gender/room capacity plan করে। TENS, IFT, Traction বা অন্য machine-এর exact time reserve হয় না।
        </p>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-700">Date</p>
          <span className="text-[10px] text-slate-400">একাধিক দিন select করা যায়</span>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {quickDates.map((date) => {
            const selected = selectedDates.has(date);
            return (
              <button
                key={date}
                type="button"
                onClick={() => toggleDate(date)}
                className={`min-w-[86px] rounded-xl border px-3 py-2.5 text-left ${
                  selected
                    ? "border-blue-700 bg-blue-50 text-blue-950 ring-1 ring-blue-700"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <span className="block text-[11px] font-bold">{dateLabel(date)}</span>
                <span className="mt-0.5 block text-[9px] opacity-60">{date}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold text-slate-700">Appointment hour</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {PHYSIO_CHAMBER_STARTS.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => {
                setTime(slot);
                setSuccess([]);
                haptic("tap");
              }}
              className={`min-h-11 rounded-xl border px-2 text-xs font-bold ${
                time === slot
                  ? "border-blue-700 bg-blue-700 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {timeLabel(slot)}
            </button>
          ))}
        </div>
      </section>

      <label className="block">
        <span className="text-xs font-semibold text-slate-700">Therapist · optional</span>
        <select
          value={therapist}
          onChange={(event) => setTherapist(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
        >
          <option value="">Any available therapist</option>
          {physioClinicians.map((item) => (
            <option key={item.staffId} value={item.fullName}>{item.fullName}</option>
          ))}
        </select>
        <p className="mt-1 text-[10px] text-slate-400">Therapist overlap warning দেখাবে, booking block করবে না।</p>
      </label>

      {primaryValidation?.expectedDemand?.length ? (
        <section className="rounded-xl border border-violet-100 bg-violet-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Expected machine demand</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {primaryValidation.expectedDemand.map((item) => (
              <span key={item.resourceId} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-violet-800 ring-1 ring-violet-100">
                {item.resourceName} · {item.durationMin}m · this hour ×{item.expectedThisHour}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-violet-600">Info only — কোনো machine lock/reservation হয় না।</p>
        </section>
      ) : null}

      <div className="space-y-2">
        {checks.map((item) => {
          const validation = item.validation;
          return (
            <div key={item.date} className={`rounded-xl border px-3 py-2.5 ${validation?.isValid ? "border-emerald-100 bg-emerald-50" : "border-red-100 bg-red-50"}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-slate-900">{dateLabel(item.date)} · {timeLabel(time)}</p>
                <span className={`text-[10px] font-bold ${validation?.isValid ? "text-emerald-700" : "text-red-700"}`}>
                  {validation?.isValid ? `${validation.roomId} capacity OK` : "Blocked"}
                </span>
              </div>
              {validation?.conflicts.map((conflict) => (
                <p key={`${conflict.type}:${conflict.message}`} className="mt-1 text-[10px] text-red-700">{conflict.message}</p>
              ))}
              {validation?.warnings.map((warning) => (
                <p key={`${warning.type}:${warning.message}`} className="mt-1 text-[10px] text-amber-700">⚠ {warning.message}</p>
              ))}
              {!validation && item.error ? <p className="mt-1 text-[10px] text-red-700">{item.error}</p> : null}
            </div>
          );
        })}
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-slate-700">Note · optional</span>
        <textarea
          rows={2}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          placeholder="Only if reception/therapist needs a note"
        />
      </label>

      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
      {success.length > 1 ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{success.length} appointments created.</p> : null}

      <button
        type="button"
        disabled={!allValid || checking || creating}
        onClick={() => void createBookings()}
        className="min-h-12 w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        {creating ? "Booking…" : checking ? "Checking capacity…" : dates.length > 1 ? `Book ${dates.length} appointments` : "Book appointment"}
      </button>
    </div>
  );
}
