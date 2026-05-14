import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import type { Invoice } from "@/features/business/types/business";
import {
  BUSINESS,
  BUSINESS_BANK_ACCOUNT,
  BUSINESS_GST_NUMBER,
  BUSINESS_PAYMENT_TERMS_DAYS,
} from "@/shared/lib/business-identity";
import { formatDateShort } from "@/shared/lib/date-format";

const BRAND = rgb(12 / 255, 10 / 255, 62 / 255); // russian-violet #0c0a3e
const DARK = rgb(0.15, 0.15, 0.15);
const MID = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.75, 0.75, 0.75);
const ROW_ALT = rgb(0.97, 0.97, 0.97);
const WHITE = rgb(1, 1, 1);
const PAID_COLOR = rgb(0.1, 0.55, 0.25);
const OVERDUE_COLOR = rgb(0.78, 0.16, 0.16);

const MARGIN = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * Formats a number as a NZD dollar string.
 * @param n - Amount to format
 * @returns Formatted string like "$12.50"
 */
function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Generates a branded A4 PDF for the given invoice using pdf-lib.
 * The document-header-800x270.png is used as the full-width header band.
 * profile.svg is rasterized via sharp and placed in the footer.
 * @param invoice - The invoice record to render.
 * @returns PDF content as a Buffer.
 */
