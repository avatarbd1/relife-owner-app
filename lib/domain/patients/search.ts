export type PatientSearchDepartment = "All" | "Physio" | "Dental";
export type PatientSearchStatus = "All" | "Active" | "Inactive";
export type PatientSearchSort = "recent" | "name" | "due";
export type PatientSearchMatchField = "ID" | "Phone" | "Name" | "Diagnosis" | "Address" | "Therapist" | null;

export interface PatientSearchRecord {
  patientId: string;
  registrationDate: string;
  fullName: string;
  phone: string;
  department: "Physio" | "Dental" | "All";
  diagnosis: string;
  address: string;
  therapist: string;
  due: number;
  status: string;
}

export interface PatientSearchResult<T extends PatientSearchRecord> {
  patient: T;
  score: number;
  matchedBy: PatientSearchMatchField;
}

const BANGLA_DIGITS: Record<string, string> = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

export function normalizeSearchDigits(value: unknown): string {
  return String(value ?? "").replace(/[০-৯]/g, (digit) => BANGLA_DIGITS[digit] || digit);
}

export function normalizeSearchText(value: unknown): string {
  return normalizeSearchDigits(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: unknown): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function digitsOnly(value: unknown): string {
  return normalizeSearchDigits(value).replace(/\D/g, "");
}

function hasExactWord(value: string, query: string): boolean {
  return Boolean(query) && value.split(" ").some((token) => token === query);
}

function startsWord(value: string, query: string): boolean {
  return value.split(" ").some((token) => token.startsWith(query));
}

function includesAllTokens(value: string, tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => value.includes(token));
}

function scoreRecord<T extends PatientSearchRecord>(patient: T, rawQuery: string): PatientSearchResult<T> | null {
  const query = normalizeSearchText(rawQuery);
  if (!query) return { patient, score: 0, matchedBy: null };

  const queryCompact = compact(rawQuery);
  const queryDigits = digitsOnly(rawQuery);
  const queryTokens = query.split(" ").filter(Boolean);

  const patientId = normalizeSearchText(patient.patientId);
  const patientIdCompact = compact(patient.patientId);
  const fullName = normalizeSearchText(patient.fullName);
  const phone = normalizeSearchText(patient.phone);
  const phoneDigits = digitsOnly(patient.phone);
  const diagnosis = normalizeSearchText(patient.diagnosis);
  const address = normalizeSearchText(patient.address);
  const therapist = normalizeSearchText(patient.therapist);

  if (queryCompact && patientIdCompact === queryCompact) {
    return { patient, score: 1000, matchedBy: "ID" };
  }
  if (queryDigits.length >= 4 && phoneDigits === queryDigits) {
    return { patient, score: 960, matchedBy: "Phone" };
  }
  if (fullName === query) {
    return { patient, score: 940, matchedBy: "Name" };
  }
  if (queryCompact && patientIdCompact.startsWith(queryCompact)) {
    return { patient, score: 900, matchedBy: "ID" };
  }
  if (queryDigits.length >= 4 && phoneDigits.startsWith(queryDigits)) {
    return { patient, score: 860, matchedBy: "Phone" };
  }
  if (hasExactWord(fullName, query)) {
    return { patient, score: 850, matchedBy: "Name" };
  }
  if (queryDigits.length >= 4 && phoneDigits.endsWith(queryDigits)) {
    return { patient, score: 840, matchedBy: "Phone" };
  }
  if (fullName.startsWith(query)) {
    return { patient, score: 820, matchedBy: "Name" };
  }
  if (startsWord(fullName, query)) {
    return { patient, score: 800, matchedBy: "Name" };
  }
  if (includesAllTokens(fullName, queryTokens)) {
    return { patient, score: 760, matchedBy: "Name" };
  }
  if (queryDigits.length >= 4 && phoneDigits.includes(queryDigits)) {
    return { patient, score: 730, matchedBy: "Phone" };
  }
  if (patientId.includes(query) || patientIdCompact.includes(queryCompact)) {
    return { patient, score: 700, matchedBy: "ID" };
  }
  if (diagnosis.includes(query) || includesAllTokens(diagnosis, queryTokens)) {
    return { patient, score: 520, matchedBy: "Diagnosis" };
  }
  if (address.includes(query) || includesAllTokens(address, queryTokens)) {
    return { patient, score: 500, matchedBy: "Address" };
  }
  if (therapist.includes(query) || includesAllTokens(therapist, queryTokens)) {
    return { patient, score: 480, matchedBy: "Therapist" };
  }

  const combined = [patientId, fullName, phone, diagnosis, address, therapist].join(" ");
  if (includesAllTokens(combined, queryTokens)) {
    return { patient, score: 420, matchedBy: null };
  }
  return null;
}

function compareBase<T extends PatientSearchRecord>(a: T, b: T, sort: PatientSearchSort): number {
  if (sort === "name") return a.fullName.localeCompare(b.fullName, "en", { sensitivity: "base" });
  if (sort === "due") return b.due - a.due || a.fullName.localeCompare(b.fullName, "en", { sensitivity: "base" });
  return b.registrationDate.localeCompare(a.registrationDate) || b.patientId.localeCompare(a.patientId);
}

export function searchPatients<T extends PatientSearchRecord>(
  patients: T[],
  options: {
    query?: string;
    department?: PatientSearchDepartment;
    status?: PatientSearchStatus;
    sort?: PatientSearchSort;
  } = {}
): PatientSearchResult<T>[] {
  const query = String(options.query || "");
  const department = options.department || "All";
  const status = options.status || "All";
  const sort = options.sort || "recent";
  const hasQuery = Boolean(normalizeSearchText(query));

  const matches = patients.flatMap((patient) => {
    if (department !== "All" && patient.department !== department) return [];
    const active = normalizeSearchText(patient.status || "Active") === "active";
    if (status === "Active" && !active) return [];
    if (status === "Inactive" && active) return [];
    const result = scoreRecord(patient, query);
    return result ? [result] : [];
  });

  return matches.sort((a, b) => {
    if (hasQuery && b.score !== a.score) return b.score - a.score;
    return compareBase(a.patient, b.patient, sort);
  });
}
