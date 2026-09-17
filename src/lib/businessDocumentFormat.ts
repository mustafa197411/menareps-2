/** Formats the already-authorized components of a canonical business document number. */
export function formatBusinessDocumentNumber(
  countryCode: string,
  prefix: string,
  year: number | string,
  sequence: number | string,
): string {
  const cCode = (countryCode || "LY").toUpperCase();
  const pFix = (prefix || "GEN").toUpperCase();
  const yVal = String(year);
  const sPadded = String(sequence).padStart(6, "0");
  return `${cCode}-${pFix}-${yVal}-${sPadded}`;
}
