import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { analyzeImportRows, validateColumnMappings, type ImportEntityType, type ColumnMapping } from "@/lib/domain/tenancy/importMapping";
import { buildImportHandoff } from "@/lib/domain/tenancy/onboardingHandoff";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

interface ImportRequest {
  entityType: ImportEntityType;
  csvContent: string;
  mappings: ColumnMapping[];
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (quoted) throw new Error("MALFORMED_CSV_UNCLOSED_QUOTE");
  cells.push(current.trim());
  return cells;
}

export function parseCSV(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) throw new Error("MALFORMED_CSV_HEADERS");
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    if (cells.length !== headers.length) throw new Error("MALFORMED_CSV_COLUMN_COUNT");
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
  return { headers, rows };
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    validateTenantScope(access, tenant, "clinic.manage");
    if (!canPerform(access, "settings.manage", "Physio") && !canPerform(access, "settings.manage", "Dental")) {
      return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<ImportRequest>;
    const entityType = body.entityType as ImportEntityType;
    const csvContent = body.csvContent || "";
    const mappings = body.mappings || [];
    if (!["patients", "appointments", "services", "staff"].includes(entityType)) return NextResponse.json({ ok: false, error: "invalid entityType" }, { status: 400 });
    if (!csvContent.trim()) return NextResponse.json({ ok: false, error: "CSV content required" }, { status: 400 });
    if (mappings.length === 0) return NextResponse.json({ ok: false, error: "column mappings required" }, { status: 400 });

    const { headers, rows } = parseCSV(csvContent);
    if (rows.length === 0) return NextResponse.json({ ok: false, error: "no data rows found" }, { status: 400 });
    const mappingIssues = validateColumnMappings(entityType, mappings, headers);
    if (mappingIssues.length) return NextResponse.json({ ok: false, error: mappingIssues.join("; ") }, { status: 400 });

    const analysis = analyzeImportRows(entityType, rows, mappings, 10);
    const sourceDigestSha256 = createHash("sha256")
      .update(JSON.stringify({ entityType, csvContent, mappings }))
      .digest("hex");
    const handoff = buildImportHandoff(
      { organizationId: tenant.organizationId, clinicId: tenant.clinicId },
      {
        entityType,
        totalRows: analysis.totalRows,
        validRows: analysis.validRows,
        invalidRows: analysis.invalidRows,
        canProceed: analysis.canProceed,
        sourceDigestSha256,
      },
    );

    return NextResponse.json({
      ok: true,
      mode: "VALIDATION_PREVIEW_ONLY",
      organizationId: tenant.organizationId,
      clinicId: tenant.clinicId,
      entityType,
      totalRows: analysis.totalRows,
      validRows: analysis.validRows,
      invalidRows: analysis.invalidRows,
      previewRows: analysis.preview.length,
      canProceed: analysis.canProceed,
      preview: analysis.preview,
      mutationPerformed: false,
      handoff,
      nextStep: handoff.nextStep,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "IMPORT_PREVIEW_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|TENANT_SCOPE/.test(message) ? 403 : 500 });
  }
}
