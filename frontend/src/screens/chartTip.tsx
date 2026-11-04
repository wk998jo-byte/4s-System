import type { CSSProperties } from "react";

export type ChartTipData = {
  x: number;
  y: number;
  title: string;
  rows: Array<{ color: string; text: string }>;
  footer?: string;
  place?: "top" | "left" | "right" | "bottom";
};

export function tipFromEvent(
  e: { clientX: number; clientY: number },
  host: HTMLElement | null,
  data: Omit<ChartTipData, "x" | "y">,
): ChartTipData | null {
  if (!host) return null;
  const r = host.getBoundingClientRect();
  return {
    ...data,
    x: e.clientX - r.left,
    y: e.clientY - r.top,
  };
}

export function ChartTip({ tip }: { tip: ChartTipData | null }) {
  if (!tip) return null;
  const style = { left: tip.x, top: tip.y } as CSSProperties;
  return (
    <div
      className={`v1-chart-tip place-${tip.place || "top"}`}
      style={style}
      role="tooltip"
    >
      <b>{tip.title}</b>
      {tip.rows.map((row, i) => (
        <div className="row" key={`${row.text}-${i}`}>
          <i style={{ background: row.color }} />
          <span>{row.text}</span>
        </div>
      ))}
      {tip.footer ? <div className="foot">{tip.footer}</div> : null}
    </div>
  );
}
