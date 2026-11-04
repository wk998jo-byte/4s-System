import type { PrototypeModule, PrototypeStatus } from "./api/types";

export const MODULE_LABELS: Record<PrototypeModule, string> = {
  ai_camera: "AI Camera",
  dashcam: "DashCam",
  speed: "Speed",
  sos: "SOS",
  other: "Other (test)",
};

export const STATUS_LABELS: Record<PrototypeStatus, string> = {
  open: "Open",
  under_process: "Under Process",
  closed: "Closed",
};

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(date);
}
