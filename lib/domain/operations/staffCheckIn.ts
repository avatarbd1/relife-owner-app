import "server-only";

import { randomUUID } from "node:crypto";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { dhakaClockParts } from "@/lib/config/relifeSystem";

export interface StaffCheckInInput {
  staffId: string;
  requestId: string;
}

export interface StaffCheckOutInput {
  staffId: string;
  requestId: string;
}

export interface PatientArrivalInput {
  patientId: string;
  department: "Physio" | "Dental";
  requestId: string;
}

export interface CheckInStatus {
  checkInId: string;
  staffId: string;
  staffName: string;
  checkInTime: string;
  department: "Physio" | "Dental";
  duplicate: boolean;
}

export interface CheckOutStatus {
  checkOutId: string;
  staffId: string;
  staffName: string;
  checkInTime: string;
  checkOutTime: string;
  hoursWorked: number;
  duplicate: boolean;
}

export interface PatientArrivalStatus {
  arrivalId: string;
  patientId: string;
  arrivalTime: string;
  department: "Physio" | "Dental";
  duplicate: boolean;
}

// In-memory storage for demo (will be replaced with sheet/database)
const checkInRecords = new Map<string, { staffId: string; checkInTime: string; department: "Physio" | "Dental" }>();
const patientArrivals = new Map<string, { patientId: string; arrivalTime: string; date: string; department: "Physio" | "Dental" }>();
const requestIdLog = new Set<string>();

export async function staffCheckIn(
  context: AccessContext,
  input: StaffCheckInInput
): Promise<CheckInStatus> {
  // Validate access
  if (!context.roles.includes("Owner") && !context.roles.includes("Manager") && context.staffId !== input.staffId) {
    throw new Error("ACCESS_DENIED");
  }

  // Check for duplicate request
  if (requestIdLog.has(input.requestId)) {
    const existing = Array.from(checkInRecords.entries()).find(
      ([_, v]) => v.staffId === input.staffId && requestIdLog.has(input.requestId)
    );
    if (existing) {
      return {
        checkInId: existing[0],
        staffId: input.staffId,
        staffName: "",
        checkInTime: existing[1].checkInTime,
        department: existing[1].department,
        duplicate: true,
      };
    }
  }

  // Get staff from directory
  const directory = await getWebStaffDirectory();
  const staff = directory.find((s) => s.staffId === input.staffId && s.status === "Active");

  if (!staff) {
    throw new Error("STAFF_NOT_FOUND");
  }

  if (!staff.primaryDepartment || !["Physio", "Dental"].includes(staff.primaryDepartment)) {
    throw new Error("INVALID_DEPARTMENT");
  }

  // Check if already checked in today
  const now = dhakaClockParts();
  const todayKey = `${now.date}:${staff.staffId}`;
  const existingCheckIn = Array.from(checkInRecords.values()).find(
    (r) => r.staffId === staff.staffId && r.checkInTime.startsWith(now.date)
  );

  if (existingCheckIn && !existingCheckIn.checkInTime.includes("__checkout__")) {
    throw new Error("ALREADY_CHECKED_IN");
  }

  // Create check-in record
  const checkInId = randomUUID();
  const department = staff.primaryDepartment as "Physio" | "Dental";
  checkInRecords.set(checkInId, {
    staffId: staff.staffId,
    checkInTime: now.timestamp,
    department,
  });

  requestIdLog.add(input.requestId);

  return {
    checkInId,
    staffId: staff.staffId,
    staffName: staff.fullName,
    checkInTime: now.timestamp,
    department,
    duplicate: false,
  };
}

