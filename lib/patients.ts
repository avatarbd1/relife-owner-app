import "server-only";

import { fetchSheetRanges, hasPrivateSheetsCredentials } from "@/lib/data/googleSheets";
import type { Department, Scope } from "@/lib/types";

export interface PatientRecord {
  patientId: string;
  registrationDate: string;
  fullName: string;
  phone: string;
  age: string;
  gender: string;
  address: string;
  department: Department;
  diagnosis: string;
  therapist: string;
  paymentStatus: string;
  totalBill: number;
  paid: number;
  due: number;
  status: string;
  lastUpdated: string;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((value) => String(value || "").trim().toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(name.trim().toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function money(value: string): number {
  const parsed = Number.parseFloat(String(value || "0").replace(/৳|,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDepartment(value: string, fallback: Department): Department {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dental") return "Dental";
  if (normalized === "physio") return "Physio";
  if (normalized === "all") return "All";
  return fallback;
}

function parsePatients(rows: string[][], fallback: Department): PatientRecord[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const patientId = headerIndex(headers, "Patient_ID");
  const registrationDate = headerIndex(headers, "Registration_Date");
  const fullName = headerIndex(headers, "Full_Name", "Name");
  const phone = headerIndex(headers, "Phone");
  const age = headerIndex(headers, "Age");
  const gender = headerIndex(headers, "Gender");
  const address = headerIndex(headers, "Address");
  const department = headerIndex(headers, "Department");
  const diagnosis = headerIndex(headers, "Diagnosis");
  const therapist = headerIndex(headers, "Therapist");
  const paymentStatus = headerIndex(headers, "Payment_Status");
  const totalBill = headerIndex(headers, "Total_Bill");
  const paid = headerIndex(headers, "Paid");
  const due = headerIndex(headers, "Due");
  const status = headerIndex(headers, "Status");
  const lastUpdated = headerIndex(headers, "Last_Updated");

  return rows.slice(1).flatMap((row) => {
    const id = at(row, patientId);
    if (!id) return [];
    return [{
      patientId: id,
      registrationDate: at(row, registrationDate),
      fullName: at(row, fullName) || "Unknown",
      phone: at(row, phone),
      age: at(row, age),
      gender: at(row, gender),
      address: at(row, address),
      department: parseDepartment(at(row, department), fallback),
      diagnosis: at(row, diagnosis),
      therapist: at(row, therapist),
      paymentStatus: at(row, paymentStatus),
      totalBill: money(at(row, totalBill)),
      paid: money(at(row, paid)),
      due: money(at(row, due)),
      status: at(row, status) || "Active",
      lastUpdated: at(row, lastUpdated),
    }];
  });
}

let patientCache: { createdAt: number; promise: Promise<PatientRecord[]> } | undefined;
const CACHE_MS = 30_000;

async function loadPatients(): Promise<PatientRecord[]> {
  if (!hasPrivateSheetsCredentials()) return [];

  const [physio, dental] = await Promise.all([
    fetchSheetRanges("physio", ["02_Patients"]),
    fetchSheetRanges("dental", ["02_Patients"]),
  ]);

  const physioRows = parsePatients(physio["02_Patients"] || [], "Physio")
    .filter((row) => row.department !== "Dental");
  const dentalRows = parsePatients(dental["02_Patients"] || [], "Dental")
    .filter((row) => row.department === "Dental");

  return [...physioRows, ...dentalRows].sort((a, b) => {
    const dateOrder = b.registrationDate.localeCompare(a.registrationDate);
    if (dateOrder !== 0) return dateOrder;
    return b.patientId.localeCompare(a.patientId);
  });
}

export async function getPatients(): Promise<PatientRecord[]> {
  const now = Date.now();
  if (patientCache && now - patientCache.createdAt < CACHE_MS) {
    return patientCache.promise;
  }
  const promise = loadPatients();
  patientCache = { createdAt: now, promise };
  try {
    return await promise;
  } catch (error) {
    patientCache = undefined;
    console.error("Private Google Sheets patient read failed:", error);
    return [];
  }
}

export function patientsInScope(rows: PatientRecord[], scope: Scope): PatientRecord[] {
  if (scope === "combined") return rows;
  const department: Department = scope === "physio" ? "Physio" : "Dental";
  return rows.filter((row) => row.department === department);
}
