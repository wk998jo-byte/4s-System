import bqLogo from "../assets/bq-logo.png";

/** Same stylesheet the on-screen PDF / print path uses. */
export const REPORT_PRINT_CSS = `
@page{
  size:A4;
  margin:14mm 12mm 18mm 12mm;
  @bottom-center{
    content:"Page " counter(page) " | " counter(pages);
    font-family:Segoe UI,Arial,sans-serif;
    font-size:10px;
    color:#5B9BD5;
  }
}
html,body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
body{font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a;margin:0;background:#fff}
.report-cover-band,.report-obs-meta th,.report-obs-meta td.report-status-closed,.report-cover-sign-table th,.report-wx-monthly th,.kpi{
  -webkit-print-color-adjust:exact!important;
  print-color-adjust:exact!important;
  color-adjust:exact!important;
}
h1{font-size:26px;margin:0;font-weight:800}
h3, .report-sec{font-size:13px;margin:20px 0 8px;color:#C8102E;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #C8102E;padding-bottom:4px;font-weight:800}
.sub{color:#666;font-size:12.5px;margin:6px 0 0}
.head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:0;padding-bottom:12px;border-bottom:2px solid #C8102E}
.report-doc-brand{display:flex;align-items:flex-start;gap:14px;min-width:0}
.report-doc-logo{height:52px;width:auto;display:block;object-fit:contain}
.report-doc-logo.sm{height:40px}
.report-doc-meta{text-align:right;font-size:11.5px;color:#888;line-height:1.55;font-family:ui-monospace,Consolas,monospace}
.report-meta-band{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;margin:0 0 18px;padding:12px 0;border-bottom:2px solid #C8102E;font-size:12px;color:#888}
.report-meta-band span{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.report-meta-band b{display:block;margin-top:3px;color:#111;font-size:13.5px;font-weight:700}
.kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0 18px}
.kpi{border:1px solid #ddd;border-radius:10px;padding:12px 14px;background:#fff;text-align:left}
.kpi span{display:block;font-size:11px;color:#888;font-weight:600}
.kpi b{display:block;margin-top:6px;font-size:28px;font-weight:800;line-height:1}
.report-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0 16px}
.report-table th{background:transparent;color:#888;text-align:left;padding:8px 6px;font-size:11px;font-weight:700;font-family:ui-monospace,Consolas,monospace;border-bottom:1px solid #ddd;text-transform:none;letter-spacing:0}
.report-table td{padding:9px 6px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.report-table .num,.report-table th.num{text-align:right;font-family:ui-monospace,Consolas,monospace;color:#555}
.report-table td:first-child{color:#111;font-family:Segoe UI,Arial,sans-serif}
.mono{font-family:ui-monospace,Consolas,monospace}
.report-signature-img{display:block;max-width:180px;max-height:64px;width:auto;height:auto;object-fit:contain;margin:6px 0 4px;background:#fff}
.report-truncation-note{margin:8px 0 0;font-size:11.5px;color:#888;line-height:1.4}
.report-ai-cats{list-style:none;margin:0 0 16px;padding:0}
.report-ai-cats li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #eee;font-size:13px}
.muted{color:#888}

.report-cover{display:flex;flex-direction:column;min-height:250mm;page-break-after:always;break-after:page}
.report-cover-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}
.report-cover-company{font-size:12px;font-weight:700;letter-spacing:.04em;color:#333}
.report-cover-titles{text-align:center;margin:8px 0 18px}
.report-cover-titles h1,.report-cover-titles h2{margin:0 0 6px;font-size:18px;font-weight:800;text-decoration:underline;text-underline-offset:3px}
.report-cover-titles h3{margin:10px 0 4px;font-size:16px;font-weight:700}
.report-cover-titles h4{margin:0;font-size:15px;font-weight:700}
.report-cover-frame{flex:1;display:flex;flex-direction:column;border:1.5px solid #333;min-height:0}
.report-cover-band{background:#C8102E;color:#fff;text-align:center;font-weight:800;font-size:15px;padding:10px 12px;border-bottom:1.5px solid #333}
.report-cover-body{flex:1;padding:18px 16px;min-height:120px}
.report-cover-hint{margin:0 0 10px;font-size:13px;color:#555}
.report-cover-meta-line{margin:0 0 4px;font-size:12px;color:#666}
.report-cover-sign-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:auto}
.report-cover-sign-table th,.report-cover-sign-table td{border-top:1px solid #333;border-right:1px solid #333;padding:8px 10px;vertical-align:top}
.report-cover-sign-table th:last-child,.report-cover-sign-table td:last-child{border-right:0}
.report-cover-sign-table th{background:#f3f3f3;font-weight:700;white-space:nowrap;width:1%}
.report-cover-sig-slot{min-height:56px}
.report-cover-sig-slot span{display:block;font-weight:700}
.report-cover-sig-slot small{display:block;margin-top:4px;color:#666;font-size:11px}
.report-cover-docno{text-align:left;font-weight:700;background:#fafafa}

.report-section-page{page-break-before:always;break-before:page}
.report-obs-page{page-break-before:always;break-before:page;padding-top:4px}
.report-obs-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #ddd}
.report-obs-meta{width:100%;border-collapse:collapse;margin:0 0 12px;font-size:12px}
.report-obs-meta th{background:#C8102E;color:#fff;padding:8px 6px;text-align:left;font-weight:700;border:1px solid #9e0c24}
.report-obs-meta td{padding:9px 6px;border:1px solid #e2c9ce;vertical-align:top}
.report-obs-meta td.report-status-closed{background:#2e7d32;color:#fff;font-weight:700;text-align:center}
.report-obs-case{display:flex;justify-content:space-between;gap:12px;margin:0 0 10px;font-size:12.5px;color:#444}
.report-obs-photo{margin:0 0 14px;border:1px solid #ddd;background:#f7f7f7;text-align:center;padding:10px}
.report-obs-photo img{display:block;width:100%;max-width:100%;max-height:520px;height:auto;object-fit:contain;margin:0 auto}
.report-obs-details{border:1.5px solid #333;padding:12px 14px}
.report-obs-details h4{margin:0 0 8px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.03em}
.report-obs-details p{margin:0 0 8px;font-size:13px;line-height:1.45}
.report-obs-details p:last-child{margin-bottom:0}
.report-wx-monthly th{background:#1d1c1f;color:#fff;border-bottom-color:#1d1c1f;padding:10px 8px}
`;

