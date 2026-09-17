import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } from "docx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportOrderItem {
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  deliveredQuantity: number;
  remainingQuantity: number;
}

export interface ValidatedOrderForExport {
  id: string;
  displayNumber: string;
  invoiceNumber: string;
  deliveryNoteNumber: string;
  englishDate: string; // YYYY-MM-DD
  arabicDate: string;  // DD/MM/YYYY
  pharmacyName: string;
  pharmacyAddress: string;
  pharmacyPhone: string;
  customerName: string;
  orderNumber: string;
  orderDate: string;
  plannedDeliveryDate: string;
  salesRep: string;
  deliveryOfficerName: string;
  deliveryStatus: string;
  recipientName: string;
  deliveryNotes: string;
  completionDate: string;
  items: ExportOrderItem[];
  subtotal: number;
  discountAmount: number;
  grandTotal: number;
  currency: string;
}

export interface DocumentResolverResult {
  valid: boolean;
  error?: string;
  order?: ValidatedOrderForExport;
}

/**
 * Helper to download Blob files (Word documents)
 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 1. DocumentResolver: Resolves & Validates Firestore Order data
 */
export function resolveAndValidateOrderForExport(orderData: any): DocumentResolverResult {
  if (!orderData) {
    return { valid: false, error: "Order data is missing or null." };
  }

  const pharmacyName = orderData.pharmacyName || orderData.customerName || orderData.pharmacy;
  if (!pharmacyName || typeof pharmacyName !== "string" || !pharmacyName.trim()) {
    return { valid: false, error: "Incomplete Order: Missing Pharmacy Name. Cannot generate official document." };
  }

  const rawItems = orderData.items || orderData.products || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { valid: false, error: "Incomplete Order: Missing Product Items. Cannot generate official document." };
  }

  const orderId = String(orderData.displayNumber || orderData.id || "0000");
  const invoiceNumber = orderData.invoiceNumber || `INV-${orderId}`;
  const deliveryNoteNumber = orderData.deliveryNoteNumber || `DN-${orderId}`;

  // Date formatting
  const rawDate = orderData.createdAt ? new Date(orderData.createdAt) : new Date();
  const validDate = isNaN(rawDate.getTime()) ? new Date() : rawDate;
  
  const yyyy = validDate.getFullYear();
  const mm = String(validDate.getMonth() + 1).padStart(2, "0");
  const dd = String(validDate.getDate()).padStart(2, "0");

  const englishDate = `${yyyy}-${mm}-${dd}`;
  const arabicDate = `${dd}/${mm}/${yyyy}`;

  const addressParts = [
    orderData.pharmacyAddress,
    orderData.area,
    orderData.city,
    orderData.district,
    orderData.country
  ].filter(Boolean);
  if (addressParts.length === 0) return { valid: false, error: "Incomplete Order: Missing canonical pharmacy geography. Cannot generate official document." };
  const pharmacyAddress = addressParts.join(" - ");
  const pharmacyPhone = orderData.pharmacyPhone || orderData.phone || orderData.contactPhone || "N/A";
  const customerName = orderData.pharmacistName || orderData.contactPerson || orderData.clientName || pharmacyName;

  const items: ExportOrderItem[] = rawItems.map((item: any, idx: number) => {
    const qty = Number(item.quantity || item.qty || 1);
    const unitPrice = Number(item.unitPrice || item.price || 0);
    const discount = Number(item.discount || 0);
    const lineTotal = item.lineTotal !== undefined ? Number(item.lineTotal) : qty * unitPrice * (1 - discount / 100);
    const deliveredQty = item.deliveredQuantity !== undefined ? Number(item.deliveredQuantity) : qty;
    const remainingQty = Math.max(0, qty - deliveredQty);

    return {
      productName: item.productName || item.name || `Product #${idx + 1}`,
      sku: item.sku || item.productId || item.code || "SKU-N/A",
      quantity: qty,
      unitPrice,
      discount,
      lineTotal,
      deliveredQuantity: deliveredQty,
      remainingQuantity: remainingQty
    };
  });

  const subtotal = orderData.subtotal !== undefined 
    ? Number(orderData.subtotal) 
    : items.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0);

  const discountAmount = orderData.discountAmount !== undefined 
    ? Number(orderData.discountAmount) 
    : items.reduce((acc, item) => acc + (item.quantity * item.unitPrice * (item.discount / 100)), 0);

  const grandTotal = orderData.total !== undefined 
    ? Number(orderData.total) 
    : Math.max(0, subtotal - discountAmount);

  const validated: ValidatedOrderForExport = {
    id: String(orderData.id || orderId),
    displayNumber: orderId,
    invoiceNumber,
    deliveryNoteNumber,
    englishDate,
    arabicDate,
    pharmacyName,
    pharmacyAddress,
    pharmacyPhone,
    customerName,
    orderNumber: orderId,
    orderDate: arabicDate,
    plannedDeliveryDate: orderData.plannedDeliveryDate || "N/A",
    salesRep: orderData.salesRep || orderData.repName || "N/A",
    deliveryOfficerName: orderData.deliveryOfficerName || orderData.assignedDeliveryOfficerName || "Assigned Logistics Team",
    deliveryStatus: orderData.status || "CONFIRMED",
    recipientName: orderData.recipientName || "N/A",
    deliveryNotes: orderData.deliveryNotes || orderData.notes || "N/A",
    completionDate: orderData.deliveryCompletedAt ? new Date(orderData.deliveryCompletedAt).toLocaleDateString() : "N/A",
    items,
    subtotal,
    discountAmount,
    grandTotal,
    currency: String(orderData.currencyCode || orderData.currency || "").toUpperCase()
  };

  if (!/^[A-Z]{3}$/.test(validated.currency)) return { valid: false, error: "Incomplete Order: Missing canonical currency. Cannot generate official document." };

  return { valid: true, order: validated };
}