export async function staffCheckOut(
  context: AccessContext,
  input: StaffCheckOutInput
): Promise<CheckOutStatus> {
  // Validate access
  if (!context.roles.includes("Owner") && !context.roles.includes("Manager") && context.staffId !== input.staffId) {
    throw new Error("ACCESS_DENIED");
  }

  // Check for duplicate request
  if (requestIdLog.has(input.requestId)) {
    throw new Error("DUPLICATE_REQUEST");
  }

  // Get staff from directory
  const directory = await getWebStaffDirectory();
  const staff = directory.find((s) => s.staffId === input.staffId && s.status === "Active");

  if (!staff) {
    throw new Error("STAFF_NOT_FOUND");
  }

  if (!staff.primaryDepartment || !["Physio", "Dental"].includes(staff.primaryDepartment)) {
    throw new Error("INVALID_DEPARTMENT");
  }

  // Find today's check-in
  const now = dhakaClockParts();
  const checkInRecord = Array.from(checkInRecords.entries()).find(
    (entry) =>
      entry[1].staffId === staff.staffId &&
      entry[1].checkInTime.startsWith(now.date) &&
      !entry[1].checkInTime.includes("__checkout__")
  );

  if (!checkInRecord) {
    throw new Error("NOT_CHECKED_IN");
  }

  // Calculate hours worked
  const checkInTime = new Date(checkInRecord[1].checkInTime);
  const checkOutTime = new Date(now.timestamp);
  const hoursWorked = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);

  // Create check-out record
  const checkOutId = randomUUID();
  const department = staff.primaryDepartment as "Physio" | "Dental";
  checkInRecords.set(checkOutId, {
    staffId: staff.staffId,
    checkInTime: `${checkInRecord[1].checkInTime}__checkout__${now.timestamp}`,
    department,
  });

  requestIdLog.add(input.requestId);

  return {
    checkOutId,
    staffId: staff.staffId,
    staffName: staff.fullName,
    checkInTime: checkInRecord[1].checkInTime,
    checkOutTime: now.timestamp,
    hoursWorked: Math.round(hoursWorked * 100) / 100,
    duplicate: false,
  };
}

export async function logPatientArrival(
  context: AccessContext,
  input: PatientArrivalInput
): Promise<PatientArrivalStatus> {
  // Validate access (receptionist can log arrivals)
  assertCanPerform(context, "register.read", input.department);

  // Check for duplicate request
  if (requestIdLog.has(input.requestId)) {
    const existing = Array.from(patientArrivals.values()).find(
      (v) => v.patientId === input.patientId && requestIdLog.has(input.requestId)
    );
    if (existing) {
      return {
        arrivalId: Array.from(patientArrivals.entries()).find((e) => e[1] === existing)?.[0] || "",
        patientId: input.patientId,
        arrivalTime: existing.arrivalTime,
        department: existing.department,
        duplicate: true,
      };
    }
  }

  const now = dhakaClockParts();

  // Create arrival record
  const arrivalId = randomUUID();
  patientArrivals.set(arrivalId, {
    patientId: input.patientId,
    arrivalTime: now.timestamp,
    date: now.date,
    department: input.department,
  });

  requestIdLog.add(input.requestId);

  return {
    arrivalId,
    patientId: input.patientId,
    arrivalTime: now.timestamp,
    department: input.department,
    duplicate: false,
  };
}

export async function getTodayRegisterStatus(
  context: AccessContext,
  department: "Physio" | "Dental"
): Promise<{
  checkedIn: { staffId: string; staffName: string; checkInTime: string }[];
  checkedOut: { staffId: string; staffName: string; checkInTime: string; checkOutTime: string; hoursWorked: number }[];
  patientsArrived: { patientId: string; arrivalTime: string }[];
  date: string;
}> {
  assertCanPerform(context, "register.read", department);

  const directory = await getWebStaffDirectory();
  const now = dhakaClockParts();

  const checkedIn: { staffId: string; staffName: string; checkInTime: string }[] = [];
  const checkedOut: { staffId: string; staffName: string; checkInTime: string; checkOutTime: string; hoursWorked: number }[] = [];

  // Process check-in/out records
  for (const [_, record] of checkInRecords.entries()) {
    if (!record.checkInTime.startsWith(now.date) || record.department !== department) continue;

    const staff = directory.find((s) => s.staffId === record.staffId);
    if (!staff) continue;

    if (record.checkInTime.includes("__checkout__")) {
      const [checkInTime, checkOutTime] = record.checkInTime.split("__checkout__");
      const checkIn = new Date(checkInTime);
      const checkOut = new Date(checkOutTime);
      const hoursWorked = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);

      checkedOut.push({
        staffId: staff.staffId,
        staffName: staff.fullName,
        checkInTime,
        checkOutTime,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
      });
    } else {
      checkedIn.push({
        staffId: staff.staffId,
        staffName: staff.fullName,
        checkInTime: record.checkInTime,
      });
    }
  }

  // Process patient arrivals
  const patientsArrived = Array.from(patientArrivals.values())
    .filter((v) => v.date === now.date && v.department === department)
    .map((v) => ({ patientId: v.patientId, arrivalTime: v.arrivalTime }));

  return {
    checkedIn,
    checkedOut,
    patientsArrived,
    date: now.date,
  };
}
