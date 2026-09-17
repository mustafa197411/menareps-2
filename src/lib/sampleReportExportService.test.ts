import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildSampleCsv, buildSamplePdf, buildSampleXlsx, type SampleTabularReport } from "./sampleReportExportService";

const report: SampleTabularReport<{ id: string; physician: string; quantity: number }> = { name: "Distribution", columns: [{ key: "id", header: "Distribution ID" }, { key: "physician", header: "Physician" }, { key: "quantity", header: "Quantity" }], rows: [{ id: "D-1", physician: "د. أحمد", quantity: 2 }] };
const context = { generatedBy: "Auditor", generatedAt: "2026-08-09T12:00:00.000Z", scope: "OWN", filters: { physicianId: "PHY-1" }, authorized: true };

describe("WP-S9 Samples exports", () => {
  it("creates UTF-8 CSV with filtered rows only", () => { const csv = buildSampleCsv(report, context); expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain("D-1"); expect(csv).not.toContain("D-2"); });
  it("preserves Arabic text in CSV", () => expect(buildSampleCsv(report, context)).toContain("د. أحمد"));
  it("escapes commas, quotes, and line breaks safely", () => { const value = buildSampleCsv({ ...report, rows: [{ id: "D-1", physician: 'Dr. "A", Clinic', quantity: 2 }] }, context); expect(value).toContain('"Dr. ""A"", Clinic"'); });
  it("creates a real XLSX sheet with headers and rows", () => { const bytes = buildSampleXlsx(report, context); const workbook = XLSX.read(bytes); const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }); expect(rows[0]).toEqual(["Distribution ID", "Physician", "Quantity"]); expect(rows[1]).toEqual(["D-1", "د. أحمد", "2"]); });
  it("creates non-empty PDF output", () => expect(buildSamplePdf(report, context).byteLength).toBeGreaterThan(500));
  it.each([buildSampleCsv, buildSampleXlsx, buildSamplePdf])("denies direct export when capability is false", builder => expect(() => builder(report, { ...context, authorized: false })).toThrow("SAMPLE_REPORT_EXPORT_DENIED"));
});