export async function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // --- Embed images ---
  const headerBytes = await fs.readFile(
    path.join(process.cwd(), "public/assets/document-header-800x270.png"),
  );
  const headerImg = await pdfDoc.embedPng(headerBytes);

  const logoBuffer = await sharp(path.join(process.cwd(), "public/source/profile.svg"))
    .resize(110)
    .png()
    .toBuffer();
  const logoImg = await pdfDoc.embedPng(logoBuffer);

  // --- Status watermark (PAID green / OVERDUE red), drawn first so it's underneath ---
  const dueDate = new Date(invoice.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = invoice.status === "SENT" && dueDate < today;
  const watermarkText = invoice.status === "PAID" ? "PAID" : isOverdue ? "OVERDUE" : null;
  if (watermarkText) {
    const wmColor = invoice.status === "PAID" ? PAID_COLOR : OVERDUE_COLOR;
    const wmSize = 140;
    const wmWidth = bold.widthOfTextAtSize(watermarkText, wmSize);
    page.drawText(watermarkText, {
      x: PAGE_W / 2 - (wmWidth / 2) * 0.87, // adjust for rotation pivot
      y: PAGE_H / 2 - 80,
      size: wmSize,
      font: bold,
      color: wmColor,
      opacity: 0.12,
      rotate: degrees(-25),
    });
  }

  // --- Header band (left-aligned letterhead, ~65% of content width) ---
  // Matches InvoiceBuilderView's w-2/3 preview.
  const HEADER_WIDTH_RATIO = 0.65;
  const hW = CONTENT_W * HEADER_WIDTH_RATIO;
  const hScale = hW / headerImg.width;
  const hH = headerImg.height * hScale;
  page.drawImage(headerImg, { x: MARGIN, y: PAGE_H - hH, width: hW, height: hH });

  let y = PAGE_H - hH - 18;

  // --- Invoice number + status block (right-aligned) ---
  const statusColor =
    invoice.status === "PAID" ? PAID_COLOR : invoice.status === "SENT" ? rgb(0.1, 0.35, 0.75) : MID;

  const rightX = MARGIN + CONTENT_W;

  // NZ IRD requires "Tax invoice" wording when GST-registered. GST# env presence = registered.
  const invTitle = BUSINESS_GST_NUMBER ? "TAX INVOICE" : "INVOICE";
  page.drawText(invTitle, {
    x: rightX - bold.widthOfTextAtSize(invTitle, 18),
    y,
    size: 18,
    font: bold,
    color: BRAND,
  });
  y -= 16;

  page.drawText(invoice.number, {
    x: rightX - font.widthOfTextAtSize(invoice.number, 10),
    y,
    size: 10,
    font,
    color: DARK,
  });
  y -= 13;

  page.drawText(invoice.status, {
    x: rightX - bold.widthOfTextAtSize(invoice.status, 9),
    y,
    size: 9,
    font: bold,
    color: statusColor,
  });

  // GST# below the status pill for IRD validation.
  if (BUSINESS_GST_NUMBER) {
    y -= 13;
    const gstLine = `GST# ${BUSINESS_GST_NUMBER}`;
    page.drawText(gstLine, {
      x: rightX - font.widthOfTextAtSize(gstLine, 8.5),
      y,
      size: 8.5,
      font,
      color: MID,
    });
  }

  // --- Bill to + dates block (2 cols) ---
  const infoY = PAGE_H - hH - 18;
  page.drawText("Bill to", {
    x: MARGIN,
    y: infoY,
    size: 7.5,
    font: bold,
    color: LIGHT,
  });
  page.drawText(invoice.clientName, {
    x: MARGIN,
    y: infoY - 13,
    size: 10,
    font: bold,
    color: DARK,
  });
  page.drawText(invoice.clientEmail, {
    x: MARGIN,
    y: infoY - 25,
    size: 9,
    font,
    color: MID,
  });

  /**
   * Draws a right-aligned label/value pair in the dates column at the given vertical offset.
   * @param label - Field label text
   * @param val - Field value text
   * @param dy - Vertical offset from the base infoY position
   */
  const dateLabel = (label: string, val: string, dy: number): void => {
    page.drawText(label, {
      x: MARGIN + CONTENT_W * 0.55,
      y: infoY + dy,
      size: 8,
      font,
      color: MID,
    });
    page.drawText(val, {
      x: MARGIN + CONTENT_W * 0.72,
      y: infoY + dy,
      size: 8,
      font: bold,
      color: DARK,
    });
  };
  dateLabel("Issued:", formatDateShort(invoice.issueDate), 0);
  dateLabel("Due:", formatDateShort(invoice.dueDate), -13);

  y = infoY - 40;

  // --- Separator ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 2;

  // --- Table header ---
  const COL = {
    desc: MARGIN,
    qty: MARGIN + CONTENT_W * 0.55,
    price: MARGIN + CONTENT_W * 0.68,
    total: MARGIN + CONTENT_W * 0.82,
  };
  const ROW_H = 20;

  page.drawRectangle({
    x: MARGIN,
    y: y - ROW_H,
    width: CONTENT_W,
    height: ROW_H,
    color: BRAND,
  });
  const headers = ["Description", "Qty", "Unit price", "Total"];
  const cols = [COL.desc, COL.qty, COL.price, COL.total];
  headers.forEach((h, i) => {
    const x =
      i === 0
        ? cols[i] + 4
        : cols[i + 1]
          ? cols[i + 1] - bold.widthOfTextAtSize(h, 8) - 4
          : MARGIN + CONTENT_W - bold.widthOfTextAtSize(h, 8) - 4;
    page.drawText(h, { x, y: y - ROW_H + 6, size: 8, font: bold, color: WHITE });
  });
  y -= ROW_H;

  // --- Line item rows ---
  invoice.lineItems.forEach((item, idx) => {
    const bg = idx % 2 === 1 ? ROW_ALT : WHITE;
    page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: CONTENT_W, height: ROW_H, color: bg });

    const descMaxW = COL.qty - COL.desc - 6;
    let desc = item.description;
    while (desc.length > 2 && font.widthOfTextAtSize(desc, 8.5) > descMaxW) {
      desc = desc.slice(0, -1);
    }
    if (desc !== item.description) desc = desc.slice(0, -1) + "…";

    page.drawText(desc, { x: COL.desc + 4, y: y - ROW_H + 6, size: 8.5, font, color: DARK });

    const qtyStr = String(item.qty);
    page.drawText(qtyStr, {
      x: COL.price - font.widthOfTextAtSize(qtyStr, 8.5) - 4,
      y: y - ROW_H + 6,
      size: 8.5,
      font,
      color: DARK,
    });

    const priceStr = fmt(item.unitPrice);
    page.drawText(priceStr, {
      x: COL.total - font.widthOfTextAtSize(priceStr, 8.5) - 4,
      y: y - ROW_H + 6,
      size: 8.5,
      font,
      color: DARK,
    });

    const totalStr = fmt(item.lineTotal);
    page.drawText(totalStr, {
      x: MARGIN + CONTENT_W - font.widthOfTextAtSize(totalStr, 8.5) - 4,
      y: y - ROW_H + 6,
      size: 8.5,
      font: bold,
      color: DARK,
    });

    y -= ROW_H;
  });

  // --- Bottom table border ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 16;

  // --- Totals block (right-aligned) ---
  const totalsLabelX = MARGIN + CONTENT_W * 0.6;
  const totalsValueX = MARGIN + CONTENT_W;

  /**
   * Draws a totals row with label on the left and right-aligned value.
   * @param label - Row label (e.g. "Subtotal")
   * @param value - Formatted value string (e.g. "$120.00")
   * @param isBold - Whether to render in bold brand colour (used for the final total)
   */
  const drawTotalRow = (label: string, value: string, isBold = false): void => {
    const f = isBold ? bold : font;
    const c = isBold ? BRAND : MID;
    page.drawText(label, { x: totalsLabelX, y, size: 9, font: f, color: c });
    page.drawText(value, {
      x: totalsValueX - f.widthOfTextAtSize(value, isBold ? 11 : 9),
      y,
      size: isBold ? 11 : 9,
      font: f,
      color: isBold ? BRAND : DARK,
    });
    y -= isBold ? 18 : 14;
  };

  drawTotalRow("Subtotal", fmt(invoice.subtotal));
  // Promo discount line (snapshot fields keep historical totals stable).
  if (invoice.promoDiscount && invoice.promoDiscount > 0) {
    const label = invoice.promoTitle ? `Promo: ${invoice.promoTitle}` : "Promo discount";
    drawTotalRow(label, `-${fmt(invoice.promoDiscount)}`);
  }
  if (invoice.gst) drawTotalRow("GST (15%)", fmt(invoice.gstAmount));
  page.drawLine({
    start: { x: totalsLabelX, y: y + 6 },
    end: { x: totalsValueX, y: y + 6 },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 4;
  drawTotalRow("Total", fmt(invoice.total), true);

  y -= 12;

  // --- Bank transfer footer ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 14;
  page.drawText("Bank transfer", { x: MARGIN, y, size: 8, font: bold, color: DARK });
  y -= 12;
  page.drawText(`Payee: ${BUSINESS.name}`, {
    x: MARGIN,
    y,
    size: 8,
    font,
    color: MID,
  });
  y -= 11;
  page.drawText(`Account: ${BUSINESS_BANK_ACCOUNT}`, {
    x: MARGIN,
    y,
    size: 8,
    font,
    color: MID,
  });
  y -= 11;
  page.drawText(`Reference: ${invoice.number}`, { x: MARGIN, y, size: 8, font, color: MID });
  y -= 11;
  page.drawText(
    `Due within ${BUSINESS_PAYMENT_TERMS_DAYS} days of issue (by ${formatDateShort(invoice.dueDate)}).`,
    {
      x: MARGIN,
      y,
      size: 8,
      font,
      color: MID,
    },
  );

  // --- Notes ---
  if (invoice.notes) {
    y -= 14;
    page.drawText(invoice.notes, { x: MARGIN, y, size: 8, font, color: MID, maxWidth: CONTENT_W });
  }

  // --- Footer: logo (left) + contact strip (right) ---
  const logoScale = 70 / logoImg.width;
  const logoW = logoImg.width * logoScale;
  const logoH = logoImg.height * logoScale;
  page.drawImage(logoImg, { x: MARGIN, y: MARGIN, width: logoW, height: logoH });

  // Right-aligned contact strip - company + phone/email/website.
  const footerY = MARGIN + logoH;
  page.drawText(BUSINESS.company, {
    x: rightX - bold.widthOfTextAtSize(BUSINESS.company, 9),
    y: footerY - 9,
    size: 9,
    font: bold,
    color: BRAND,
  });
  const contactLine = `${BUSINESS.phone}  ·  ${BUSINESS.email}  ·  ${BUSINESS.website}`;
  page.drawText(contactLine, {
    x: rightX - font.widthOfTextAtSize(contactLine, 7.5),
    y: footerY - 22,
    size: 7.5,
    font,
    color: MID,
  });
  page.drawText("Thanks for your business.", {
    x: rightX - font.widthOfTextAtSize("Thanks for your business.", 7.5),
    y: footerY - 33,
    size: 7.5,
    font,
    color: LIGHT,
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

/**
 * Extracts the fiscal year code from an invoice number (e.g. "TTP-2627-0042" -> "2627").
 * Falls back to deriving the current fiscal year if the number doesn't match.
 * @param invoiceNumber - Invoice number string.
 * @returns Two-digit fiscal year code (e.g. "2627").
 */
export function extractYearCode(invoiceNumber: string): string {
  const m = invoiceNumber.match(/^[A-Z]+-(\d{4,6})-/);
  if (m) return m[1];
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return String(fy) + String(fy + 1).slice(2);
}
