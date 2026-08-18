import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { canPerform } from "@/lib/webos/access";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  try {
    const context = await requireCurrentAccessContext();
    const { photoId } = await params;

    // Check permissions
    const canWriteClinical =
      canPerform(context, "clinical.write", "Physio") ||
      canPerform(context, "clinical.write", "Dental");

    if (!canWriteClinical) {
      return NextResponse.json(
        { message: "No permission to delete treatment photos" },
        { status: 403 }
      );
    }

    if (!photoId) {
      return NextResponse.json(
        { message: "Photo ID is required" },
        { status: 400 }
      );
    }

    // TODO: Implement actual file deletion
    // Delete from cloud storage, Supabase, or local file system

    return NextResponse.json({
      success: true,
      message: "Photo deleted successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}