function absoluteLogoSrc() {
  if (bqLogo.startsWith("http")) return bqLogo;
  return `${window.location.origin}${bqLogo.startsWith("/") ? "" : "/"}${bqLogo}`;
}

function absoluteApiOrigin() {
  // Prefer same-origin Vite proxy; fall back to local API when assets are absolute.
  return window.location.origin.includes("5173")
    ? "http://127.0.0.1:8000"
    : window.location.origin;
}

/** Build the same standalone HTML document used by the report PDF download/print path. */
export function buildReportPrintHtml(root: HTMLElement, reportId: string): string {
  const logoSrc = absoluteLogoSrc();
  const apiOrigin = absoluteApiOrigin();
  const bodyHtml = root.innerHTML
    .replace(/src="[^"]*bq-logo[^"]*"|src="[^"]*bq_logo[^"]*"/gi, `src="${logoSrc}"`)
    .replace(
      new RegExp(`src="${bqLogo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"),
      `src="${logoSrc}"`,
    );
  const absoluteBody = bodyHtml
    .replace(/src="(\/assets\/[^"]+)"/g, `src="${window.location.origin}$1"`)
    .replace(/src="(\/uploads\/[^"]+)"/g, `src="${apiOrigin}$1"`);
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${reportId}</title>
      <style>${REPORT_PRINT_CSS}</style></head><body>${absoluteBody}</body></html>`;
}

/** Open the browser print dialog for the report (View → PDF). */
export function printReportRoot(root: HTMLElement, reportId: string) {
  const html = buildReportPrintHtml(root, reportId);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("title", `Print ${reportId}`);
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  const cleanup = () => {
    URL.revokeObjectURL(url);
    frame.remove();
  };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } finally {
        window.setTimeout(cleanup, 1500);
      }
    }, 100);
  };
  frame.src = url;
  document.body.appendChild(frame);
}
