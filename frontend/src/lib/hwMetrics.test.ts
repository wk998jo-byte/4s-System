import { describe, expect, it } from "vitest";
import { inventoryMetrics } from "./hwMetrics";
import { mergeTransfers, HW_DEVICE_META } from "./hwData";
import { deviceRowsFromHw } from "../screens/WearablesScreen";
import type { HwRegisterItem } from "../api/scc";

const row = (status: string): HwRegisterItem => ({
  id: status, device: "Smart Watch", serial: status, project: "Yanbu", system: "4S", status,
});

describe("persisted inventory metrics", () => {
  it("keeps zero devices and every category without invented statuses", () => {
    const metrics = inventoryMetrics({ Jafurah: {}, Yanbu: {}, "dept:Test": {} }, []);
    expect(metrics.health).toHaveLength(HW_DEVICE_META.length);
    expect(metrics.health.every((r) => r.total === 0 && r.inServicePct === 0)).toBe(true);
    expect(Object.values(metrics.byStatus).every((s) => Object.values(s).every((v) => v === 0))).toBe(true);
    expect(metrics.attention).toEqual([]);
  });
  it("reconciles partial register coverage using Unknown, never guessed status shares", () => {
    const metrics = inventoryMetrics({ Yanbu: { "Smart Watch": 5 } }, [row("Assigned"), row("Lost")]);
    const watch = metrics.health.find((r) => r.device === "Smart Watch")!;
    expect(watch).toMatchObject({ total: 5, assigned: 1, lost: 1, unknown: 3, installed: 0 });
    expect(Object.values(metrics.byStatus.Yanbu).reduce((a, b) => a + b, 0)).toBe(5);
  });
  it("never turns orphan register entries into inventory", () => {
    const metrics = inventoryMetrics({ Yanbu: { "Smart Watch": 0 } }, [row("Assigned")]);
    expect(metrics.unmatchedRegister).toBe(1);
    expect(metrics.health.every((r) => r.total === 0)).toBe(true);
  });
  it("includes actual department quantities without claiming their statuses", () => {
    const metrics = inventoryMetrics({ "dept:Test": { GPS: 4 }, Yanbu: { "Smart Watch": 2 } }, [row("Assigned")]);
    expect(metrics.health.reduce((n, r) => n + r.total, 0)).toBe(6);
    expect(metrics.byStatus["dept:Test"].Unknown).toBe(4);
  });
});

describe("saved transfers and wearables", () => {
  it("does not invent transfers for empty API results", () => expect(mergeTransfers([])).toEqual([]));
  it("preserves saved values without merging seeded rows or missing metadata", () => {
    const transfers = mergeTransfers([{ id: "TRF-0007", qty: 0, status: "transit" }]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ qty: 0, serials: [], atIso: "", sender: "", to: "" });
  });
  it("uses persisted dates, serials, and receipt data", () => {
    const transfers = mergeTransfers([{ id: "REAL", qty: 2, serials: ["a", "b"], atIso: "2026-01-01", status: "received", received_at: "2026-01-02" }]);
    expect(transfers[0]).toMatchObject({ serials: ["a", "b"], atIso: "2026-01-01", receivedAtIso: "2026-01-02" });
  });
  it("does not substitute sample wearable deployments for zero inventory", () => {
    expect(deviceRowsFromHw(null)).toEqual([]);
    expect(deviceRowsFromHw({ project_counts: { Yanbu: { "Smart Helmet": 0, "Smart Watch": 0 } } } as never)).toEqual([]);
  });
  it("does not invent watches when only helmets have been saved", () => {
    expect(deviceRowsFromHw({ project_counts: { Yanbu: { "Smart Helmet": 2 } } } as never))
      .toEqual([["Yanbu", { helmet: 2, watch: 0 }]]);
  });
});