/**
 * 2. Commercial Invoice Builders
 */
export async function exportCommercialInvoiceDocx(orderData: any): Promise<void> {
  const { valid, error, order } = resolveAndValidateOrderForExport(orderData);
  if (!valid || !order) {
    alert(error || "Cannot export document: Invalid order data.");
    return;
  }

  const filename = `فاتورة_تجارية_${order.invoiceNumber}.docx`;

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Header Title
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: "MENAREPS 2.0 - شركة مينا ريبس للخدمات الدوائية والتجارية",
                bold: true,
                size: 24,
                color: "1E293B"
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: "فاتورة تجارية رسمية",
                bold: true,
                size: 32,
                color: "4F46E5"
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `رقم الفاتورة: ${order.invoiceNumber}  |  تاريخ الإصدار: ${order.arabicDate}`,
                bold: true,
                size: 20,
                color: "64748B"
              })
            ]
          }),
          new Paragraph({ text: "" }),

          // Customer & Order Metadata
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "■ بيانات العميل والصيدلية:", bold: true, size: 22, color: "0F172A" })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `اسم الصيدلية: ${order.pharmacyName}\n`, size: 20 }),
              new TextRun({ text: `العنوان: ${order.pharmacyAddress}\n`, size: 20 }),
              new TextRun({ text: `رقم الهاتف: ${order.pharmacyPhone}\n`, size: 20 }),
              new TextRun({ text: `المسؤول: ${order.customerName}`, size: 20 })
            ]
          }),
          new Paragraph({ text: "" }),

          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "■ تفاصيل الطلبية والشحن:", bold: true, size: 22, color: "0F172A" })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `رقم الطلبية: #${order.orderNumber}\n`, size: 20 }),
              new TextRun({ text: `مندوب المبيعات: ${order.salesRep}\n`, size: 20 }),
              new TextRun({ text: `تاريخ التوصيل المخطط: ${order.plannedDeliveryDate}`, size: 20 })
            ]
          }),
          new Paragraph({ text: "" }),

          // Products Table
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "■ المنتجات والأصناف:", bold: true, size: 22, color: "0F172A" })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              // Header Row
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "الإجمالي", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "الخصم", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "سعر الوحدة", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "الكمية", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "SKU", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "اسم المنتج", bold: true })], alignment: AlignmentType.RIGHT })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "#", bold: true })], alignment: AlignmentType.CENTER })] })
                ]
              }),
              // Item Rows
              ...order.items.map((item, idx) => 
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${item.lineTotal.toLocaleString()} ${order.currency}` })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${item.discount}%` })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${item.unitPrice.toLocaleString()} ${order.currency}` })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${item.quantity}` })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.sku })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.productName })], alignment: AlignmentType.RIGHT })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${idx + 1}` })], alignment: AlignmentType.CENTER })] })
                  ]
                })
              )
            ]
          }),
          new Paragraph({ text: "" }),

          // Summary Financial Box
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `المجموع الفرعي: ${order.subtotal.toLocaleString()} ${order.currency}\n`, size: 20 }),
              new TextRun({ text: `خصم إجمالي: ${order.discountAmount.toLocaleString()} ${order.currency}\n`, size: 20 }),
              new TextRun({ text: `المبلغ الإجمالي المستحق: ${order.grandTotal.toLocaleString()} ${order.currency}`, bold: true, size: 24, color: "4F46E5" })
            ]
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "" }),

          // Footer
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "تم الإعداد بواسطة MENAREPS CRM - تم الإنشاء إلكترونياً.", size: 18, color: "94A3B8" })
            ]
          })
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, filename);
}

export async function exportCommercialInvoicePdf(orderData: any): Promise<void> {
  const { valid, error, order } = resolveAndValidateOrderForExport(orderData);
  if (!valid || !order) {
    alert(error || "Cannot export document: Invalid order data.");
    return;
  }

  const filename = `Commercial_Invoice_${order.invoiceNumber}.pdf`;
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  // Header Branding
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text("MENAREPS 2.0 - Commercial Operations", 14, 20);

  doc.setFontSize(20);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text("COMMERCIAL INVOICE", 14, 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Invoice No: ${order.invoiceNumber}`, 14, 34);
  doc.text(`Date: ${order.englishDate}`, 14, 39);

  // Divider Line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(14, 43, 196, 43);

  // Customer & Order Info Boxes
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("CUSTOMER INFORMATION", 14, 50);
  doc.text("ORDER & LOGISTICS DETAILS", 110, 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);

  // Customer Column
  doc.text(`Pharmacy: ${order.pharmacyName}`, 14, 56);
  doc.text(`Address: ${order.pharmacyAddress}`, 14, 61);
  doc.text(`Phone: ${order.pharmacyPhone}`, 14, 66);
  doc.text(`Contact Person: ${order.customerName}`, 14, 71);

  // Order Details Column
  doc.text(`Order Number: #${order.orderNumber}`, 110, 56);
  doc.text(`Sales Representative: ${order.salesRep}`, 110, 61);
  doc.text(`Delivery Officer: ${order.deliveryOfficerName}`, 110, 66);
  doc.text(`Planned Delivery Date: ${order.plannedDeliveryDate}`, 110, 71);

  // Table of Products
  const tableHead = [["#", "Product Description", "SKU", "Qty", "Unit Price", "Discount", "Line Total"]];
  const tableRows = order.items.map((item, idx) => [
    idx + 1,
    item.productName,
    item.sku,
    item.quantity,
    `${item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${order.currency}`,
    `${item.discount}%`,
    `${item.lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${order.currency}`
  ]);

  autoTable(doc, {
    startY: 78,
    head: tableHead,
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: [79, 70, 229],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: [30, 41, 59]
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 60 },
      2: { cellWidth: 25, halign: "center" },
      3: { cellWidth: 15, halign: "center" },
      4: { cellWidth: 25, halign: "right" },
      5: { cellWidth: 20, halign: "center" },
      6: { cellWidth: 27, halign: "right" }
    }
  });

  const finalY = (doc as any).lastAutoTable.finalY || 130;

  // Financial Summary Box
  const summaryX = 120;
  const summaryY = finalY + 10;

  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(summaryX, summaryY, 76, 32, 2, 2, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("Subtotal:", summaryX + 4, summaryY + 8);
  doc.text(`${order.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${order.currency}`, summaryX + 72, summaryY + 8, { align: "right" });

  doc.text("Total Discount:", summaryX + 4, summaryY + 16);
  doc.text(`-${order.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${order.currency}`, summaryX + 72, summaryY + 16, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("Grand Total:", summaryX + 4, summaryY + 25);
  doc.setTextColor(79, 70, 229);
  doc.text(`${order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${order.currency}`, summaryX + 72, summaryY + 25, { align: "right" });

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Prepared by MENAREPS CRM - Generated electronically.", 14, pageHeight - 10);

  doc.save(filename);
}

/**
 * 3. Delivery Note Builders (NO FINANCIAL INFO)
 */
export async function exportDeliveryNoteDocx(orderData: any): Promise<void> {
  const { valid, error, order } = resolveAndValidateOrderForExport(orderData);
  if (!valid || !order) {
    alert(error || "Cannot export document: Invalid order data.");
    return;
  }

  const filename = `إذن_تسليم_${order.deliveryNoteNumber}.docx`;

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Header Title
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: "MENAREPS 2.0 - خدمات الشحن والتوصيل الدوائي",
                bold: true,
                size: 24,
                color: "1E293B"
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: "إذن تسليم واستلام رسمي",
                bold: true,
                size: 32,
                color: "2563EB"
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `رقم إذن التسليم: ${order.deliveryNoteNumber}  |  تاريخ الشحن: ${order.arabicDate}`,
                bold: true,
                size: 20,
                color: "64748B"
              })
            ]
          }),
          new Paragraph({ text: "" }),

          // Customer Info
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "■ بيانات العميل والصيدلية:", bold: true, size: 22, color: "0F172A" })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `اسم الصيدلية: ${order.pharmacyName}\n`, size: 20 }),
              new TextRun({ text: `العنوان: ${order.pharmacyAddress}\n`, size: 20 }),
              new TextRun({ text: `رقم الهاتف: ${order.pharmacyPhone}`, size: 20 })
            ]
          }),
          new Paragraph({ text: "" }),

          // Logistics Info
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "■ تفاصيل الشحن واللوجستيات:", bold: true, size: 22, color: "0F172A" })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `رقم الطلبية المرجعي: #${order.orderNumber}\n`, size: 20 }),
              new TextRun({ text: `مسؤول التوصيل: ${order.deliveryOfficerName}\n`, size: 20 }),
              new TextRun({ text: `تاريخ التوصيل المخطط: ${order.plannedDeliveryDate}`, size: 20 })
            ]
          }),
          new Paragraph({ text: "" }),

          // Products Table (NO FINANCIAL INFORMATION)
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "■ الأصناف والكميات الشحنة:", bold: true, size: 22, color: "0F172A" })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "الكمية المتبقية", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "الكمية المسلمة", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "الكمية المطلوبة", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "SKU", bold: true })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "اسم المنتج", bold: true })], alignment: AlignmentType.RIGHT })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "#", bold: true })], alignment: AlignmentType.CENTER })] })
                ]
              }),
              ...order.items.map((item, idx) => 
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${item.remainingQuantity}` })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${item.deliveredQuantity}` })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${item.quantity}` })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.sku })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.productName })], alignment: AlignmentType.RIGHT })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${idx + 1}` })], alignment: AlignmentType.CENTER })] })
                  ]
                })
              )
            ]
          }),
          new Paragraph({ text: "" }),

          // Delivery Confirmation Evidence Section
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "■ تأكيد واستلام الشحنة:", bold: true, size: 22, color: "0F172A" })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `حالة التسليم: ${order.deliveryStatus}\n`, size: 20 }),
              new TextRun({ text: `اسم المستلم: ${order.recipientName}\n`, size: 20 }),
              new TextRun({ text: `ملاحظات التسليم: ${order.deliveryNotes}\n`, size: 20 }),
              new TextRun({ text: `تاريخ الاستلام: ${order.completionDate}`, size: 20 })
            ]
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "" }),

          // Signature Area
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "توقيع واستلام الصيدلية: ____________________       توقيع مسؤول التوصيل: ____________________", bold: true, size: 20 })
            ]
          }),
          new Paragraph({ text: "" }),

          // Footer
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "تم الإعداد بواسطة MENAREPS CRM - تم الإنشاء إلكترونياً.", size: 18, color: "94A3B8" })
            ]
          })
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, filename);
}

