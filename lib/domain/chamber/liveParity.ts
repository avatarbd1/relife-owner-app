import "server-only";

import {
  chamberDbMode,
  chamberSupabaseConfigured,
  getSupabaseChamberBootstrap,
  updateSupabaseChamberAppointmentStatus,
} from "@/lib/data/supabaseChamber";
import type { AccessContext } from "@/lib/webos/access";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { todayDhaka } from "@/lib/webos/reception";

type ChamberSnapshot = Awaited<ReturnType<typeof getChamberSnapshot>>;

type SupabaseStatus = "Arrived" | "In Treatment" | "Completed";

function exactCutover(): boolean {
  return chamberDbMode() === "supabase";
}

export function assertLiveChamberCutoverReady(): void {
  if (exactCutover() && !chamberSupabaseConfigured()) {
    throw new Error("SUPABASE_EDGE_SECRET_MISSING");
  }
}

function desiredStatuses(snapshot: ChamberSnapshot): Map<string, SupabaseStatus> {
  const desired = new Map<string, SupabaseStatus>();
  for (const item of snapshot.queue) {
    if (!item.appointmentId) continue;
    if (item.sessionStatus === "Waiting") desired.set(item.appointmentId, "Arrived");
    if (item.sessionStatus === "In Treatment") {
      desired.set(item.appointmentId, "In Treatment");
    }
  }
  for (const station of snapshot.stations) {
    const session = station.session;
    if (!session?.appointmentId) continue;
    if (session.status === "In Treatment") {
      desired.set(session.appointmentId, "In Treatment");
    }
  }
  return desired;
}

function sessionAppointmentId(snapshot: ChamberSnapshot, sessionId: string): string {
  const queue = snapshot.queue.find((item) => item.sessionId === sessionId);
  if (queue?.appointmentId) return queue.appointmentId;
  const station = snapshot.stations.find(
    (item) => item.session?.sessionId === sessionId
  );
  return station?.session?.appointmentId || "";
}

async function supabaseAppointmentsForToday() {
  assertLiveChamberCutoverReady();
  if (!exactCutover()) return new Map<string, string>();
  const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
  return new Map(
    bootstrap.appointments.map((row) => [String(row.id || "").trim(), String(row.status || "").trim()])
  );
}

async function reconcileSnapshot(
  context: AccessContext,
  snapshot: ChamberSnapshot
): Promise<boolean> {
  if (!exactCutover()) return false;
  const database = await supabaseAppointmentsForToday();
  const desired = desiredStatuses(snapshot);
  let changed = false;

  for (const [appointmentId, status] of desired) {
    const current = database.get(appointmentId);
    if (current === undefined || current === status) continue;
    await updateSupabaseChamberAppointmentStatus({
      appointmentId,
      status,
      actorId: context.staffId,
    });
    changed = true;
  }
  return changed;
}

/**
 * Live Chamber read model. Exact Supabase cutover reconciles active Sheet
 * sessions back into the authoritative appointment status before returning.
 */
export async function getCutoverChamberSnapshot(
  context: AccessContext
): Promise<ChamberSnapshot> {
  assertLiveChamberCutoverReady();
  const snapshot = await getChamberSnapshot(context);
  if (!exactCutover()) return snapshot;
  const changed = await reconcileSnapshot(context, snapshot);
  return changed ? getChamberSnapshot(context) : snapshot;
}

/**
 * Receive/start session writes remain on the current Chamber session ledger.
 * A transient Supabase status-sync failure is reported as pending and will be
 * retried by the next Chamber GET reconciliation instead of replaying the
 * already-successful session mutation.
 */
export async function reconcileLiveChamberAfterMutation(
  context: AccessContext
): Promise<boolean> {
  if (!exactCutover()) return true;
  try {
    const snapshot = await getChamberSnapshot(context);
    await reconcileSnapshot(context, snapshot);
    return true;
  } catch (error) {
    console.error("Live Chamber Supabase status reconciliation pending", error);
    return false;
  }
}

/**
 * Completion status is moved first because the subsequent Sheet completion is
 * retry-safe. If the Sheet write fails, the same completion request can retry;
 * the Supabase status update is idempotent.
 */
export async function prepareLiveChamberCompletion(
  context: AccessContext,
  sessionId: string
): Promise<void> {
  if (!exactCutover()) return;
  assertLiveChamberCutoverReady();
  const snapshot = await getChamberSnapshot(context);
  const appointmentId = sessionAppointmentId(snapshot, sessionId);
  if (!appointmentId) throw new Error("SESSION_NOT_FOUND");

  const database = await supabaseAppointmentsForToday();
  if (!database.has(appointmentId)) return;
  if (database.get(appointmentId) === "Completed") return;

  await updateSupabaseChamberAppointmentStatus({
    appointmentId,
    status: "Completed",
    actorId: context.staffId,
  });
}
