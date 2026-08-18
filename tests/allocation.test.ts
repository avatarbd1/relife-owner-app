import { describe, it } from "node:test";
import { equal, deepEqual } from "node:assert";
import {
  allocationFromRemarks,
  allocationToChamber,
  cleanRemarks,
} from "../lib/domain/appointments/allocation.ts";

describe("Appointment Allocation Domain Logic", () => {
  describe("allocationFromRemarks", () => {
    it("parses [PTFLOW] tag with all fields", () => {
      const remarks = "some notes [PTFLOW gender=Male;room=Room 1;bed=Bed 1;station=Physio_A]";
      const result = allocationFromRemarks(remarks);

      equal(result.gender, "Male", "gender parsed");
      equal(result.room, "Room 1", "room parsed");
      equal(result.bed, "Bed 1", "bed parsed");
      equal(result.station, "Physio_A", "station parsed");
    });

    it("returns object with empty strings when [PTFLOW] tag is missing", () => {
      const remarks = "just some regular notes without allocation";
      const result = allocationFromRemarks(remarks);

      equal(result.gender, "", "gender empty when no tag");
      equal(result.room, "", "room empty when no tag");
      equal(result.bed, "", "bed empty when no tag");
      equal(result.station, "", "station empty when no tag");
    });

    it("handles partial fields in [PTFLOW] tag", () => {
      const remarks = "notes [PTFLOW gender=Female;room=Room 2]";
      const result = allocationFromRemarks(remarks);

      equal(result.gender, "Female", "parses present fields");
      equal(result.room, "Room 2", "parses room");
      equal(result.bed, "", "missing bed is empty string");
      equal(result.station, "", "missing station is empty string");
    });

    it("handles [PTFLOW] tag with underscores in values", () => {
      const remarks = "notes [PTFLOW gender=Male;room=Room 1;bed=Bed 1;station=Physio_Multi]";
      const result = allocationFromRemarks(remarks);

      equal(result.station, "Physio_Multi", "handles underscores");
    });

    it("is case-insensitive for tag name", () => {
      const remarks = "notes [ptflow gender=Male;room=Room 1]";
      const result = allocationFromRemarks(remarks);

      equal(result.gender, "Male", "case-insensitive tag matching");
    });
  });

  describe("cleanRemarks", () => {
    it("removes [PTFLOW] tag from remarks", () => {
      const remarks = "some notes [PTFLOW gender=Male;room=Room 1;bed=Bed 1;station=Physio_A]";
      const result = cleanRemarks(remarks);

      equal(result, "some notes", "removes [PTFLOW] tag");
    });

    it("preserves text before tag", () => {
      const remarks = "treatment notes here [PTFLOW gender=Male;room=Room 1]";
      const result = cleanRemarks(remarks);

      equal(result, "treatment notes here", "preserves text before tag");
    });

    it("handles remarks without tag unchanged", () => {
      const remarks = "just normal remarks";
      const result = cleanRemarks(remarks);

      equal(result, "just normal remarks", "returns unchanged if no tag");
    });

    it("trims extra whitespace after removal", () => {
      const remarks = "notes with extra spaces   [PTFLOW gender=Male]";
      const result = cleanRemarks(remarks);

      equal(result, "notes with extra spaces", "trims trailing whitespace");
    });
  });

  describe("allocationToChamber", () => {
    it("creates chamber allocation when bed and station are present", () => {
      const allocation = {
        gender: "Male",
        room: "Room 1",
        bed: "Bed 1",
        station: "Treatment",
      };
      const result = allocationToChamber(allocation, "scheduled");

      equal(result.allocation?.bedId, "Bed 1", "bed mapped");
      equal(result.allocation?.gender, "Male", "gender mapped");
      equal(result.allocation?.station, "Treatment", "station mapped");
      equal(result.canReceive, true, "can receive for scheduled status");
    });

    it("returns undefined allocation when bed and station are empty", () => {
      const allocation = { gender: "Male", room: "", bed: "", station: "" };
      const result = allocationToChamber(allocation, "waiting");

      equal(result.allocation, undefined, "allocation undefined when bed/station empty");
      equal(result.canReceive, false, "cannot receive without allocation");
    });

    it("determines treatment vs traction station correctly", () => {
      const tractionAllocation = {
        gender: "",
        room: "",
        bed: "",
        station: "Traction",
      };
      const treatmentAllocation = {
        gender: "",
        room: "",
        bed: "",
        station: "Treatment",
      };

      const tractionResult = allocationToChamber(tractionAllocation, "scheduled");
      const treatmentResult = allocationToChamber(treatmentAllocation, "scheduled");

      equal(tractionResult.allocation?.station, "Traction", "traction detected");
      equal(treatmentResult.allocation?.station, "Treatment", "treatment detected");
    });

    it("sets canReceive based on appointment status", () => {
      const allocation = {
        gender: "",
        room: "Room 1",
        bed: "Bed 1",
        station: "Treatment",
      };

      const scheduled = allocationToChamber(allocation, "scheduled");
      const waiting = allocationToChamber(allocation, "waiting");
      const inTreatment = allocationToChamber(allocation, "in treatment");

      equal(scheduled.canReceive, true, "scheduled can receive");
      equal(waiting.canReceive, false, "waiting cannot receive");
      equal(inTreatment.canReceive, false, "in treatment cannot receive");
    });
  });

  describe("Integration: full allocation lifecycle", () => {
    it("parses, cleans, and reconstructs allocation from remarks", () => {
      const original =
        "Patient underwent initial assessment [PTFLOW gender=Male;room=Room 1;bed=Bed 1;station=Treatment]";

      const allocation = allocationFromRemarks(original);
      const cleaned = cleanRemarks(original);
      const chamber = allocationToChamber(allocation, "scheduled");

      equal(cleaned, "Patient underwent initial assessment", "remarks cleaned");
      equal(allocation.gender, "Male", "allocation parsed");
      equal(chamber.allocation?.bedId, "Bed 1", "chamber reconstructed");
      equal(chamber.canReceive, true, "can receive with scheduled status");
    });

    it("handles missing allocation tag gracefully", () => {
      const remarks = "Just normal treatment notes without allocation";

      const allocation = allocationFromRemarks(remarks);
      const cleaned = cleanRemarks(remarks);

      equal(allocation.gender, "", "returns empty allocation");
      equal(cleaned, remarks, "returns unchanged remarks");
    });
  });
});
