import "server-only";

import { randomUUID } from "node:crypto";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { dhakaClockParts } from "@/lib/config/relifeSystem";

export interface TreatmentEntryInput {
  patientId: string;
  appointmentId: string;
  therapistId: string;
  notes: string;
  templateUsed?: string;
  photoPaths?: string[];
  duration: number; // minutes
  department: "Physio" | "Dental";
  requestId: string;
}

export interface TreatmentEntryResult {
  entryId: string;
  patientId: string;
  appointmentId: string;
  therapistId: string;
  notes: string;
  duration: number;
  timestamp: string;
  department: "Physio" | "Dental";
  duplicate: boolean;
}

export interface TreatmentTemplate {
  id: string;
  name: string;
  category: string;
  content: string;
  department: "Physio" | "Dental";
}

export interface PatientTreatmentHistory {
  patientId: string;
  entries: Array<{
    entryId: string;
    date: string;
    therapistName: string;
    duration: number;
    notes: string;
    department: "Physio" | "Dental";
  }>;
}

// In-memory storage for demo (will be replaced with database)
const treatmentEntries = new Map<string, {
  patientId: string;
  appointmentId: string;
  therapistId: string;
  notes: string;
  templateUsed?: string;
  photoPaths?: string[];
  duration: number;
  timestamp: string;
  department: "Physio" | "Dental";
}>();

const treatmentTemplates = new Map<string, TreatmentTemplate>([
  [
    "physio-standard",
    {
      id: "physio-standard",
      name: "Standard Physio Session",
      category: "General",
      content: "Patient attended session. ROM exercises performed. Patient compliance good.",
      department: "Physio",
    },
  ],
  [
    "physio-post-injury",
    {
      id: "physio-post-injury",
      name: "Post-Injury Assessment",
      category: "Assessment",
      content: "Injury assessment completed. ROM limited. Pain level moderate. Referred for advanced imaging if needed.",
      department: "Physio",
    },
  ],
  [
    "dental-checkup",
    {
      id: "dental-checkup",
      name: "Routine Checkup",
      category: "Checkup",
      content: "Dental examination completed. Teeth cleaned. No cavities detected.",
      department: "Dental",
    },
  ],
  [
    "dental-filling",
    {
      id: "dental-filling",
      name: "Filling Procedure",
      category: "Procedure",
      content: "Cavity identified and filled. Restoration successful. Bite verified.",
      department: "Dental",
    },
  ],
]);

const requestIdLog = new Set<string>();

export async function recordTreatmentEntry(
  context: AccessContext,
  input: TreatmentEntryInput
): Promise<TreatmentEntryResult> {
  assertCanPerform(context, "clinical.write", input.department);

  // Validate input
  if (!input.patientId) {
    throw new Error("MISSING_PATIENT_ID");
  }

  if (!input.therapistId) {
    throw new Error("MISSING_THERAPIST_ID");
  }

  if (!input.notes || input.notes.trim().length === 0) {
    throw new Error("MISSING_NOTES");
  }

  if (input.duration < 5 || input.duration > 480) {
    throw new Error("INVALID_DURATION");
  }

  // Check for duplicate request
  if (requestIdLog.has(input.requestId)) {
    const existing = Array.from(treatmentEntries.entries()).find(
      ([_, v]) => v.patientId === input.patientId && v.appointmentId === input.appointmentId
    );
    if (existing) {
      return {
        entryId: existing[0],
        patientId: input.patientId,
        appointmentId: input.appointmentId,
        therapistId: input.therapistId,
        notes: existing[1].notes,
        duration: existing[1].duration,
        timestamp: existing[1].timestamp,
        department: existing[1].department,
        duplicate: true,
      };
    }
  }

  // Get therapist from directory
  const directory = await getWebStaffDirectory();
  const therapist = directory.find(
    (s) => s.staffId === input.therapistId && s.primaryDepartment === input.department && s.status === "Active"
  );

  if (!therapist) {
    throw new Error("THERAPIST_NOT_FOUND");
  }

  // Create treatment entry
  const entryId = randomUUID();
  const now = dhakaClockParts();

  treatmentEntries.set(entryId, {
    patientId: input.patientId,
    appointmentId: input.appointmentId,
    therapistId: input.therapistId,
    notes: input.notes,
    templateUsed: input.templateUsed,
    photoPaths: input.photoPaths || [],
    duration: input.duration,
    timestamp: now.timestamp,
    department: input.department,
  });

  requestIdLog.add(input.requestId);

  return {
    entryId,
    patientId: input.patientId,
    appointmentId: input.appointmentId,
    therapistId: input.therapistId,
    notes: input.notes,
    duration: input.duration,
    timestamp: now.timestamp,
    department: input.department,
    duplicate: false,
  };
}

export async function getTreatmentTemplates(
  context: AccessContext,
  department: "Physio" | "Dental"
): Promise<TreatmentTemplate[]> {
  assertCanPerform(context, "clinical.read", department);

  return Array.from(treatmentTemplates.values()).filter((t) => t.department === department);
}

export async function getPatientTreatmentHistory(
  context: AccessContext,
  patientId: string,
  department: "Physio" | "Dental"
): Promise<PatientTreatmentHistory> {
  assertCanPerform(context, "clinical.read", department);

  const directory = await getWebStaffDirectory();
  const entries: PatientTreatmentHistory["entries"] = [];

  for (const [entryId, entry] of treatmentEntries.entries()) {
    if (entry.patientId === patientId && entry.department === department) {
      const therapist = directory.find((s) => s.staffId === entry.therapistId);

      entries.push({
        entryId,
        date: entry.timestamp.split("T")[0],
        therapistName: therapist?.fullName || "Unknown",
        duration: entry.duration,
        notes: entry.notes,
        department: entry.department,
      });
    }
  }

  return {
    patientId,
    entries: entries.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export async function updateTreatmentEntry(
  context: AccessContext,
  entryId: string,
  updates: Partial<TreatmentEntryInput>
): Promise<TreatmentEntryResult> {
  const entry = treatmentEntries.get(entryId);
  if (!entry) {
    throw new Error("ENTRY_NOT_FOUND");
  }

  assertCanPerform(context, "clinical.write", entry.department);

  // Update allowed fields
  if (updates.notes) {
    entry.notes = updates.notes;
  }
  if (updates.duration) {
    if (updates.duration < 5 || updates.duration > 480) {
      throw new Error("INVALID_DURATION");
    }
    entry.duration = updates.duration;
  }
  if (updates.photoPaths) {
    entry.photoPaths = updates.photoPaths;
  }

  return {
    entryId,
    patientId: entry.patientId,
    appointmentId: entry.appointmentId,
    therapistId: entry.therapistId,
    notes: entry.notes,
    duration: entry.duration,
    timestamp: entry.timestamp,
    department: entry.department,
    duplicate: false,
  };
}

export async function deleteTreatmentEntry(
  context: AccessContext,
  entryId: string
): Promise<{ success: boolean; entryId: string }> {
  const entry = treatmentEntries.get(entryId);
  if (!entry) {
    throw new Error("ENTRY_NOT_FOUND");
  }

  assertCanPerform(context, "clinical.write", entry.department);

  treatmentEntries.delete(entryId);

  return {
    success: true,
    entryId,
  };
}
