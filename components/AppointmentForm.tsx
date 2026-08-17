"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";

type Patient = {
  patientId: string;
  fullName: string;
  department: Department | "All";
  gender?: string;
};

type Clinician = {
  staffId: string;
  fullName: string;
  department: Department;
};

type ModalityOption = {
  value: string;
  label: string;
  durationMin: number;
  resourceId: string;
  resourceName: string;
  machine: boolean;
};

type TimelineStep = {
  sequence: number;
  name: string;
  durationMin: number;
  resourceId: string;
  resourceName: string;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
};

type BookingConflict = {
  type: string;
  message: string;
  resourceId?: string;
  busyUntil?: string;
};

type BookingSuggestion = {
  time: string;
  timeLabel: string;
  assignedBedId: string;
  roomId: string;
  totalDurationMin: number;
  reason: string;
};

type Validation = {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: string;
  assignedBedId: string;
  roomId: string;
  station: string;
  totalDurationMin: number;
  timeline: TimelineStep[];
  conflicts: BookingConflict[];
  suggestions: BookingSuggestion[];
  suggestedModalities: string[];
  needsTraction: boolean;
  modalityOptions: ModalityOption[];
};

function bedLabel(value: string): string {
  if (value === "TRACTION-BED") return "Traction Bed";
  const match = /^BED-([1-4])$/.exec(value);
  return match ? `Bed ${match[1]}` : value || "—";
}

