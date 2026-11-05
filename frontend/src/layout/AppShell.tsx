import { fetchHealth, getApiBaseUrl } from "../api/client";
import {
  fetchOverdueNotifications,
  type OverdueNotificationItem,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL } from "../auth/types";
import { errorMessage } from "../lib/errors";
import { href, routeTitle, type Route } from "../lib/routing";
import { formatUserLabel } from "../screens/shared";
import bqLogo from "../assets/bq-logo-white.png";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

type NotifTab = "all" | "esc" | "over" | "soon";

function fmtNotifAge(hours: number) {
  const abs = Math.abs(hours);
  if (abs < 24) return `${abs.toFixed(1)} h`;
  const d = abs / 24;
  if (d < 7) return `${d.toFixed(1)} days`;
  return `${(d / 7).toFixed(1)} wk`;
}

function riskTone(risk?: string) {
  const key = (risk || "").replace(/\s*Risk$/i, "").trim().toLowerCase();
  if (key === "high") return "high";
  if (key === "medium") return "med";
  return "low";
}

type NavIcon =
  | "dashboard"
  | "camera"
  | "car"
  | "speed"
  | "sos"
  | "itqan"
  | "review"
  | "reports"
  | "kpi"
  | "weather"
  | "layers"
  | "contacts"
  | "admin"
  | "performance";

type NavItem = {
  label: string;
  icon: NavIcon;
  route: Route;
  adminOnly?: boolean;
  kpiOnly?: boolean;
};

const NAV: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operations",
    items: [
      { label: "Dashboard", icon: "dashboard", route: { name: "dashboard", tab: "summary" } },
      { label: "AI Camera Observations", icon: "camera", route: { name: "list", type: "ai_camera" } },
      { label: "Dashcam Observations", icon: "car", route: { name: "list", type: "dashcam" } },
      { label: "Speed Violations", icon: "speed", route: { name: "list", type: "speed" } },
      { label: "Wearable Devices", icon: "sos", route: { name: "list", type: "sos" } },
      { label: "ITQAN Violations", icon: "itqan", route: { name: "list", type: "itqan" } },
    ],
  },
  {
    label: "Review",
    items: [
      { label: "Review & Records", icon: "review", route: { name: "review" } },
      { label: "Reports", icon: "reports", route: { name: "reports" } },
      { label: "KPI Dashboard", icon: "kpi", route: { name: "kpi" }, kpiOnly: true },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { label: "Weather Monitoring", icon: "weather", route: { name: "weather" } },
      { label: "SCC Hardware", icon: "layers", route: { name: "hw" } },
      { label: "Key Personnel & Contacts", icon: "contacts", route: { name: "contacts" } },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Administration", icon: "admin", route: { name: "admin" }, adminOnly: true },
      {
        label: "Operator Performance",
        icon: "performance",
        route: { name: "performance" },
        adminOnly: true,
      },
    ],
  },
];

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function NavGlyph({ name }: { name: NavIcon }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "camera":
      return (
        <svg {...common}>
          <path d="M2 8l14-4 2 6-14 4z" />
          <path d="M6 13l1 4h4" />
          <path d="M18 9l3-1" />
        </svg>
      );
    case "car":
      return (
        <svg {...common}>
          <path d="M5 17h14v-5l-2-5H7l-2 5z" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="16.5" cy="17.5" r="1.5" />
        </svg>
      );
    case "speed":
      return (
        <svg {...common}>
          <path d="M12 14l4-5" />
          <path d="M4 18a9 9 0 1 1 16 0" />
          <circle cx="12" cy="14" r="1.3" />
        </svg>
      );
    case "sos":
      return (
        <svg {...common}>
          <rect x="6" y="7" width="12" height="10" rx="3" />
          <path d="M9 7l1-4h4l1 4M9 17l1 4h4l1-4" />
        </svg>
      );
    case "itqan":
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v4h4" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      );
    case "review":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.5 2.5L16 9.5" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v4h4M9 13h6M9 17h6" />
        </svg>
      );
    case "kpi":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      );
    case "weather":
      return (
        <svg {...common}>
          <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
        </svg>
      );
    case "contacts":
      return (
        <svg {...common}>
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" />
        </svg>
      );
    case "performance":
      return (
        <svg {...common}>
          <path d="M3 21h18" />
          <rect x="5" y="11" width="3" height="7" />
          <rect x="10.5" y="6" width="3" height="12" />
          <rect x="16" y="13" width="3" height="5" />
        </svg>
      );
  }
}

