/** V1-aligned SCC Hardware seed helpers (register, status, transfers, history). */

export type HwStatus =
  | "Installed"
  | "Assigned"
  | "In Stock"
  | "Under Maintenance"
  | "Damaged"
  | "Lost";

export type HwSystem = "4S" | "FMS" | "PWAS";

export type HwDeviceType =
  | "AI Camera"
  | "Edge Server"
  | "Router"
  | "NVR"
  | "Smart Helmet"
  | "Smart Watch"
  | "Weather Station"
  | "GPS"
  | "Dashcam"
  | "Weight Sensor"
  | "PWAS";

export type HwDevice = {
  id: string;
  device: HwDeviceType;
  system: HwSystem;
  serial: string;
  status: HwStatus;
  project: string;
  lastSignal: string | null;
  updatedIso: string;
};

export type HwTransfer = {
  id: string;
  atIso: string;
  kind: "delivery" | "shift";
  from: string;
  to: string;
  type: HwDeviceType | string;
  qty: number;
  serials: string[];
  reason: string;
  sender: string;
  receiver: string;
  status: "transit" | "received";
  receivedAtIso?: string;
};

export type HwChange = {
  id: string;
  atIso: string;
  location: string;
  device: string;
  status: string;
  from: number;
  to: number;
  reason: string;
  by: string;
};

export const HW_DEVICE_META: Array<{
  device: HwDeviceType;
  system: HwSystem;
  total: number;
}> = [
  { device: "AI Camera", system: "4S", total: 68 },
  { device: "Edge Server", system: "4S", total: 11 },
  { device: "Router", system: "4S", total: 20 },
  { device: "NVR", system: "4S", total: 12 },
  { device: "Smart Helmet", system: "4S", total: 1348 },
  { device: "Smart Watch", system: "4S", total: 502 },
  { device: "Weather Station", system: "4S", total: 5 },
  { device: "GPS", system: "FMS", total: 1979 },
  { device: "Dashcam", system: "FMS", total: 668 },
  { device: "Weight Sensor", system: "FMS", total: 93 },
  { device: "PWAS", system: "PWAS", total: 13 },
];

export const HW_PROJECTS = [
  "Jafurah",
  "Yanbu",
  "Dhahran",
  "MGS",
  "Salasil",
  "Ras Tanura",
  "Rig Move",
  "Medical Division",
  "Aramco Emergency Job",
  "Safaniya",
] as const;

/** Share of all devices by project (sums ~1). */
const PROJECT_SHARE: Record<string, number> = {
  Jafurah: 0.422,
  Yanbu: 0.187,
  Dhahran: 0.09,
  MGS: 0.075,
  Salasil: 0.055,
  "Ras Tanura": 0.05,
  "Rig Move": 0.04,
  "Medical Division": 0.035,
  "Aramco Emergency Job": 0.028,
  Safaniya: 0.018,
};

const STATUS_SHARE: Record<HwStatus, number> = {
  Installed: 0.546,
  Assigned: 0.347,
  "In Stock": 0.056,
  "Under Maintenance": 0.0265,
  Damaged: 0.017,
  Lost: 0.008,
};

export const HW_STATUS_COLORS: Record<HwStatus, string> = {
  Installed: "#2f9e5b",
  Assigned: "#2a8f8a",
  "In Stock": "#8B8A8F",
  "Under Maintenance": "#E9A23B",
  Damaged: "#C8102E",
  Lost: "#2a2a2a",
};

export const HW_STATUSES = Object.keys(HW_STATUS_COLORS) as HwStatus[];

/** "Assigned" is only valid for wearable devices. */
export const HW_WEARABLE_DEVICES: ReadonlySet<string> = new Set([
  "Smart Helmet",
  "Smart Watch",
]);

export function isHwWearableDevice(device: string): boolean {
  return HW_WEARABLE_DEVICES.has(device);
}

