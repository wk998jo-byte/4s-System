export type ModuleType = "ai_camera" | "dashcam" | "speed" | "sos" | "itqan";
export type DashTab = "overview" | "summary" | "ai_camera" | "dashcam" | "speed" | "sos";

export type Route =
  | { name: "dashboard"; tab: DashTab }
  | { name: "list"; type: ModuleType; caseId?: string }
  | { name: "new"; type: ModuleType }
  | { name: "detail"; id: string }
  | {
      name: "review";
      caseId?: string;
      status?: "open" | "under_process" | "closed";
      types?: ModuleType[];
    }
  | { name: "reports"; reportId?: string; sign?: boolean }
  | { name: "kpi" }
  | { name: "weather" }
  | { name: "hw" }
  | { name: "contacts" }
  | { name: "admin" }
  | { name: "performance" };

const MODULE_SLUGS: Record<string, ModuleType> = {
  "ai-camera": "ai_camera",
  dashcam: "dashcam",
  speed: "speed",
  sos: "sos",
  wearables: "sos",
  itqan: "itqan",
};

const MODULE_HREF: Record<ModuleType, string> = {
  ai_camera: "ai-camera",
  dashcam: "dashcam",
  speed: "speed",
  sos: "wearables",
  itqan: "itqan",
};

export function parseHash(hash?: string): Route {
  const source =
    hash ?? (typeof window !== "undefined" ? window.location.hash : "#/dashboard");
  const raw = source.replace(/^#/, "") || "/dashboard";
  const [pathPart, queryPart] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const params = new URLSearchParams(queryPart ?? "");
  const [a, b] = parts;
  if (a === "dashboard") {
    const rawTab = (b as DashTab) || "summary";
    const tab = rawTab === "overview" ? "summary" : rawTab;
    return { name: "dashboard", tab };
  }
  if (a && MODULE_SLUGS[a] && b === "new") {
    return { name: "new", type: MODULE_SLUGS[a] };
  }
  if (a && MODULE_SLUGS[a]) {
    const caseId = params.get("case") || undefined;
    return caseId
      ? { name: "list", type: MODULE_SLUGS[a], caseId }
      : { name: "list", type: MODULE_SLUGS[a] };
  }
  if (a === "cases" && b) return { name: "detail", id: b };
  if (a === "review") {
    const caseId = params.get("case") || undefined;
    const rawStatus = params.get("status") || undefined;
    const status =
      rawStatus === "open" ||
      rawStatus === "under_process" ||
      rawStatus === "closed"
        ? rawStatus
        : undefined;
    const types = (params.get("types") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is ModuleType =>
        value === "ai_camera" ||
        value === "dashcam" ||
        value === "speed" ||
        value === "sos" ||
        value === "itqan",
      );
    return {
      name: "review",
      ...(caseId ? { caseId } : {}),
      ...(status ? { status } : {}),
      ...(types.length ? { types } : {}),
    };
  }
  if (a === "reports") {
    const reportId = params.get("report") || undefined;
    const sign = params.get("sign") === "1" || params.get("sign") === "true";
    if (reportId) return { name: "reports", reportId, sign: sign || undefined };
    return { name: "reports" };
  }
  if (a === "kpi") return { name: "kpi" };
  if (a === "weather") return { name: "weather" };
  if (a === "hw" || a === "scc-hw") return { name: "hw" };
  if (a === "contacts") return { name: "contacts" };
  if (a === "admin") return { name: "admin" };
  if (a === "performance" || a === "operators") return { name: "performance" };
  return { name: "dashboard", tab: "summary" };
}

export function href(route: Route): string {
  if (route.name === "dashboard") {
    return route.tab === "summary" || route.tab === "overview"
      ? "#/dashboard"
      : `#/dashboard/${route.tab}`;
  }
  if (route.name === "list") {
    const base = `#/${MODULE_HREF[route.type]}`;
    return route.caseId ? `${base}?case=${encodeURIComponent(route.caseId)}` : base;
  }
  if (route.name === "new") return `#/${MODULE_HREF[route.type]}/new`;
  if (route.name === "detail") return `#/cases/${route.id}`;
  if (route.name === "review") {
    const params = new URLSearchParams();
    if (route.caseId) params.set("case", route.caseId);
    if (route.status) params.set("status", route.status);
    if (route.types?.length) params.set("types", route.types.join(","));
    const query = params.toString();
    return query ? `#/review?${query}` : "#/review";
  }
  if (route.name === "hw") return "#/scc-hw";
  if (route.name === "performance") return "#/operators";
  if (route.name === "reports") {
    if (!route.reportId) return "#/reports";
    const params = new URLSearchParams();
    params.set("report", route.reportId);
    if (route.sign) params.set("sign", "1");
    return `#/reports?${params.toString()}`;
  }
  return `#/${route.name}`;
}

export function routeTitle(route: Route): string {
  if (route.name === "dashboard") return "Dashboard";
  if (route.name === "list" || route.name === "new") {
    const labels: Record<ModuleType, string> = {
      ai_camera: "AI Camera Observations",
      dashcam: "Dashcam Observations",
      speed: "Speed Violations",
      sos: "Wearable Devices",
      itqan: "ITQAN Violations",
    };
    return labels[route.type];
  }
  if (route.name === "detail") return "Record";
  if (route.name === "review") return "Review & Records";
  if (route.name === "reports") return "Reports";
  if (route.name === "kpi") return "KPI Dashboard";
  if (route.name === "weather") return "Weather Monitoring";
  if (route.name === "hw") return "SCC Hardware";
  if (route.name === "contacts") return "Key Personnel & Contacts";
  if (route.name === "admin") return "Administration";
  return "Operator Performance";
}
