import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface SampleExportColumn<T extends Record<string, unknown> = Record<string, unknown>> { key: keyof T & string; header: string; }
export interface SampleTabularReport<T extends Record<string, unknown> = Record<string, unknown>> { name: string; columns: SampleExportColumn<T>[]; rows: T[]; }
export interface SampleExportContext { generatedBy: string; generatedAt: string; scope: string; filters: Record<string, string | undefined>; authorized: boolean; }

function assertExportAuthorized(context: SampleExportContext) { if (!context.authorized) throw new Error("SAMPLE_REPORT_EXPORT_DENIED"); }
const cell = (value: unknown) => value === null || value === undefined ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
const safeFilename = (name: string, extension: string, at: string) => `MENAREPS_Sample_${name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}_${at.slice(0, 10)}.${extension}`;

export function buildSampleCsv<T extends Record<string, unknown>>(report: SampleTabularReport<T>, context: SampleExportContext): string {
  assertExportAuthorized(context);
  const escape = (value: unknown) => { const text = cell(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return `\uFEFF${[report.columns.map(column => escape(column.header)).join(","), ...report.rows.map(row => report.columns.map(column => escape(row[column.key])).join(","))].join("\r\n")}`;
}

export function buildSampleXlsx<T extends Record<string, unknown>>(report: SampleTabularReport<T>, context: SampleExportContext): Uint8Array {
  assertExportAuthorized(context);
  const rows = [report.columns.map(column => column.header), ...report.rows.map(row => report.columns.map(column => cell(row[column.key])))];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = report.columns.map((column, index) => ({ wch: Math.min(45, Math.max(column.header.length + 2, ...report.rows.map(row => cell(row[column.key]).length + 2), index === 0 ? 16 : 10)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, report.name.slice(0, 31));
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

export function buildSamplePdf<T extends Record<string, unknown>>(report: SampleTabularReport<T>, context: SampleExportContext): ArrayBuffer {
  assertExportAuthorized(context);
  const document = new jsPDF({ orientation: report.columns.length > 7 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  document.setFontSize(14); document.text("MENAREPS CRM", 40, 38);
  document.setFontSize(11); document.text(report.name, 40, 56);
  document.setFontSize(8); document.text(`Generated: ${context.generatedAt} | By: ${context.generatedBy} | Scope: ${context.scope}`, 40, 72);
  const activeFilters = Object.entries(context.filters).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(" | ") || "None";
  document.text(`Filters: ${activeFilters}`, 40, 86, { maxWidth: document.internal.pageSize.getWidth() - 80 });
  autoTable(document, { startY: 100, head: [report.columns.map(column => column.header)], body: report.rows.map(row => report.columns.map(column => cell(row[column.key]))), styles: { fontSize: 6, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [79, 70, 229] }, didDrawPage: data => { document.setFontSize(7); document.text(`Page ${document.getNumberOfPages()}`, document.internal.pageSize.getWidth() - 65, document.internal.pageSize.getHeight() - 18); if (data.pageNumber > 1) document.text(report.name, 40, 24); } });
  return document.output("arraybuffer");
}

function downloadBlob(data: BlobPart, type: string, filename: string) { const url = URL.createObjectURL(new Blob([data], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
export function downloadSampleCsv<T extends Record<string, unknown>>(report: SampleTabularReport<T>, context: SampleExportContext) { downloadBlob(buildSampleCsv(report, context), "text/csv;charset=utf-8", safeFilename(report.name, "csv", context.generatedAt)); }
export function downloadSampleXlsx<T extends Record<string, unknown>>(report: SampleTabularReport<T>, context: SampleExportContext) { downloadBlob(buildSampleXlsx(report, context), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", safeFilename(report.name, "xlsx", context.generatedAt)); }
export function downloadSamplePdf<T extends Record<string, unknown>>(report: SampleTabularReport<T>, context: SampleExportContext) { downloadBlob(buildSamplePdf(report, context), "application/pdf", safeFilename(report.name, "pdf", context.generatedAt)); }
