"use client";

import { useState } from "react";
import { Spinner, InlineNotice } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

interface RegisterCheckInUIProps {
  staffId: string;
  staffName: string;
  department: "Physio" | "Dental";
  onSuccess?: () => void;
}

export function StaffCheckInButton({ staffId, staffName, department, onSuccess }: RegisterCheckInUIProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);

  const handleCheckIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const requestId = `checkin-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "checkin",
          staffId,
          requestId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Check-in failed");
      }

      const result = await response.json();
      haptic("success");
      setCheckInTime(result.checkInTime);

      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  if (checkInTime) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-center">
        <p className="text-sm font-semibold text-green-900">✓ Checked in</p>
        <p className="mt-1 text-xs text-green-700">{staffName}</p>
        <p className="mt-0.5 text-xs text-green-600">{new Date(checkInTime).toLocaleTimeString()}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleCheckIn}
        disabled={isLoading}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isLoading ? <Spinner /> : "Check In"}
      </button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}

interface RegisterCheckOutProps {
  staffId: string;
  staffName: string;
  checkInTime?: string;
  onSuccess?: () => void;
}

export function StaffCheckOutButton({ staffId, staffName, checkInTime, onSuccess }: RegisterCheckOutProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkOutTime, setCheckOutTime] = useState<string | null>(null);
  const [hoursWorked, setHoursWorked] = useState<number | null>(null);

  const handleCheckOut = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const requestId = `checkout-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "checkout",
          staffId,
          requestId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Check-out failed");
      }

      const result = await response.json();
      haptic("success");
      setCheckOutTime(result.checkOutTime);
      setHoursWorked(result.hoursWorked);

      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  if (checkOutTime) {
    return (
      <div className="rounded-lg bg-slate-50 p-4 text-center">
        <p className="text-sm font-semibold text-slate-900">✓ Checked out</p>
        <p className="mt-1 text-xs text-slate-600">{staffName}</p>
        <p className="mt-0.5 text-xs text-slate-500">{hoursWorked?.toFixed(2)} hours worked</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleCheckOut}
        disabled={isLoading}
        className="w-full rounded-lg bg-slate-600 px-4 py-3 font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {isLoading ? <Spinner /> : "Check Out"}
      </button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}

interface PatientArrivalFormProps {
  department: "Physio" | "Dental";
  onSuccess?: () => void;
}

export function PatientArrivalForm({ department, onSuccess }: PatientArrivalFormProps) {
  const [patientId, setPatientId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (!patientId.trim()) {
        throw new Error("Patient ID required");
      }

      const requestId = `arrival-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "patient-arrival",
          patientId: patientId.trim(),
          department,
          requestId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to log arrival");
      }

      haptic("success");
      setSuccess(true);
      setPatientId("");

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
        <p className="text-sm font-semibold text-green-900">✓ Patient arrival logged</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="text"
        placeholder="Patient ID"
        value={patientId}
        onChange={(e) => setPatientId(e.target.value)}
        disabled={isLoading}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="submit"
        disabled={isLoading || !patientId.trim()}
        className="w-full rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        {isLoading ? <Spinner /> : "Log Arrival"}
      </button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </form>
  );
}