export default function AppointmentForm({
  patients,
  clinicians,
  modalityOptions,
  defaultPatientId,
  defaultDate,
  defaultDepartment,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  modalityOptions: ModalityOption[];
  defaultPatientId?: string;
  defaultDate: string;
  defaultDepartment?: Department;
}) {
  const router = useRouter();
  const requestIdRef = useRef("");
  const defaultPatient = patients.find((patient) => patient.patientId === defaultPatientId);
  const initialDepartment = defaultPatient?.department === "Physio" || defaultPatient?.department === "Dental"
    ? defaultPatient.department
    : defaultDepartment;
  const [departmentFilter, setDepartmentFilter] = useState<Department | "All">(initialDepartment || "All");
  const [patientText, setPatientText] = useState(
    defaultPatient ? `${defaultPatient.patientId} — ${defaultPatient.fullName}` : ""
  );
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [therapist, setTherapist] = useState("");
  const [remarks, setRemarks] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [suggestedModalities, setSuggestedModalities] = useState<string[]>([]);
  const [needsTraction, setNeedsTraction] = useState(false);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [validationBusy, setValidationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modalitiesExpanded, setModalitiesExpanded] = useState(false);

  const patientId = patientText.split("—")[0]?.trim() || "";
  const selectedPatient = patients.find((patient) => patient.patientId === patientId);
  const visiblePatients = useMemo(
    () => patients.filter((patient) => departmentFilter === "All" || patient.department === departmentFilter),
    [departmentFilter, patients]
  );
  const departmentClinicians = useMemo(
    () =>
      selectedPatient && selectedPatient.department !== "All"
        ? clinicians.filter((item) => item.department === selectedPatient.department)
        : [],
    [clinicians, selectedPatient]
  );
  const selectedOptions = useMemo(
    () => modalities.flatMap((value) => {
      const option = modalityOptions.find((item) => item.value === value);
      return option ? [option] : [];
    }),
    [modalities, modalityOptions]
  );

  useEffect(() => {
    requestIdRef.current = "";
  }, [selectedPatient?.patientId, date, time, therapist, remarks, modalities]);

  useEffect(() => {
    if (!selectedPatient || selectedPatient.department !== "Physio") {
      setModalities([]);
      setSuggestedModalities([]);
      setNeedsTraction(false);
      setValidation(null);
      return;
    }
    let cancelled = false;
    setProfileBusy(true);
    setValidation(null);
    setModalities([]);
    setSuggestedModalities([]);
    setNeedsTraction(false);
    void fetch("/api/appointments/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientId: selectedPatient.patientId }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || "BOOKING_PROFILE_FAILED");
        if (cancelled) return;
        const suggested = Array.isArray(payload.profile?.suggestedModalities)
          ? payload.profile.suggestedModalities.map(String)
          : [];
        setSuggestedModalities(suggested);
        setNeedsTraction(Boolean(payload.profile?.needsTraction));
        if (suggested.length > 0) setModalities(suggested);
      })
      .catch((profileError) => {
        if (!cancelled) setError(profileError instanceof Error ? profileError.message : "Booking profile failed");
      })
      .finally(() => {
        if (!cancelled) setProfileBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPatient?.patientId, selectedPatient?.department]);

  useEffect(() => {
    if (!selectedPatient || selectedPatient.department !== "Physio" || !date || !time) {
      setValidation(null);
      setValidationBusy(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setValidationBusy(true);
      setError("");
      void fetch("/api/appointments/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.patientId,
          date,
          time,
          therapist,
          modalities,
        }),
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.ok) throw new Error(payload.error || "APPOINTMENT_VALIDATE_FAILED");
          if (!cancelled) {
            setValidation(payload.validation || null);
            if (payload.validation?.needsTraction !== undefined) {
              setNeedsTraction(Boolean(payload.validation.needsTraction));
            }
          }
        })
        .catch((validationError) => {
          if (!cancelled) {
            setValidation(null);
            setError(validationError instanceof Error ? validationError.message : "Appointment validation failed");
          }
        })
        .finally(() => {
          if (!cancelled) setValidationBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedPatient?.patientId, selectedPatient?.department, date, time, therapist, modalities]);

  function toggleModality(value: string) {
    haptic("tap");
    setModalities((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function stableRequestId(): string {
    if (!requestIdRef.current) {
      requestIdRef.current = `APPT${window.crypto.randomUUID().replace(/-/g, "")}`;
    }
    return requestIdRef.current;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPatient || !date || !time || !therapist || busy) return;
    if (selectedPatient.department === "Physio" && !validation?.isValid) {
      setError("Bed/machine validation clear না হওয়া পর্যন্ত booking confirm করা যাবে না।");
      haptic("error");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.patientId,
          date,
          time,
          therapist,
          remarks,
          modalities: selectedPatient.department === "Physio" ? modalities : [],
          requestId: selectedPatient.department === "Physio" ? stableRequestId() : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.validation) setValidation(result.validation as Validation);
        if (result.error === "APPOINTMENT_DUPLICATE") {
          throw new Error("এই রোগীর একই/overlapping appointment আগে থেকেই আছে।");
        }
        if (result.error === "APPOINTMENT_CONFLICT") {
          throw new Error(result.detail || "Machine/bed conflict detected. Suggested slot ব্যবহার করুন।");
        }
        if (result.error === "APPOINTMENT_CAPACITY") {
          throw new Error(result.detail || "এই slot-এ treatment capacity খালি নেই।");
        }
        if (result.error === "ACCESS_DENIED") {
          throw new Error("এই Department-এ appointment create permission নেই।");
        }
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      requestIdRef.current = "";
      haptic("success");
      router.push(`/appointments?date=${encodeURIComponent(date)}`);
      router.refresh();
    } catch (submitError) {
      haptic("error");
      setError(submitError instanceof Error ? submitError.message : "Appointment failed");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors duration-100 focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";

  const physioReady = selectedPatient?.department !== "Physio" || Boolean(validation?.isValid);

  return (
    <div className="relative">
      {selectedPatient && (
        <div
          className="sticky z-10 -mx-4 -mt-4 mb-4 border-b border-slate-200 bg-gradient-to-b from-blue-50 to-white px-4 py-2.5 shadow-sm"
          style={{ top: "calc(max(env(safe-area-inset-top), 0.55rem) + 3.125rem)" }}
        >
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-blue-700">{selectedPatient.department}</span>
            <span className="mx-1.5">·</span>
            <span className="font-semibold text-slate-900">{selectedPatient.fullName}</span>
            <span className="mx-1.5">·</span>
            <span className="text-slate-500">{selectedPatient.patientId}</span>
            {therapist && (
              <>
                <span className="mx-1.5">·</span>
                <span className="text-slate-600">{therapist}</span>
              </>
            )}
          </p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-700">Department</p>
          <div className="mt-2 grid grid-cols-3 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
          {(["All", "Physio", "Dental"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                haptic("tap");
                setDepartmentFilter(item);
                if (selectedPatient && item !== "All" && selectedPatient.department !== item) {
                  setPatientText("");
                  setTherapist("");
                  setModalities([]);
                  setValidation(null);
                }
              }}
              className={`relife-interactive min-h-10 rounded-lg px-2 text-xs font-semibold ${
                departmentFilter === item
                  ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-xs font-semibold text-slate-700">
        Patient *
        <input
          list="appointment-patients"
          value={patientText}
          onChange={(event) => {
            setPatientText(event.target.value);
            setTherapist("");
            setModalities([]);
            setValidation(null);
          }}
          placeholder="Patient ID বা নাম লিখুন"
          className={inputClass}
        />
        <datalist id="appointment-patients">
          {visiblePatients.map((patient) => (
            <option key={`${patient.department}-${patient.patientId}`} value={`${patient.patientId} — ${patient.fullName}`} />
          ))}
        </datalist>
      </label>

      {selectedPatient && (
        <div className={`rounded-xl border px-3 py-2.5 text-xs ${
          selectedPatient.department === "Dental"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-blue-200 bg-blue-50 text-blue-800"
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-semibold">{selectedPatient.fullName}</p><p className="mt-0.5 text-[11px] opacity-75">{selectedPatient.patientId} · {selectedPatient.department}</p></div>
            {selectedPatient.department === "Physio" && <StatusBadge tone={selectedPatient.gender ? "info" : "warning"}>{selectedPatient.gender || "Gender needed"}</StatusBadge>}
          </div>
        </div>
      )}

      <TapChoice
        label={`${selectedPatient?.department === "Dental" ? "Dentist" : "Therapist"} *`}
        value={therapist}
        disabled={!selectedPatient}
        columns={departmentClinicians.length >= 3 ? 3 : 2}
        tone={selectedPatient?.department === "Dental" ? "emerald" : "blue"}
        options={departmentClinicians.map((item) => ({
          value: item.fullName,
          label: item.fullName,
          subtitle: item.staffId,
        }))}
        onChange={setTherapist}
      />
      {selectedPatient && departmentClinicians.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">এই department-এ active clinician option পাওয়া যায়নি।</p>
      )}

      {selectedPatient?.department === "Physio" && (
        <section className="rounded-xl border border-slate-200 bg-slate-50/70">
          <button
            type="button"
            onClick={() => { setModalitiesExpanded(!modalitiesExpanded); haptic("tap"); }}
            className="relife-interactive w-full px-3 py-3 text-left hover:bg-slate-100/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-900">Treatment modalities</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {modalities.length > 0 ? `${modalities.length} selected · ${selectedOptions.reduce((sum, opt) => sum + opt.durationMin, 0)} min` : "Tap to expand"}
                </p>
                {suggestedModalities.length > 0 && <p className="mt-1 text-[10px] text-blue-700">📋 {suggestedModalities.map((value) => modalityOptions.find((item) => item.value === value)?.label || value).join(" → ")}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {profileBusy && <Spinner size="sm" label="Loading" />}
                <span className={`text-lg transition-transform ${modalitiesExpanded ? "rotate-180" : ""}`}>▼</span>
              </div>
            </div>
          </button>

          {modalitiesExpanded && (
            <div className="border-t border-slate-200 p-3">
              {needsTraction && <div className="mb-3"><StatusBadge tone="warning">Active plan requires Traction Bed</StatusBadge></div>}
              {suggestedModalities.length > 0 && (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-blue-50 p-2.5">
                  <p className="text-[11px] text-blue-800">Plan suggestion</p>
                  <button type="button" onClick={() => { setModalities(suggestedModalities); haptic("tap"); }} className="shrink-0 rounded-lg bg-blue-800 px-2.5 py-1.5 text-[10px] font-semibold text-white">Use</button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {modalityOptions.map((option) => {
                  const selectedIndex = modalities.indexOf(option.value);
                  const active = selectedIndex >= 0;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleModality(option.value)}
                      className={`relative min-h-14 rounded-xl border px-3 py-2 text-left transition-colors ${active ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      {active && <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-bold">{selectedIndex + 1}</span>}
                      <span className="block pr-5 text-xs font-semibold">{option.label}</span>
                      <span className={`mt-1 block text-[10px] ${active ? "text-blue-100" : "text-slate-400"}`}>{option.durationMin} min{option.machine ? " · single-use" : " · concurrent"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span>{selectedOptions.length ? selectedOptions.map((item) => item.label).join(" → ") : "No modality selected: generic 30 min slot"}</span>
                {modalities.length > 0 && <button type="button" onClick={() => setModalities([])} className="font-semibold text-red-700">Clear</button>}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-slate-700">
          Date *
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Time *
          <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
        </label>
      </div>

      {selectedPatient?.department === "Physio" && (
        <section className="space-y-2">
          {!time && <InlineNotice tone="neutral">Time select করলে bed + machine conflict check চলবে।</InlineNotice>}
          {time && validationBusy && <div className="flex min-h-16 items-center justify-center rounded-xl border border-blue-100 bg-blue-50"><Spinner label="Checking bed and machines" /></div>}
          {time && !validationBusy && validation?.isValid && (
            <div className="relife-success-flash rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs font-semibold text-emerald-950">✓ Slot safe to book</p><p className="mt-1 text-[11px] text-emerald-800">{bedLabel(validation.assignedBedId)} · {validation.roomId} · {validation.totalDurationMin} min</p></div>
                <StatusBadge tone="success">All clear</StatusBadge>
              </div>
              <div className="mt-3 space-y-1.5">
                {validation.timeline.map((step) => (
                  <div key={`${step.sequence}-${step.name}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-2.5 py-2 text-[11px]">
                    <span className="font-medium text-slate-800">{step.sequence}. {step.name}{step.resourceName ? ` · ${step.resourceName}` : ""}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{step.startTime}–{step.endTime}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {time && !validationBusy && validation && !validation.isValid && (
            <div className="relife-error-shake rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-red-950">Booking conflict</p><p className="mt-0.5 text-[11px] text-red-700">Current slot cannot be confirmed.</p></div><StatusBadge tone="error">Blocked</StatusBadge></div>
              <div className="mt-3 space-y-1.5">
                {validation.conflicts.map((conflict, index) => <p key={`${conflict.type}-${index}`} className="rounded-lg bg-white/70 px-2.5 py-2 text-[11px] font-medium text-red-800">{conflict.message}</p>)}
              </div>
              {validation.suggestions.length > 0 && (
                <div className="mt-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Next safe slots</p><div className="grid grid-cols-2 gap-2">{validation.suggestions.map((slot) => <button key={slot.time} type="button" onClick={() => { setTime(slot.time); haptic("tap"); }} className="min-h-11 rounded-lg border border-emerald-200 bg-white px-2 text-left text-[11px] text-emerald-900"><span className="block font-semibold">{slot.timeLabel}</span><span className="block text-[10px] text-emerald-700">{bedLabel(slot.assignedBedId)} · {slot.totalDurationMin}m</span></button>)}</div></div>
              )}
            </div>
          )}
        </section>
      )}

      <label className="block text-xs font-semibold text-slate-700">
        Remarks
        <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} className={inputClass} />
      </label>

      {error && (
        <p className="relife-error-shake rounded-xl border border-red-200 bg-red-100 px-3 py-2.5 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || validationBusy || !selectedPatient || !date || !time || !therapist || !physioReady}
        className="relife-interactive inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Spinner size="sm" className="border-white/40 border-t-white" label="Creating appointment" />}
        {busy ? "Creating appointment…" : selectedPatient?.department === "Physio" ? "Confirm safe booking" : "Create appointment"}
      </button>
      </form>
    </div>
  );
}
