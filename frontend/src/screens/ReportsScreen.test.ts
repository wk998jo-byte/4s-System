import { describe, it, expect } from "vitest";
import { buildDailyReports, buildWeeklyReports, buildMonthlyReports, generatedReportCount } from "./ReportsScreen";
import type { ReportPacket } from "../api/scc";

const packet = (kind: string, status: string): ReportPacket => ({
  id: `${kind}-real`, kind, scope: kind === "daily" ? "All projects" : "Jafurah",
  a: "2026-10-01", b: "2026-10-31", label: "Test period", status,
});

describe("report lists use persisted packets, not browser calendars", () => {
  it("has zero daily, weekly and monthly reports for zero saved packets", () => {
    expect(buildDailyReports([], [])).toEqual([]);
    expect(buildWeeklyReports([], [], ["Jafurah"])).toEqual([]);
    expect(buildMonthlyReports([], [], ["Jafurah"])).toEqual([]);
  });
  it("does not promote source cases into generated reports without a saved packet", () => {
    expect(buildDailyReports([{ date: "2026-10-01" } as never], [])).toEqual([]);
  });
  it("keeps retained empty periods out of completed report counters", () => {
    const packets = ["daily", "weekly", "monthly"].map((k) => ({ ...packet(k, "No source data"), generated_at: "2026-11-01" }));
    const rows = [
      ...buildDailyReports([], packets),
      ...buildWeeklyReports(packets, [], ["Jafurah"]),
      ...buildMonthlyReports(packets, [], ["Jafurah"]),
    ];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "No source data")).toBe(true);
    expect(generatedReportCount(rows)).toBe(0);
  });
  it("distinguishes scheduled/compiling packets from generated packets", () => {
    const rows = buildDailyReports([], [packet("daily", "Scheduled")]);
    expect(rows[0].compiling).toBe(true);
    expect(rows[0].status).toBe("Scheduled");
    expect(generatedReportCount(rows)).toBe(0);
    const generated = buildDailyReports([], [{ ...packet("daily", "Generated"), generated_at: "2026-10-02" }]);
    expect(generatedReportCount(generated)).toBe(1);
  });
  it("preserves signature and historical issue evidence", () => {
    const signed = { by: "Test HSE", signature: "test.png", at: "2026-11-01" };
    const monthly = { ...packet("monthly", "Signed"), signed, pm_signed: signed };
    expect(buildMonthlyReports([monthly], [], ["Jafurah"])[0].status).toBe("Signed");
    const issued = { ...monthly, status: "Issued", issued: { by: "Test", to: "Test", at: "2026-11-01" } };
    const row = buildMonthlyReports([issued], [], ["Jafurah"])[0];
    expect(row.status).toBe("Issued");
    expect(row.packet?.issued).toEqual(issued.issued);
    expect(generatedReportCount([row])).toBe(1);
  });
  it("respects scoped project lists without fabricating other projects", () => {
    expect(buildWeeklyReports([packet("weekly", "Generated")], [], ["Yanbu"])).toEqual([]);
  });
});
