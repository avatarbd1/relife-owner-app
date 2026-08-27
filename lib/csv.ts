export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (inQuotes) throw new Error("CSV_UNCLOSED_QUOTE");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }

  return rows;
}

function sanitizeSpreadsheetText(value: string): string {
  const trimmed = value.trimStart();
  if (!trimmed) return value;
  if (/^[=+@]/.test(trimmed)) return `'${value}`;
  if (/^-/.test(trimmed) && !/^-\d+(?:\.\d+)?$/.test(trimmed)) return `'${value}`;
  return value;
}

export function escapeCsv(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string") text = sanitizeSpreadsheetText(text);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function objectsToCsv(
  rows: Array<Record<string, unknown>>,
  headers: string[]
): string {
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header])).join(","));
  }
  return lines.join("\r\n");
}
