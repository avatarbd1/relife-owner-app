"use client";

import { useState, useEffect } from "react";
import { Spinner, InlineNotice } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

interface AppointmentBookingFormProps {
  patientId: string;
  patientName: string;
  department: "Physio" | "Dental";
  onSuccess?: () => void;
}

interface AvailabilitySlot {
  startTime: string;
  duration: number;
  available: boolean;
}

interface TherapistOption {
  id: string;
  name: string;
}

export function AppointmentBookingForm({ patientId, patientName, department, onSuccess }: AppointmentBookingFormProps) {
  const [step, setStep] = useState<"therapist" | "date" | "time" | "confirm">("therapist");
  const [therapistId, setTherapistId] = useState("");
  const [therapistName, setTherapistName] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedDuration, setSelectedDuration] = useState("30");
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([]);
  const [therapists, setTherapists] = useState<TherapistOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fetchAvailability = async () => {
    if (!therapistId || !selectedDate) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/appointments?action=availability&therapistId=${therapistId}&date=${selectedDate}&department=${department}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch availability");
      }

      const data = await response.json();
      setAvailableSlots(data.availableSlots || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch availability");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (step === "time" && therapistId && selectedDate) {
      fetchAvailability();
    }
  }, [step, therapistId, selectedDate]);

  const handleBookAppointment = async () => {
    if (!therapistId || !selectedDate || !selectedTime || !selectedDuration) {
      setError("Please fill all fields");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const requestId = `appointment-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "book",
          patientId,
          therapistId,
          date: selectedDate,
          startTime: selectedTime,
          duration: Number(selectedDuration),
          department,
          requestId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to book appointment");
      }

      haptic("success");
      setSuccess(true);

      setTimeout(() => {
        setSuccess(false);
        setStep("therapist");
        setTherapistId("");
        setSelectedDate("");
        setSelectedTime("");
        setSelectedDuration("30");
        if (onSuccess) {
          onSuccess();
        }
      }, 2000);
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-center">
        <p className="text-sm font-semibold text-green-900">✓ Appointment booked</p>
        <p className="mt-1 text-xs text-green-700">{patientName}</p>
        <p className="mt-0.5 text-xs text-green-600">{selectedDate} at {selectedTime}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {step === "therapist" && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-900">Select Therapist</label>
          <select
            value={therapistId}
            onChange={(e) => {
              const selected = therapists.find((t) => t.id === e.target.value);
              setTherapistId(e.target.value);
              setTherapistName(selected?.name || "");
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Choose therapist...</option>
            {therapists.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setStep("date")}
            disabled={!therapistId || isLoading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? <Spinner /> : "Next"}
          </button>
        </div>
      )}

      {step === "date" && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-900">Select Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setStep("therapist")}
              className="flex-1 rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-300"
            >
              Back
            </button>
            <button
              onClick={() => setStep("time")}
              disabled={!selectedDate || isLoading}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? <Spinner /> : "Next"}
            </button>
          </div>
        </div>
      )}

      {step === "time" && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-900">Select Time Slot</label>
          <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {availableSlots.map((slot) => (
              <button
                key={slot.startTime}
                onClick={() => setSelectedTime(slot.startTime)}
                disabled={!slot.available}
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  selectedTime === slot.startTime
                    ? "bg-blue-600 text-white"
                    : slot.available
                      ? "bg-green-100 text-green-900 hover:bg-green-200"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                }`}
              >
                {slot.startTime}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-semibold text-slate-900">Duration (minutes)</label>
            <select
              value={selectedDuration}
              onChange={(e) => setSelectedDuration(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1.5 hours</option>
              <option value="120">2 hours</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep("date")}
              className="flex-1 rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-300"
            >
              Back
            </button>
            <button
              onClick={() => setStep("confirm")}
              disabled={!selectedTime || isLoading}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? <Spinner /> : "Confirm"}
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 space-y-1">
            <p className="text-sm text-slate-600"><span className="font-semibold">Patient:</span> {patientName}</p>
            <p className="text-sm text-slate-600"><span className="font-semibold">Therapist:</span> {therapistName}</p>
            <p className="text-sm text-slate-600"><span className="font-semibold">Date:</span> {selectedDate}</p>
            <p className="text-sm text-slate-600"><span className="font-semibold">Time:</span> {selectedTime}</p>
            <p className="text-sm text-slate-600"><span className="font-semibold">Duration:</span> {selectedDuration} minutes</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep("time")}
              className="flex-1 rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-300"
            >
              Back
            </button>
            <button
              onClick={handleBookAppointment}
              disabled={isLoading}
              className="flex-1 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isLoading ? <Spinner /> : "Book Appointment"}
            </button>
          </div>
        </div>
      )}

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}

interface AppointmentRescheduleFormProps {
  appointmentId: string;
  currentDate: string;
  currentTime: string;
  therapistId: string;
  department: "Physio" | "Dental";
  onSuccess?: () => void;
}

export function AppointmentRescheduleForm({
  appointmentId,
  currentDate,
  currentTime,
  therapistId,
  department,
  onSuccess,
}: AppointmentRescheduleFormProps) {
  const [newDate, setNewDate] = useState(currentDate);
  const [newTime, setNewTime] = useState(currentTime);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleReschedule = async () => {
    if (!newDate || !newTime) {
      setError("Please select new date and time");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reschedule",
          appointmentId,
          newDate,
          newTime,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reschedule");
      }

      haptic("success");
      setSuccess(true);

      setTimeout(() => {
        setSuccess(false);
        if (onSuccess) {
          onSuccess();
        }
      }, 2000);
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-center">
        <p className="text-sm font-semibold text-green-900">✓ Appointment rescheduled</p>
        <p className="mt-0.5 text-xs text-green-600">{newDate} at {newTime}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-slate-900">New Date</label>
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-slate-900">New Time</label>
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <button
        onClick={handleReschedule}
        disabled={isLoading}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isLoading ? <Spinner /> : "Reschedule"}
      </button>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}

interface AppointmentCancelButtonProps {
  appointmentId: string;
  onSuccess?: () => void;
}

export function AppointmentCancelButton({ appointmentId, onSuccess }: AppointmentCancelButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel this appointment?")) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          appointmentId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to cancel");
      }

      haptic("success");
      setCancelled(true);

      setTimeout(() => {
        if (onSuccess) {
          onSuccess();
        }
      }, 1000);
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  if (cancelled) {
    return <div className="text-sm font-semibold text-slate-500">Cancelled</div>;
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleCancel}
        disabled={isLoading}
        className="w-full rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
      >
        {isLoading ? <Spinner /> : "Cancel Appointment"}
      </button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}
