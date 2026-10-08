// ============================================================================
// Polyboard Part Labels PDF Generator
// Generates industrial workshop labels (100mm x 50mm or standard A4 sheet)
// with Code-128 / QR barcodes, Biesse Rover A CIX program names, dimensions,
// and 4-sided edgebanding tape indicators.
// ============================================================================

import jsPDF from "jspdf";
import QRCode from "qrcode";
import type { PolyboardCabinet, PolyboardPart } from "./polyboard";

export interface LabelOptions {
  companyName?: string;
  projectName?: string;
}

/**
 * Builds printable HTML labels for direct thermal label printer (100mm x 50mm)
 * or laser sheets.
 */
export async function generatePartLabelsHtml(
  cabinet: PolyboardCabinet,
  options: LabelOptions = {}
): Promise<string> {
  const parts = cabinet.parts;
  const company = options.companyName || "WoodTek Manufacturing";
  const project = options.projectName || "Polyboard Project";

  // Pre-generate QR / Barcode data URLs
  const barcodeUrls: Record<string, string> = {};
  for (const part of parts) {
    try {
      const url = await QRCode.toDataURL(part.barcode, {
        width: 140,
        margin: 1,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      barcodeUrls[part.id] = url;
    } catch {
      barcodeUrls[part.id] = "";
    }
  }

  const labelCards = parts
    .map((part) => {
      const qrSrc = barcodeUrls[part.id];
      const eb = part.edgeBanding || {
        top: "1.0mm",
        bottom: "1.0mm",
        left: "0.4mm",
        right: "0.4mm",
      };

      return `
      <div class="label-card">
        <div class="label-header">
          <div class="brand-title">${company}</div>
          <div class="machine-tag">BIESSE ROVER A</div>
        </div>

        <div class="label-main">
          <div class="info-block">
            <div class="project-name">${project}</div>
            <div class="cabinet-name">${part.cabinetName}</div>
            <div class="part-title">${part.name}</div>
            
            <div class="dim-badge">
              <strong>${part.length}</strong> × <strong>${part.width}</strong> × <strong>${part.thickness}</strong> mm
            </div>

            <div class="mat-line">
              <span class="label-tag">MAT:</span> <span>${part.material}</span>
            </div>

            <div class="cix-prog">
              <span class="label-tag">CIX:</span> <code>${part.cixFilename || part.barcode + ".cix"}</code>
            </div>
          </div>

          <div class="barcode-block">
            ${qrSrc ? `<img src="${qrSrc}" class="barcode-img" alt="${part.barcode}" />` : ""}
            <div class="barcode-text">${part.barcode}</div>
          </div>
        </div>

        <div class="edge-band-grid">
          <div class="edge-item"><span class="edge-dir">T:</span> ${eb.top || "None"}</div>
          <div class="edge-item"><span class="edge-dir">B:</span> ${eb.bottom || "None"}</div>
          <div class="edge-item"><span class="edge-dir">L:</span> ${eb.left || "None"}</div>
          <div class="edge-item"><span class="edge-dir">R:</span> ${eb.right || "None"}</div>
        </div>
      </div>
      `;
    })
    .join("\n");

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Polyboard Part Labels - ${cabinet.name}</title>
    <style>
      @page {
        size: 100mm 55mm;
        margin: 0;
      }
      body {
        margin: 0;
        padding: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      .label-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .label-card {
        width: 95mm;
        height: 50mm;
        border: 1.5px solid #0f172a;
        border-radius: 6px;
        padding: 5px 8px;
        box-sizing: border-box;
        page-break-after: always;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        background: #ffffff;
      }
      .label-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 2px;
      }
      .brand-title {
        font-size: 8px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #475569;
      }
      .machine-tag {
        font-size: 8px;
        font-weight: 900;
        color: #0284c7;
        background: #e0f2fe;
        padding: 1px 4px;
        border-radius: 3px;
      }
      .label-main {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 2px 0;
      }
      .info-block {
        flex: 1;
        overflow: hidden;
      }
      .project-name {
        font-size: 8px;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cabinet-name {
        font-size: 9px;
        font-weight: 700;
        color: #334155;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .part-title {
        font-size: 13px;
        font-weight: 900;
        color: #0f172a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dim-badge {
        font-size: 11px;
        font-weight: 700;
        font-family: monospace;
        margin-top: 1px;
      }
      .mat-line {
        font-size: 8px;
        color: #475569;
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cix-prog {
        font-size: 8px;
        color: #0f172a;
        margin-top: 1px;
      }
      .cix-prog code {
        font-family: monospace;
        font-weight: 700;
        color: #0284c7;
      }
      .label-tag {
        font-weight: 800;
        color: #64748b;
      }
      .barcode-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-left: 6px;
      }
      .barcode-img {
        width: 60px;
        height: 60px;
      }
      .barcode-text {
        font-size: 8px;
        font-family: monospace;
        font-weight: 700;
        color: #0f172a;
        margin-top: -2px;
      }
      .edge-band-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 2px;
        background: #f1f5f9;
        padding: 3px;
        border-radius: 4px;
        border: 1px solid #e2e8f0;
        font-size: 7.5px;
      }
      .edge-item {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .edge-dir {
        font-weight: 800;
        color: #0284c7;
      }
      @media print {
        body {
          background: transparent;
          padding: 0;
        }
        .label-card {
          margin: 0;
          border: 1px solid #000;
        }
      }
    </style>
  </head>
  <body>
    <div class="label-container">
      ${labelCards}
    </div>
    <script>
      window.onload = function() {
        setTimeout(function() {
          window.print();
        }, 300);
      };
    </script>
  </body>
  </html>
  `;
}
