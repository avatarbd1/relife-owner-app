export interface AllocationFromRemarks {
  gender: string;
  room: string;
  bed: string;
  station: string;
}

export interface ChamberAllocation {
  roomId: string;
  bedId: string;
  bedLabel: string;
  station: "Treatment" | "Traction";
  gender: "Male" | "Female" | "";
  confirmed: boolean;
}

export function allocationFromRemarks(remarks: string): AllocationFromRemarks {
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  const result: AllocationFromRemarks = { gender: "", room: "", bed: "", station: "" };
  if (!match) return result;
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    const normalized = key?.trim().toLowerCase();
    if (normalized === "gender") result.gender = value;
    if (normalized === "room") result.room = value;
    if (normalized === "bed") result.bed = value;
    if (normalized === "station") result.station = value;
  }
  return result;
}

export function allocationToChamber(
  allocation: AllocationFromRemarks,
  status: string
): {
  allocation: ChamberAllocation | undefined;
  canReceive: boolean;
} {
  if (!allocation.bed && !allocation.station) {
    return { allocation: undefined, canReceive: false };
  }

  const bedLabel = allocation.bed || allocation.station || "Unknown";
  const isTraction = bedLabel.includes("TRACTION") || allocation.station === "Traction";
  const station = isTraction ? "Traction" : "Treatment";
  const confirmed = status === "scheduled" || status === "scheduled-physio" ? true : false;

  return {
    allocation: {
      roomId: allocation.room || "Main",
      bedId: allocation.bed || allocation.station,
      bedLabel,
      station,
      gender: allocation.gender as "Male" | "Female" | "",
      confirmed,
    },
    canReceive: ["scheduled", "scheduled-physio"].includes(status.trim().toLowerCase()),
  };
}

export function cleanRemarks(remarks: string): string {
  return String(remarks || "").replace(/\s*\[PTFLOW\s+[^\]]+\]/gi, "").trim();
}