/** Status choices for add/change: wearables get all; other devices exclude Assigned. */
export function hwStatusesForDevice(device: string): HwStatus[] {
  if (isHwWearableDevice(device)) return [...HW_STATUSES];
  return HW_STATUSES.filter((s) => s !== "Assigned");
}

export function coerceHwStatusForDevice(device: string, status: string): HwStatus {
  const allowed = hwStatusesForDevice(device);
  if (allowed.includes(status as HwStatus)) return status as HwStatus;
  return "In Stock";
}

function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(...parts: Array<string | number>) {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

export function fmtN(n: number) {
  return n.toLocaleString("en-US");
}

export function fmtHwDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${mon[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtHwDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${fmtHwDate(iso)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hwTotalDevices() {
  return HW_DEVICE_META.reduce((s, d) => s + d.total, 0);
}

export function splitByStatus(
  total: number,
  allowAssigned = true,
): Record<HwStatus, number> {
  // Non-wearables never use Assigned — fold that share into Installed.
  const shares: Record<HwStatus, number> = { ...STATUS_SHARE };
  if (!allowAssigned) {
    shares.Installed = STATUS_SHARE.Installed + STATUS_SHARE.Assigned;
    shares.Assigned = 0;
  }
  const entries = Object.entries(shares) as Array<[HwStatus, number]>;
  const out = {} as Record<HwStatus, number>;
  let used = 0;
  entries.forEach(([status, share], i) => {
    if (i === entries.length - 1) {
      out[status] = Math.max(0, total - used);
    } else {
      const n = Math.round(total * share);
      out[status] = n;
      used += n;
    }
  });
  return out;
}

function emptyStatusCounts(): Record<HwStatus, number> {
  return {
    Installed: 0,
    Assigned: 0,
    "In Stock": 0,
    "Under Maintenance": 0,
    Damaged: 0,
    Lost: 0,
  };
}

export function projectDeviceMatrix(projects: string[]) {
  const matrix: Record<string, Record<HwDeviceType, number>> = {};
  for (const project of projects) {
    matrix[project] = {} as Record<HwDeviceType, number>;
    for (const meta of HW_DEVICE_META) {
      const share = PROJECT_SHARE[project] ?? 1 / Math.max(projects.length, 1);
      matrix[project][meta.device] = Math.max(0, Math.round(meta.total * share));
    }
  }
  // Adjust last project so column totals match meta totals.
  const last = projects[projects.length - 1];
  if (last) {
    for (const meta of HW_DEVICE_META) {
      const sum = projects
        .slice(0, -1)
        .reduce((s, p) => s + (matrix[p][meta.device] || 0), 0);
      matrix[last][meta.device] = Math.max(0, meta.total - sum);
    }
  }
  return matrix;
}

export function statusByProject(projects: string[]) {
  const matrix = projectDeviceMatrix(projects);
  const out: Record<string, Record<HwStatus, number>> = {};
  for (const project of projects) {
    const acc = emptyStatusCounts();
    for (const meta of HW_DEVICE_META) {
      const n = matrix[project]?.[meta.device] || 0;
      const st = splitByStatus(n, isHwWearableDevice(meta.device));
      for (const status of HW_STATUSES) acc[status] += st[status];
    }
    out[project] = acc;
  }
  return out;
}

export function buildDeviceRegister(
  projects: string[],
  limit = 48,
  now = new Date(),
): HwDevice[] {
  const rows: HwDevice[] = [];
  let n = 0;
  for (const meta of HW_DEVICE_META) {
    for (let i = 0; i < Math.min(8, meta.total); i += 1) {
      if (rows.length >= limit) return rows;
      const rnd = mulberry(hashSeed(meta.device, i, "reg"));
      const project = projects[Math.floor(rnd() * projects.length)] || projects[0] || "Jafurah";
      const pool = hwStatusesForDevice(meta.device);
      const status = pool[Math.floor(rnd() * pool.length)] || "In Stock";
      const day = new Date(now);
      day.setDate(now.getDate() - Math.floor(rnd() * 40));
      const online = status === "Installed" || status === "Assigned" ? rnd() > 0.35 : false;
      const mins = Math.floor(rnd() * 180) + 5;
      rows.push({
        id: `DEV-${pad(++n, 4)}`,
        device: meta.device,
        system: meta.system,
        serial: serialFor(meta.device, i),
        status,
        project,
        lastSignal: online ? `Online ${mins} min ago` : null,
        updatedIso: day.toISOString(),
      });
    }
  }
  return rows;
}

function serialFor(device: HwDeviceType, i: number) {
  const map: Record<string, string> = {
    "AI Camera": "AIC",
    "Edge Server": "ESV",
    Router: "RTR",
    NVR: "NVR",
    "Smart Helmet": "SH",
    "Smart Watch": "SW",
    "Weather Station": "WS",
    GPS: "GPS",
    Dashcam: "DC",
    "Weight Sensor": "WSN",
    PWAS: "PW",
  };
  const prefix = map[device] || "DEV";
  return `${prefix}-26-${pad(1000 + i, 4)}${pad((i * 17) % 100, 2)}`;
}

export function defaultTransfers(now = new Date()): HwTransfer[] {
  const d = (daysAgo: number, hour = 10) => {
    const x = new Date(now);
    x.setDate(now.getDate() - daysAgo);
    x.setHours(hour, 22, 0, 0);
    return x.toISOString();
  };
  return [
    {
      id: "TRF-0007",
      atIso: d(2),
      kind: "delivery",
      from: "Warehouse",
      to: "Jafurah",
      type: "Smart Helmet",
      qty: 5,
      serials: ["SH-26-001300", "SH-26-001301", "SH-26-001302", "SH-26-001303", "SH-26-001304"],
      reason: "Additional crews",
      sender: "Warehouse Keeper",
      receiver: "Site Receiver",
      status: "transit",
    },
    {
      id: "TRF-0005",
      atIso: d(6),
      kind: "delivery",
      from: "Warehouse",
      to: "Ras Tanura",
      type: "Dashcam",
      qty: 3,
      serials: ["DC-867395073700", "DC-867395073701", "DC-867395073702"],
      reason: "Replacement of faulty devices",
      sender: "Warehouse Keeper",
      receiver: "Site Receiver",
      status: "transit",
    },
    {
      id: "TRF-0006",
      atIso: d(3, 8),
      kind: "shift",
      from: "Yanbu",
      to: "MGS",
      type: "GPS",
      qty: 2,
      serials: ["GPS-867395080", "GPS-867395081"],
      reason: "Additional vehicles",
      sender: "Site Storekeeper Yanbu",
      receiver: "Site Receiver",
      status: "received",
      receivedAtIso: d(3, 9),
    },
  ];
}

export function defaultChangeHistory(now = new Date()): HwChange[] {
  const d = (daysAgo: number, hour: number, minute = 0) => {
    const x = new Date(now);
    x.setDate(now.getDate() - daysAgo);
    x.setHours(hour, minute, 0, 0);
    return x.toISOString();
  };
  return [
    {
      id: "CHG-1",
      atIso: d(3, 8, 22),
      location: "MGS",
      device: "GPS",
      status: "In Stock",
      from: 5,
      to: 7,
      reason: "Receipt of TRF-0006 (from Yanbu, sent by Site Storekeeper Yanbu)",
      by: "Site Receiver",
    },
    {
      id: "CHG-2",
      atIso: d(3, 8, 21),
      location: "Yanbu",
      device: "GPS",
      status: "In Stock",
      from: 22,
      to: 20,
      reason: "Shifted to MGS (TRF-0006)",
      by: "Site Storekeeper Yanbu",
    },
    {
      id: "CHG-3",
      atIso: d(10, 11, 5),
      location: "Jafurah",
      device: "Dashcam",
      status: "Damaged",
      from: 3,
      to: 6,
      reason: "Damaged or faulty · WO-1182 · 3 units with cracked lenses",
      by: "Rayan Alghamdi",
    },
    {
      id: "CHG-4",
      atIso: d(12, 14, 40),
      location: "Ras Tanura",
      device: "AI Camera",
      status: "Under Maintenance",
      from: 2,
      to: 4,
      reason: "Scheduled maintenance · lens cleaning and firmware update",
      by: "Site Storekeeper Ras Tanura",
    },
    {
      id: "CHG-5",
      atIso: d(18, 9, 12),
      location: "Dhahran",
      device: "Smart Helmet",
      status: "Lost",
      from: 0,
      to: 2,
      reason: "Reported missing after crew rotation",
      by: "Rayan Alghamdi",
    },
  ];
}

export function installedTrend(now = new Date()) {
  const months = now.getMonth() + 1;
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const base = 3600;
  const values: number[] = [];
  for (let i = 0; i < months; i += 1) {
    values.push(Math.round(base + i * 65 + (i % 3) * 12));
  }
  return { labels: labels.slice(0, months), values };
}

export function healthByType(projects: string[]) {
  const matrix = projectDeviceMatrix(projects);
  return HW_DEVICE_META.map((meta) => {
    const total = projects.reduce((s, p) => s + (matrix[p]?.[meta.device] || 0), 0) || meta.total;
    const st = splitByStatus(total, isHwWearableDevice(meta.device));
    const inService = st.Installed + st.Assigned;
    return {
      device: meta.device,
      system: meta.system,
      total,
      installed: st.Installed,
      assigned: st.Assigned,
      inStock: st["In Stock"],
      maint: st["Under Maintenance"],
      damaged: st.Damaged,
      lost: st.Lost,
      inServicePct: total ? Math.round((inService / total) * 100) : 0,
    };
  });
}

export function damagedLostByProject(projects: string[]) {
  const byStatus = statusByProject(projects);
  return projects
    .map((project) => {
      const damaged = byStatus[project]?.Damaged || 0;
      const lost = byStatus[project]?.Lost || 0;
      return { project, damaged, lost, total: damaged + lost };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

export function mergeTransfers(
  apiItems: Array<Record<string, unknown>>,
  now = new Date(),
): HwTransfer[] {
  const seeded = defaultTransfers(now);
  if (!apiItems.length) return seeded;
  const fromApi = apiItems.map((raw, i) => {
    const id = String(raw.id || `TRF-${pad(i + 1, 4)}`);
    const seed = seeded.find((t) => t.id === id);
    const status = String(raw.status || seed?.status || "transit") === "received" ? "received" : "transit";
    return {
      id,
      atIso: String(raw.at || raw.created_at || seed?.atIso || now.toISOString()),
      kind: (raw.kind as "delivery" | "shift") || seed?.kind || "delivery",
      from: String(raw.from || seed?.from || "Warehouse"),
      to: String(raw.to || seed?.to || "Jafurah"),
      type: String(raw.type || seed?.type || "AI Camera"),
      qty: Number(raw.qty ?? seed?.qty ?? 1),
      serials: Array.isArray(raw.serials)
        ? (raw.serials as string[])
        : seed?.serials || [],
      reason: String(raw.reason || seed?.reason || "Material movement"),
      sender: String(raw.sender || seed?.sender || "Warehouse Keeper"),
      receiver: String(raw.recv || raw.receiver || seed?.receiver || "Site Receiver"),
      status,
      receivedAtIso:
        status === "received"
          ? String(raw.received_at || seed?.receivedAtIso || now.toISOString())
          : undefined,
    } satisfies HwTransfer;
  });
  const seen = new Set(fromApi.map((t) => t.id));
  return [...fromApi, ...seeded.filter((t) => !seen.has(t.id))];
}
