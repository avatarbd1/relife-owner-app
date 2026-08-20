export type ChamberBedId =
  | "BED-1"
  | "BED-2"
  | "BED-3"
  | "BED-4"
  | "TRACTION-BED";

export type ChamberGender = "Male" | "Female" | "";

export interface ChamberBedOccupancy {
  bedId: string;
  gender: ChamberGender;
  patientId?: string;
  patientName?: string;
}

export interface ChamberBedConflict {
  type:
    | "gender_required"
    | "no_bed"
    | "bed_busy"
    | "gender_rule"
    | "treatment_plan";
  message: string;
}

export interface ChamberBedAllocation {
  bedId: string;
  roomId: string;
  station: "Treatment" | "Traction" | "";
  conflict?: ChamberBedConflict;
}

const ROOM_BEDS: Record<string, ChamberBedId[]> = {
  "Room 1": ["BED-1", "BED-2"],
  "Room 2": ["BED-3", "BED-4"],
};

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeChamberBedId(value: unknown): ChamberBedId | "" {
  const text = normalized(value);
  if (["traction", "traction bed", "traction-bed"].includes(text)) {
    return "TRACTION-BED";
  }
  const match = /bed[-\s]*([1-4])/.exec(text);
  return match ? (`BED-${match[1]}` as ChamberBedId) : "";
}

export function chamberRoomForBed(bedId: ChamberBedId): string {
  if (bedId === "BED-1" || bedId === "BED-2") return "Room 1";
  if (bedId === "BED-3" || bedId === "BED-4") return "Room 2";
  return "Traction Room";
}

export function chamberBedLabel(bedId: ChamberBedId): string {
  return bedId === "TRACTION-BED" ? "Traction Bed" : `Bed ${bedId.slice(-1)}`;
}

export function allocateChamberBed(input: {
  gender: ChamberGender;
  needsTraction: boolean;
  requestedBedId?: string;
  overlapping: ChamberBedOccupancy[];
}): ChamberBedAllocation {
  const { gender, needsTraction, overlapping } = input;
  const requestedText = String(input.requestedBedId ?? "").trim();
  const requestedBedId = requestedText
    ? normalizeChamberBedId(requestedText)
    : "";

  if (requestedText && !requestedBedId) {
    throw new Error("INVALID_BED");
  }

  if (!gender) {
    return {
      bedId: "",
      roomId: "",
      station: "",
      conflict: {
        type: "gender_required",
        message: "Patient gender must be set before Physio bed booking.",
      },
    };
  }

  if (requestedBedId) {
    const busy = overlapping.find(
      (item) => normalizeChamberBedId(item.bedId) === requestedBedId
    );
    if (busy) {
      return {
        bedId: "",
        roomId: chamberRoomForBed(requestedBedId),
        station: "",
        conflict: {
          type: "bed_busy",
          message: `${chamberBedLabel(requestedBedId)} is already booked for ${busy.patientName || busy.patientId || "another patient"}.`,
        },
      };
    }

    if (needsTraction && requestedBedId !== "TRACTION-BED") {
      return {
        bedId: "",
        roomId: chamberRoomForBed(requestedBedId),
        station: "",
        conflict: {
          type: "treatment_plan",
          message: "Active treatment plan requires the Traction Bed.",
        },
      };
    }

    if (requestedBedId === "TRACTION-BED") {
      return {
        bedId: requestedBedId,
        roomId: "Traction Room",
        station: "Traction",
      };
    }

    const roomId = chamberRoomForBed(requestedBedId);
    const roomGenders = new Set(
      overlapping
        .filter((item) => {
          const bedId = normalizeChamberBedId(item.bedId);
          return (
            bedId &&
            bedId !== "TRACTION-BED" &&
            chamberRoomForBed(bedId) === roomId &&
            Boolean(item.gender)
          );
        })
        .map((item) => item.gender)
    );

    if (roomGenders.size > 1) {
      return {
        bedId: "",
        roomId,
        station: "",
        conflict: {
          type: "gender_rule",
          message: `${roomId} already has mixed-gender data. Resolve chamber data before booking.`,
        },
      };
    }

    if (roomGenders.size === 1 && !roomGenders.has(gender)) {
      return {
        bedId: "",
        roomId,
        station: "",
        conflict: {
          type: "gender_rule",
          message: `${roomId} is locked for ${[...roomGenders][0]} during this hour.`,
        },
      };
    }

    return {
      bedId: requestedBedId,
      roomId,
      station: "Treatment",
    };
  }

  if (overlapping.length >= 4) {
    return {
      bedId: "",
      roomId: "",
      station: "",
      conflict: {
        type: "no_bed",
        message: "All 4 treatment beds are already booked for this hour.",
      },
    };
  }

  const occupiedBeds = new Set<string>();
  const roomGenders = new Map<string, Set<"Male" | "Female">>([
    ["Room 1", new Set<"Male" | "Female">()],
    ["Room 2", new Set<"Male" | "Female">()],
  ]);

  for (const item of overlapping) {
    const bedId = normalizeChamberBedId(item.bedId);
    if (!bedId || bedId === "TRACTION-BED") continue;
    occupiedBeds.add(bedId);
    const roomId = chamberRoomForBed(bedId);
    if (item.gender) roomGenders.get(roomId)?.add(item.gender);
  }

  for (const [roomId, genders] of roomGenders.entries()) {
    if (genders.size > 1) {
      return {
        bedId: "",
        roomId,
        station: "",
        conflict: {
          type: "gender_rule",
          message: `${roomId} already has a mixed-gender state. Resolve chamber data before booking.`,
        },
      };
    }
  }

  const preferredRooms = [
    ...Object.keys(ROOM_BEDS).filter((roomId) => {
      const genders = roomGenders.get(roomId) || new Set();
      return genders.size === 1 && genders.has(gender);
    }),
    ...Object.keys(ROOM_BEDS).filter(
      (roomId) => (roomGenders.get(roomId)?.size || 0) === 0
    ),
  ];

  for (const roomId of preferredRooms) {
    for (const bedId of ROOM_BEDS[roomId]) {
      if (!occupiedBeds.has(bedId)) {
        return {
          bedId,
          roomId,
          station: needsTraction ? "Traction" : "Treatment",
        };
      }
    }
  }

  return {
    bedId: "",
    roomId: "",
    station: "",
    conflict: {
      type: "gender_rule",
      message: `No gender-compatible treatment bed is free for ${gender}. This would mix genders within a treatment room or exceed capacity.`,
    },
  };
}
