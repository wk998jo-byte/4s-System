import type { HwRegisterItem } from "../api/scc";
import { HW_DEVICE_META, coerceHwStatusForDevice, type HwStatus } from "./hwData";

/** Inventory quantities are authoritative; unregistered units have no known status. */
export function inventoryMetrics(
  matrix: Record<string, Record<string, number>>,
  register: HwRegisterItem[],
) {
  const statuses: HwStatus[] = ["Installed", "Assigned", "In Stock", "Under Maintenance", "Damaged", "Lost", "Unknown"];
  const empty = () => Object.fromEntries(statuses.map((s) => [s, 0])) as Record<HwStatus, number>;
  const byStatus: Record<string, Record<HwStatus, number>> = {};
  const byType = Object.fromEntries(HW_DEVICE_META.map((m) => [m.device, empty()]));
  let unmatchedRegister = 0;
  for (const [site, counts] of Object.entries(matrix)) {
    byStatus[site] = empty();
    for (const meta of HW_DEVICE_META) {
      const total = Math.max(0, Number(counts[meta.device]) || 0);
      const rows = register.filter((r) => r.project === site && r.device === meta.device);
      const matched = rows.slice(0, total);
      unmatchedRegister += Math.max(0, rows.length - total);
      for (const row of matched) {
        const status = coerceHwStatusForDevice(row.device, row.status);
        byStatus[site][status]++;
        byType[meta.device][status]++;
      }
      const unknown = total - matched.length;
      byStatus[site].Unknown += unknown;
      byType[meta.device].Unknown += unknown;
    }
  }
  const health = HW_DEVICE_META.map((meta) => {
    const s = byType[meta.device];
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    return {
      device: meta.device, system: meta.system, total,
      installed: s.Installed, assigned: s.Assigned, inStock: s["In Stock"],
      maint: s["Under Maintenance"], damaged: s.Damaged, lost: s.Lost, unknown: s.Unknown,
      inServicePct: total ? Math.round(100 * (s.Installed + s.Assigned) / total) : 0,
    };
  });
  const attention = Object.entries(byStatus)
    .map(([project, s]) => ({ project, damaged: s.Damaged, lost: s.Lost, total: s.Damaged + s.Lost }))
    .filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  return { byStatus, health, attention, unmatchedRegister };
}
