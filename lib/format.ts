export function formatBDT(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  // Group using the South Asian (lakh/crore) numbering convention.
  const str = String(abs);
  let formatted: string;
  if (str.length <= 3) {
    formatted = str;
  } else {
    const last3 = str.slice(-3);
    const rest = str.slice(0, -3);
    const restGrouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    formatted = `${restGrouped},${last3}`;
  }
  return `${sign}৳${formatted}`;
}

export function formatDateBn(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