export async function exportDeliveryNotePdf(orderData: any): Promise<void> {
  const { valid, error, order } = resolveAndValidateOrderForExport(orderData);
  if (!valid || !order) {
    alert(error || "Cannot export document: Invalid order data.");
    return;
  }

  const filename = `Delivery_Note_${order.deliveryNoteNumber}.pdf`;
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  // Header Branding
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text("MENAREPS 2.0 - Logistics & Delivery Ops", 14, 20);

  doc.setFontSize(20);
  doc.setTextColor(37, 99, 235); // blue-600
  doc.text("DELIVERY NOTE", 14, 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Delivery Note No: ${order.deliveryNoteNumber}`, 14, 34);
  doc.text(`Date: ${order.englishDate}`, 14, 39);

  // Divider Line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(14, 43, 196, 43);

  // Customer & Delivery Info Boxes
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("RECIPIENT PHARMACY", 14, 50);
  doc.text("LOGISTICS INFORMATION", 110, 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);

  // Customer
  doc.text(`Pharmacy: ${order.pharmacyName}`, 14, 56);
  doc.text(`Address: ${order.pharmacyAddress}`, 14, 61);
  doc.text(`Phone: ${order.pharmacyPhone}`, 14, 66);

  // Logistics
  doc.text(`Order Reference: #${order.orderNumber}`, 110, 56);
  doc.text(`Assigned Delivery Officer: ${order.deliveryOfficerName}`, 110, 61);
  doc.text(`Planned Delivery Date: ${order.plannedDeliveryDate}`, 110, 66);

  // Table of Products (NO FINANCIAL INFO)
  const tableHead = [["#", "Product Description", "SKU", "Ordered Qty", "Delivered Qty", "Remaining Qty"]];
  const tableRows = order.items.map((item, idx) => [
    idx + 1,
    item.productName,
    item.sku,
    item.quantity,
    item.deliveredQuantity,
    item.remainingQuantity
  ]);

  autoTable(doc, {
    startY: 73,
    head: tableHead,
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: [37, 99, 235], // blue-600
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: [30, 41, 59]
    },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 80 },
      2: { cellWidth: 30, halign: "center" },
      3: { cellWidth: 20, halign: "center" },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 20, halign: "center" }
    }
  });

  const finalY = (doc as any).lastAutoTable.finalY || 120;

  // Delivery Outcome / Evidence Section
  const evidenceY = finalY + 10;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, evidenceY, 182, 28, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("DELIVERY CONFIRMATION RECORD", 18, evidenceY + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Status: ${order.deliveryStatus}`, 18, evidenceY + 14);
  doc.text(`Recipient Name: ${order.recipientName}`, 18, evidenceY + 21);
  doc.text(`Delivered By: ${order.deliveryOfficerName}`, 110, evidenceY + 14);
  doc.text(`Completion Date: ${order.completionDate}`, 110, evidenceY + 21);

  // Signatures Box
  const sigY = evidenceY + 36;
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, sigY, 85, 25);
  doc.rect(111, sigY, 85, 25);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Recipient Signature / Stamp", 18, sigY + 6);
  doc.text("Delivery Officer Signature", 115, sigY + 6);

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Prepared by MENAREPS CRM - Generated electronically.", 14, pageHeight - 10);

  doc.save(filename);
}
