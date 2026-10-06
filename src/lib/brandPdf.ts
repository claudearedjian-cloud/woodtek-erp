// ============================================================================
// PDF branding — the house header band and footer contact block, drawn with
// the factory's own name / logo / contact details from data/appearance.json.
//
// Client-safe (jspdf + the pure branding helpers only), so the invoicing,
// client-statement and report screens can all share one implementation.
// Defaults reproduce the previous hardcoded look exactly: "WOODTEK" monogram,
// "Furniture Service Center" tagline, no contact block.
// ============================================================================

import jsPDF from "jspdf";
import {
  brandShort,
  brandTagline,
  documentBrandLine,
  contactLines,
  type AppearanceConfig,
} from "@/lib/appearance";

/**
 * Dark header band with the factory monogram (+ logo when one is set), the
 * document type and the two right-aligned lines. Returns the x position where
 * any further left-aligned text should start (shifted right by the logo).
 */
export function drawBrandBand(
  pdf: jsPDF,
  brand: AppearanceConfig,
  opts: { docType: string; rightTop: string; rightBottom?: string },
): number {
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, 210, 26, "F");
  pdf.setFillColor(245, 158, 11);
  pdf.rect(0, 26, 210, 1.2, "F");

  let textX = 14;
  if (brand.logoDataUrl) {
    try {
      const props = pdf.getImageProperties(brand.logoDataUrl);
      const h = 14;
      const w = Math.min(44, (props.width / props.height) * h);
      pdf.addImage(brand.logoDataUrl, 14, 6, w, h);
      textX = 14 + w + 6;
    } catch {
      // A logo the PDF engine cannot read must never block a document.
    }
  }

  pdf.setTextColor(245, 158, 11);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(brandShort(brand).toUpperCase(), textX, 12);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(opts.docType, textX, 20);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(200, 210, 230);
  pdf.text(opts.rightTop, 196, 12, { align: "right" });
  pdf.text(opts.rightBottom || brandTagline(brand), 196, 20, { align: "right" });
  return textX;
}

/**
 * Contact block + brand footer line at the bottom of a document. Silent when
 * no contact details are configured, so a factory that filled in nothing gets
 * exactly the document it had before.
 */
export function drawContactFooter(pdf: jsPDF, brand: AppearanceConfig, y: number): void {
  const contacts = contactLines(brand);
  if (contacts.length > 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(contacts.join("  ·  "), 14, y);
    pdf.setFontSize(7.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text(documentBrandLine(brand), 14, y + 5);
    return;
  }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(148, 163, 184);
  pdf.text(documentBrandLine(brand), 14, y);
}