function isActive(current: Route, item: Route): boolean {
  if (current.name === "list" && item.name === "list") return current.type === item.type;
  if (current.name === "new" && item.name === "list") return current.type === item.type;
  if (current.name === "dashboard" && item.name === "dashboard") return true;
  if (current.name === "review" && item.name === "review") return true;
  return href(current) === href(item);
}

function notificationHref(item: OverdueNotificationItem): string {
  const type = item.record_type;
  if (type === "ai_camera" || type === "dashcam" || type === "speed" || type === "sos") {
    return href({ name: "list", type, caseId: item.id });
  }
  return href({ name: "detail", id: item.id });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell({
  route,
  title,
  subtitle: _subtitle,
  dark,
  onDark,
  children,
}: {
  route: Route;
  title: string;
  subtitle?: string;
  dark: boolean;
  onDark: (value: boolean) => void;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const caps = user?.capabilities ?? {};
  const [connected, setConnected] = useState<boolean | null>(null);
  const [healthLabel, setHealthLabel] = useState("Checking API…");
  const [search, setSearch] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifTab, setNotifTab] = useState<NotifTab>("all");
  const notifPanelRef = useRef<HTMLDivElement | null>(null);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);
  const [overdue, setOverdue] = useState<{
    counts: { all: number; esc: number; over: number; soon: number };
    items: OverdueNotificationItem[];
    deadlines?: {
      High?: number;
      Medium?: number;
      Low?: number;
      SOS?: number;
      dueSoon?: number;
      escalate?: number;
    };
  } | null>(null);

  const accessLabel = useMemo(() => {
    if (user?.role === "admin") return "All projects";
    const projects = user?.projects;
    if (!projects?.length) return "All projects";
    return projects.join(" · ");
  }, [user?.role, user?.projects]);

  useEffect(() => {
    const ping = async () => {
      try {
        const health = await fetchHealth();
        setConnected(health.status === "ok");
        setHealthLabel(`API reachable · ${health.storage}`);
      } catch (error) {
        setConnected(false);
        setHealthLabel(errorMessage(error));
      }
    };
    void ping();
    const timer = window.setInterval(() => void ping(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchOverdueNotifications()
        .then((data) => {
          if (!cancelled) setOverdue(data);
        })
        .catch(() => {
          if (!cancelled) setOverdue(null);
        });
    };
    load();
    const timer = window.setInterval(load, 30000);
    const onCasesChanged = () => load();
    window.addEventListener("scc-cases-changed", onCasesChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("scc-cases-changed", onCasesChanged);
    };
  }, [route]);

  useEffect(() => {
    if (!notifOpen) return;
    fetchOverdueNotifications()
      .then((data) => setOverdue(data))
      .catch(() => setOverdue(null));
  }, [notifOpen]);

  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (notifPanelRef.current?.contains(target)) return;
      if (notifBtnRef.current?.contains(target)) return;
      setNotifOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotifOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [notifOpen]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: NotifTab }>).detail?.tab;
      if (tab === "all" || tab === "esc" || tab === "over" || tab === "soon") {
        setNotifTab(tab);
      }
      setNotifOpen(true);
    };
    window.addEventListener("scc-open-notifications", onOpen);
    return () => window.removeEventListener("scc-open-notifications", onOpen);
  }, []);

  const notifItems = useMemo(() => {
    const items = overdue?.items || [];
    if (notifTab === "all") return items;
    return items.filter((item) => item.state === notifTab);
  }, [overdue, notifTab]);

  function itemLocked(item: NavItem) {
    if (item.adminOnly && !caps.manage_users && !caps.operator_performance) return true;
    if (item.kpiOnly && !caps.view_kpi) return true;
    if (item.route.name === "admin" && !caps.manage_users) return true;
    if (item.route.name === "performance" && !caps.operator_performance) return true;
    return false;
  }

  function onSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    if (!q) return;
    window.location.hash = href({ name: "review", caseId: undefined });
    window.setTimeout(() => {
      window.location.hash = `#/review?case=${encodeURIComponent(q)}`;
    }, 0);
  }

  const notifCount = overdue?.counts.all ?? 0;

  return (
    <div className="app-v1">
      <aside className="rail" aria-label="Main navigation">
        <div className="rail-brand">
          <img src={bqLogo} alt="Bin Quraya" className="rail-logo" />
          <div className="rail-prod">
            <b>SCC Platform</b>
          </div>
          <span className="rail-tag">
            <span className="rail-dot" />
            Safety Command Center ·{" "}
            {connected === true ? "All systems operational" : healthLabel}
          </span>
        </div>
        <nav className="rail-nav">
          {NAV.map((group) => (
            <div key={group.label}>
              <h6>{group.label}</h6>
              {group.items.map((item) => {
                const locked = itemLocked(item);
                if (locked) {
                  return (
                    <span key={item.label} className="rail-link locked" title="Restricted">
                      <NavGlyph name={item.icon} />
                      <span>{item.label}</span>
                      <LockGlyph />
                    </span>
                  );
                }
                return (
                  <a
                    key={item.label}
                    className={isActive(route, item.route) ? "rail-link on" : "rail-link"}
                    href={href(item.route)}
                  >
                    <NavGlyph name={item.icon} />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="rail-user">
          <span className="avatar">{initials(user?.display_name || user?.badge_number || "U")}</span>
          <div>
            <b>{formatUserLabel(user)}</b>
            <small>
              {ROLE_LABEL[user?.role || ""] || user?.role} · {accessLabel}
            </small>
          </div>
          <button
            className="linkbtn rail-signout"
            type="button"
            onClick={() => void logout()}
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-v1">
        <header className="topbar-v1">
          <div className="crumb">
            SCC Platform / <b>{routeTitle(route) || title}</b>
          </div>
          <span className="sp" />
          <span className="tagx" title="Project access">
            <LockGlyph /> {accessLabel}
          </span>
          <form className="search-v1" onSubmit={onSearchSubmit}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search case ID, driver or asset"
              aria-label="Search records"
            />
          </form>
          <button
            className="iconbtn"
            type="button"
            aria-label="Switch light or dark"
            onClick={() => onDark(!dark)}
          >
            {dark ? "☀" : "☾"}
          </button>
          <button
            ref={notifBtnRef}
            className="iconbtn"
            type="button"
            aria-label="Notifications"
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen((value) => !value)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            {notifCount > 0 ? <span className="icon-badge">{notifCount > 99 ? "99+" : notifCount}</span> : null}
          </button>
        </header>

        {notifOpen ? (
          <div className="npanel" ref={notifPanelRef}>
            <div className="nh">
              <div>
                <b>Notifications</b>
                <span className="muted">close-out deadlines</span>
              </div>
              <button className="iconbtn" type="button" onClick={() => setNotifOpen(false)}>
                ×
              </button>
            </div>
            <div className="npanel-tabs">
              {(
                [
                  ["all", "All", overdue?.counts.all ?? 0],
                  ["esc", "Escalated", overdue?.counts.esc ?? 0],
                  ["over", "Overdue", overdue?.counts.over ?? 0],
                  ["soon", "Due soon", overdue?.counts.soon ?? 0],
                ] as const
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  type="button"
                  className={notifTab === id ? "on" : undefined}
                  onClick={() => setNotifTab(id)}
                >
                  {label} <span>{n}</span>
                </button>
              ))}
            </div>
            <p className="npanel-hint">
              Deadlines: High {overdue?.deadlines?.High ?? 24} h · Medium{" "}
              {overdue?.deadlines?.Medium ?? 72} h / 3 days · Low{" "}
              {overdue?.deadlines?.Low ?? 168} h / 7 days · SOS{" "}
              {overdue?.deadlines?.SOS ?? 2} h. Escalation after{" "}
              {overdue?.deadlines?.escalate ?? 2}× the deadline.
            </p>
            <div className="npanel-body">
              {!notifItems.length ? (
                <p className="empty">Nothing in this list.</p>
              ) : (
                notifItems.slice(0, 60).map((item) => {
                  const tone = riskTone(item.risk_level || item.risk_key);
                  const overdueAge = item.over_hours ?? Math.max(0, item.age_hours - (item.deadline_hours || 0));
                  const right =
                    item.state === "soon"
                      ? `${fmtNotifAge(item.left_hours ?? 0)} left`
                      : `+${fmtNotifAge(overdueAge)}`;
                  return (
                    <a
                      key={item.id}
                      className={`nitem nitem-risk-${tone}`}
                      href={notificationHref(item)}
                      onClick={() => setNotifOpen(false)}
                    >
                      <div className="nitem-main">
                        <b>
                          {item.case_id} · {item.record_label || item.record_type}
                        </b>
                        <small>{item.detail || `${item.project || item.department || "—"} · ${item.state_label || item.state}`}</small>
                      </div>
                      <div className={`nitem-meta state-${item.state}`}>
                        <strong>{right}</strong>
                        <span>{item.state_label || item.state}</span>
                      </div>
                    </a>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        <main className="content-v1" title={getApiBaseUrl()}>
          {children}
        </main>
      </div>
    </div>
  );
}
