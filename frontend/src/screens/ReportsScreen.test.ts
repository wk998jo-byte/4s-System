import { describe, it, expect } from "vitest";
import { buildDailyReports, buildWeeklyReports, buildMonthlyReports, generatedReportCount } from "./ReportsScreen";
import type { ReportPacket } from "../api/scc";

const packet = (kind: string, status: string): ReportPacket => ({
  id: `${kind}-real`, kind, scope: kind === "daily" ? "All projects" : "Jafurah",
  a: "2026-10-01", b: kind === "daily" ? "2026-10-01" : "2026-10-31", label: "Test period", status,
});

describe("report lists use persisted packets, not browser calendars", () => {
  it("has zero daily, weekly and monthly reports for zero saved packets", () => {
    expect(buildDailyReports([], [], ["Jafurah", "All projects"])).toEqual([]);
    expect(buildWeeklyReports([], [], ["Jafurah"])).toEqual([]);
    expect(buildMonthlyReports([], [], ["Jafurah"])).toEqual([]);
  });
  it("does not promote source cases into generated reports without a saved packet", () => {
    expect(buildDailyReports([], [{ date: "2026-10-01" } as never], ["All projects"])).toEqual([]);
  });
  it("keeps retained empty periods out of completed report counters", () => {
    const packets = ["daily", "weekly", "monthly"].map((k) => ({ ...packet(k, "No source data"), generated_at: "2026-11-01" }));
    const rows = [
      ...buildDailyReports(packets, [], ["All projects"]),
      ...buildWeeklyReports(packets, [], ["Jafurah"]),
      ...buildMonthlyReports(packets, [], ["Jafurah"]),
    ];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "No source data")).toBe(true);
    expect(generatedReportCount(rows)).toBe(0);
  });
  it("distinguishes scheduled/compiling packets from generated packets", () => {
    const rows = buildDailyReports([packet("daily", "Scheduled")], [], ["All projects"]);
    expect(rows[0].compiling).toBe(true);
    expect(rows[0].status).toBe("Scheduled");
    expect(generatedReportCount(rows)).toBe(0);
    const generated = buildDailyReports(
      [{ ...packet("daily", "Generated"), generated_at: "2026-10-02" }],
      [],
      ["All projects"],
    );
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
  it("weekly co-sign tracks HSE then Admin like monthly HSE/PM", () => {
    const hse = { by: "Test HSE", signature: "hse.png", at: "2026-11-01" };
    const admin = { by: "Test Admin", signature: "admin.png", at: "2026-11-02" };
    const awaiting = { ...packet("weekly", "Awaiting signatures"), scope: "Yanbu" };
    expect(buildWeeklyReports([awaiting], [], ["Yanbu"])[0].status).toBe("Awaiting signatures");
    const hseOnly = { ...awaiting, signed: hse, status: "Awaiting Admin signature" };
    expect(buildWeeklyReports([hseOnly], [], ["Yanbu"])[0].status).toBe(
      "Awaiting Admin signature",
    );
    const both = { ...hseOnly, admin_signed: admin, status: "Signed" };
    expect(buildWeeklyReports([both], [], ["Yanbu"])[0].status).toBe("Signed");
    expect(generatedReportCount([buildWeeklyReports([both], [], ["Yanbu"])[0]])).toBe(1);
  });
  it("respects scoped project lists without fabricating other projects", () => {
    expect(buildWeeklyReports([packet("weekly", "Generated")], [], ["Yanbu"])).toEqual([]);
    expect(buildDailyReports([packet("daily", "Generated")], [], ["Yanbu"])).toEqual([]);
  });
  it("lists All-projects packs when authorized and per-project packs separately", () => {
    const packets: ReportPacket[] = [
      { ...packet("daily", "Generated"), id: "DR-ALL", scope: "All projects", generated_at: "2026-10-02" },
      { ...packet("daily", "Generated"), id: "DR-YAN", scope: "Yanbu", generated_at: "2026-10-02" },
      { ...packet("daily", "Generated"), id: "DR-MGS", scope: "MGS", generated_at: "2026-10-02" },
      { ...packet("weekly", "Generated"), id: "WR-ALL", scope: "All projects" },
      { ...packet("weekly", "Generated"), id: "WR-YAN", scope: "Yanbu" },
      { ...packet("weekly", "Generated"), id: "WR-MGS", scope: "MGS" },
      { ...packet("monthly", "Generated"), id: "MR-ALL", scope: "All projects" },
      { ...packet("monthly", "Generated"), id: "MR-MGS", scope: "MGS" },
    ];
    const daily = buildDailyReports(packets, [], ["Yanbu", "All projects"]);
    expect(daily.map((r) => r.scope).sort()).toEqual(["All projects", "Yanbu"]);
    const weekly = buildWeeklyReports(packets, [], ["Yanbu", "All projects"]);
    expect(weekly.map((r) => r.scope).sort()).toEqual(["All projects", "Yanbu"]);
    expect(buildDailyReports(packets, [], ["Yanbu"]).map((r) => r.scope)).toEqual(["Yanbu"]);
  });
  it("MGS-only access never sees All projects packs", () => {
    const packets: ReportPacket[] = [
      { ...packet("daily", "Generated"), id: "DR-ALL", scope: "All projects", generated_at: "2026-10-02" },
      { ...packet("daily", "Generated"), id: "DR-MGS", scope: "MGS", generated_at: "2026-10-02" },
      { ...packet("weekly", "Generated"), id: "WR-ALL", scope: "All projects" },
      { ...packet("weekly", "Generated"), id: "WR-MGS", scope: "MGS" },
      { ...packet("monthly", "Generated"), id: "MR-ALL", scope: "All projects" },
      { ...packet("monthly", "Generated"), id: "MR-MGS", scope: "MGS" },
    ];
    expect(buildDailyReports(packets, [], ["MGS"]).map((r) => r.scope)).toEqual(["MGS"]);
    expect(buildWeeklyReports(packets, [], ["MGS"]).map((r) => r.scope)).toEqual(["MGS"]);
    expect(buildMonthlyReports(packets, [], ["MGS"]).map((r) => r.scope)).toEqual(["MGS"]);
  });
});
