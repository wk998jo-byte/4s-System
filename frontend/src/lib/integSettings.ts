import { useEffect, useState } from "react";
import { fetchIntegrationSettings } from "../api/scc";

export type IntegSettings = {
  safelifeAsk: boolean;
  safelifeDefault: boolean;
  itqanAsk: boolean;
  itqanDefault: boolean;
};

export const DEFAULT_INTEG_SETTINGS: IntegSettings = {
  safelifeAsk: true,
  safelifeDefault: true,
  itqanAsk: true,
  itqanDefault: true,
};

export const SAFELIFE_SKIP_REASONS = [
  "Positive observation, no SafeLife entry needed",
  "Closed on the spot by area HSEO",
  "Duplicate of an existing SafeLife entry",
] as const;

/** Yes at register / ref at close-out → Updated; No → Pending until Closed → Not required. */
export function safelifeStatusOf(row: {
  status: string;
  fields?: Record<string, unknown> | null;
}): "Updated" | "Pending" | "Not required" {
  const ref = String(row.fields?.safelife_ref ?? "").trim();
  if (ref || row.fields?.safelife_update === true) return "Updated";
  if (row.status === "closed") return "Not required";
  return "Pending";
}

export const ITQAN_SKIP_REASONS = [
  "Internal warning only, first offence",
  "Driver could not be identified from footage",
  "Duplicate of an existing ITQAN entry",
  "Third-party vehicle, not under BQ payroll",
] as const;

function parseInteg(data: Record<string, unknown> | null | undefined): IntegSettings {
  return {
    safelifeAsk: data?.safelifeAsk !== false,
    safelifeDefault: data?.safelifeDefault !== false,
    itqanAsk: data?.itqanAsk !== false,
    itqanDefault: data?.itqanDefault !== false,
  };
}

/** Load SafeLife / ITQAN admin toggles when a form drawer is open. */
export function useIntegSettings(active = true): IntegSettings {
  const [settings, setSettings] = useState<IntegSettings>(DEFAULT_INTEG_SETTINGS);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => {
      fetchIntegrationSettings()
        .then((data) => {
          if (!cancelled) setSettings(parseInteg(data));
        })
        .catch(() => {
          if (!cancelled) setSettings(DEFAULT_INTEG_SETTINGS);
        });
    };
    load();
    const onChanged = () => load();
    window.addEventListener("scc-cases-changed", onChanged);
    window.addEventListener("scc-settings-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("scc-cases-changed", onChanged);
      window.removeEventListener("scc-settings-changed", onChanged);
    };
  }, [active]);

  return settings;
}
