import bqLogo from "../assets/bq-logo.png";

/** Same stylesheet the on-screen PDF / print path uses. */
export const REPORT_PRINT_CSS = `
@page{margin:14mm}
body{font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a;margin:20px;background:#fff}
h1{font-size:26px;margin:0;font-weight:800}
h3, .report-sec{font-size:13px;margin:20px 0 8px;color:#C8102E;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #C8102E;padding-bottom:4px;font-weight:800}
.sub{color:#666;font-size:12.5px;margin:6px 0 0}
.head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:0;padding-bottom:12px;border-bottom:2px solid #C8102E}
.report-doc-brand{display:flex;align-items:flex-start;gap:14px;min-width:0}
.report-doc-logo{height:52px;width:auto;display:block;object-fit:contain}
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
.report-signoff{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}
.report-signoff-card{border:1px solid #ddd;border-radius:12px;padding:14px 16px;min-height:108px}
.report-signoff-card > span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#888;margin-bottom:10px}
.report-signoff-card p{margin:0 0 4px;font-size:13.5px}
.report-signoff-card b{display:block;font-size:15px;font-weight:800;line-height:1.25}
.report-signoff-card b.muted-strong{color:#555;font-weight:700}
.report-signoff-card small{display:block;margin-top:8px;color:#888;font-size:12px}
.report-signature-img{display:block;max-width:220px;max-height:72px;width:auto;height:auto;object-fit:contain;margin:8px 0 4px;background:#fff}
.report-truncation-note{margin:8px 0 0;font-size:11.5px;color:#888;line-height:1.4}
.report-ai-cats{list-style:none;margin:0 0 16px;padding:0}
.report-ai-cats li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #eee;font-size:13px}
`;

function absoluteLogoSrc() {
  if (bqLogo.startsWith("http")) return bqLogo;
  return `${window.location.origin}${bqLogo.startsWith("/") ? "" : "/"}${bqLogo}`;
}

/** Build the same standalone HTML document used by the report PDF download/print path. */
export function buildReportPrintHtml(root: HTMLElement, reportId: string): string {
  const logoSrc = absoluteLogoSrc();
  const bodyHtml = root.innerHTML
    .replace(/src="[^"]*bq-logo[^"]*"|src="[^"]*bq_logo[^"]*"/gi, `src="${logoSrc}"`)
    .replace(
      new RegExp(`src="${bqLogo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"),
      `src="${logoSrc}"`,
    );
  const absoluteBody = bodyHtml.replace(
    /src="(\/assets\/[^"]+)"/g,
    `src="${window.location.origin}$1"`,
  );
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
