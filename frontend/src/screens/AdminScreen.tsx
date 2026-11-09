import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  addListItem,
  createUser,
  deleteListItem,
  deleteUser,
  fetchAuditLog,
  fetchCases,
  fetchCatalog,
  fetchList,
  fetchOverdueNotifications,
  fetchPermissionMatrix,
  fetchPlatformSettings,
  fetchUsers,
  notifyCasesChanged,
  notifySettingsChanged,
  savePlatformSettings,
  updateListItem,
  updateUser,
  type AuditLogItem,
  type ListItem,
} from "../api/scc";
import { notifyListsChanged } from "../api/lists";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import {
  ACCESS_PROJECTS,
  ADMIN_PMS,
  ADMIN_PROJECTS,
  ADMIN_ROLE_OPTIONS,
  ADMIN_TABS,
  DEFAULT_SETTINGS,
  INTEG_STATS,
  ROLE_PERMISSIONS,
  fmtAdminDT,
  moduleFromCategory,
  roleLabel,
  roleValue,
  sampleAuditRows,
  type AdminTabId,
  type AuditRow,
} from "../lib/adminData";
import { formatUserLabel, LIST_LABEL } from "./shared";

type AdminUser = {
  id: string;
  username: string;
  display_name: string;
  badge_number: string | null;
  role: string;
  projects?: string[] | null;
  status?: string;
};

type SlaBlock = {
  High?: { hours?: number; label?: string };
  Medium?: { hours?: number; label?: string };
  Low?: { hours?: number; label?: string };
  dueSoon?: number;
  escalate?: number;
};

function AdminIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 8v8M12 7v10M16 9v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.5 10.5h3M10.5 12.5h3M14.5 14.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5 10 17.5 19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.5 16.5 20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v11M8.5 11.5 12 15l3.5-3.5M4 18.5h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 7h15M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M10 11v5.5M14 11v5.5M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 16h12l-1.2-2.2a6.2 6.2 0 0 1-.8-3V9a4 4 0 1 0-8 0v1.8c0 1.1-.3 2.1-.8 3L6 16Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function Card({
  title,
  sub,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v1-card adm-card ${className}`.trim()}>
      <div className="adm-card-head">
        <div>
          <h3>{title}</h3>
          {sub ? <p className="adm-card-sub">{sub}</p> : null}
        </div>
        {actions ? <div className="adm-card-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Switch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`adm-sw${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      onClick={onToggle}
    />
  );
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const lines = rows.map((row) => row.map(csvCell).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function resolvePersonLabel(
  name: string | null | undefined,
  users: Array<{ display_name: string; badge_number: string | null }>,
): string {
  const raw = (name || "").trim();
  if (!raw) return "—";
  const hit = users.find(
    (u) => formatUserLabel(u) === raw || u.display_name === raw,
  );
  return hit ? formatUserLabel(hit) : raw;
}

function mapAuditItem(
  item: AuditLogItem,
  users: Array<{ display_name: string; badge_number: string | null }> = [],
): AuditRow {
  const details = item.details || {};
  const det =
    typeof details.detail === "string"
      ? details.detail
      : typeof details.details === "string"
        ? details.details
        : item.summary;
  return {
    id: item.id,
    at: item.occurred_at ? new Date(item.occurred_at).getTime() : 0,
    by: resolvePersonLabel(item.actor_name, users),
    mod: moduleFromCategory(item.category, item.action, item.summary),
    act: item.summary || item.action,
    caseId: item.case_id || (typeof details.serial === "string" ? details.serial : "—"),
    det,
  };
}

const DEFAULT_SLA = DEFAULT_SETTINGS.sla as SlaBlock;

function slaHours(settings: Record<string, unknown>, key: "High" | "Medium" | "Low"): number {
  const sla = (settings.sla as SlaBlock | undefined) || {};
  return Number(sla[key]?.hours ?? DEFAULT_SLA[key]?.hours ?? 24);
}

function dueSoonPct(settings: Record<string, unknown>): number {
  const sla = (settings.sla as SlaBlock | undefined) || {};
  return Math.round(Number(sla.dueSoon ?? 0.75) * 100);
}

function escalateMult(settings: Record<string, unknown>): number {
  const sla = (settings.sla as SlaBlock | undefined) || {};
  return Number(sla.escalate ?? 2);
}

export function AdminScreen() {
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<AdminTabId>("audit");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<Record<string, unknown>>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [auditRows, setAuditRows] = useState<AuditRow[]>(() => sampleAuditRows());
  const [auditMod, setAuditMod] = useState("All");
  const [auditQ, setAuditQ] = useState("");
  const [auditPage, setAuditPage] = useState(0);

  const [overdueCounts, setOverdueCounts] = useState({ esc: 54, over: 18, soon: 8 });

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [matrix, setMatrix] = useState(ROLE_PERMISSIONS);
  const [accessEdit, setAccessEdit] = useState<AdminUser | null>(null);
  const [accessAll, setAccessAll] = useState(true);
  const [accessSel, setAccessSel] = useState<string[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    display_name: "",
    badge_number: "",
    role: "operator",
  });

  const [listTypes, setListTypes] = useState<string[]>([]);
  const [listNotes, setListNotes] = useState<Record<string, string>>({});
  const [listCounts, setListCounts] = useState<Record<string, number>>({});
  const [activeList, setActiveList] = useState("");
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [listAdd, setListAdd] = useState("");
  const [integStats, setIntegStats] = useState(INTEG_STATS);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const loadUsers = useCallback(async () => {
    const data = await fetchUsers();
    setUsers(
      data.items.map((u) => ({
        ...u,
        projects: u.projects ?? null,
        status: "Active",
      })),
    );
  }, []);

  useEffect(() => {
    void fetchPlatformSettings()
      .then((data) => setSettings({ ...DEFAULT_SETTINGS, ...data }))
      .catch(() => setSettings(DEFAULT_SETTINGS));

    void fetchOverdueNotifications()
      .then((data) =>
        setOverdueCounts({
          esc: data.counts.esc,
          over: data.counts.over,
          soon: data.counts.soon,
        }),
      )
      .catch(() => undefined);

    void (async () => {
      let list: AdminUser[] = [];
      try {
        const userData = await fetchUsers();
        list = userData.items.map((u) => ({
          ...u,
          projects: u.projects ?? null,
          status: "Active",
        }));
        setUsers(list);
      } catch (err) {
        setError(errorMessage(err));
      }
      try {
        const data = await fetchAuditLog(200);
        const live = data.items.map((item) => mapAuditItem(item, list));
        setAuditRows(live.length ? live : sampleAuditRows());
      } catch {
        setAuditRows(sampleAuditRows());
      }
    })();
    void fetchPermissionMatrix()
      .then((data) => {
        if (!data.items.length) return;
        setMatrix(
          data.items.map((row) => ({
            label: row.capability,
            operator: row.operator,
            admin: row.admin,
            dept_hse: Boolean(row.dept_hse),
            project_pm: Boolean(row.receiver),
          })),
        );
      })
      .catch(() => undefined);

    void (async () => {
      try {
        const catalog = await fetchCatalog();
        setListTypes(catalog.types);
        setListNotes(catalog.notes || {});
        setActiveList((prev) => prev || catalog.types[0] || "");
        const counts: Record<string, number> = {};
        await Promise.all(
          catalog.types.map(async (type) => {
            try {
              // Sidebar count = active values (what form dropdowns show).
              const data = await fetchList(type);
              counts[type] = data.items.length;
            } catch {
              counts[type] = 0;
            }
          }),
        );
        setListCounts(counts);
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [loadUsers]);

  useEffect(() => {
    if (!activeList) {
      setListItems([]);
      return;
    }
    void fetchList(activeList, { includeInactive: true })
      .then((data) => {
        setListItems(data.items);
        setListCounts((prev) => ({
          ...prev,
          [activeList]: data.items.filter((item) => item.is_active).length,
        }));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [activeList]);

  useEffect(() => {
    if (tab !== "integ") return;
    let cancelled = false;
    void (async () => {
      try {
        const [ai, dash, speed] = await Promise.all([
          fetchCases({ record_type: "ai_camera" }),
          fetchCases({ record_type: "dashcam" }),
          fetchCases({ record_type: "speed" }),
        ]);
        if (cancelled) return;
        const year = new Date().getFullYear();
        const inYtd = (iso: string | null | undefined) =>
          Boolean(iso && iso.startsWith(String(year)));
        const aiYtd = ai.items.filter((r) => inYtd(r.date));
        const dashYtd = dash.items.filter((r) => inYtd(r.date));
        const speedYtd = speed.items.filter((r) => inYtd(r.date));
        const safelifeYes = aiYtd.filter((r) => Boolean(r.fields?.safelife_update)).length;
        const safelifeNo = aiYtd.filter((r) => r.fields?.safelife_update === false).length;
        const dashcamUpload = dashYtd.filter(
          (r) =>
            Boolean(r.fields?.itqan_upload_proof) || r.fields?.upload_to_itqan !== false,
        ).length;
        const speedUpload = speedYtd.filter(
          (r) =>
            Boolean(r.fields?.itqan_upload_proof) || r.fields?.upload_to_itqan !== false,
        ).length;
        const itqanNo =
          dashYtd.filter((r) => r.fields?.upload_to_itqan === false).length +
          speedYtd.filter((r) => r.fields?.upload_to_itqan === false).length;
        setIntegStats({
          safelifeYes,
          safelifeNo,
          dashcamUpload,
          speedUpload,
          itqanNo,
        });
      } catch {
        /* keep last / seed stats */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const auditMods = useMemo(() => {
    const set = new Set(auditRows.map((r) => r.mod));
    return ["All", ...Array.from(set)];
  }, [auditRows]);

  const filteredAudit = useMemo(() => {
    let rows = auditRows;
    if (auditMod !== "All") rows = rows.filter((r) => r.mod === auditMod);
    if (auditQ.trim()) {
      const q = auditQ.trim().toLowerCase();
      rows = rows.filter((r) =>
        `${r.by} ${r.act} ${r.caseId} ${r.det} ${r.mod}`.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [auditRows, auditMod, auditQ]);

  const auditPer = 25;
  const auditPages = Math.max(1, Math.ceil(filteredAudit.length / auditPer));
  const pageSafe = Math.min(auditPage, auditPages - 1);
  const pageRows = filteredAudit.slice(pageSafe * auditPer, pageSafe * auditPer + auditPer);

  async function refreshOverdueCounts() {
    try {
      const data = await fetchOverdueNotifications();
      setOverdueCounts({
        esc: data.counts.esc,
        over: data.counts.over,
        soon: data.counts.soon,
      });
    } catch {
      /* keep last known counts */
    }
  }

  async function persistSettings(next: Record<string, unknown>, msg = "Setting saved") {
    setSettings(next);
    setSettingsSaving(true);
    setError(null);
    try {
      const saved = await savePlatformSettings(next);
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
      notifyCasesChanged();
      notifySettingsChanged();
      await refreshOverdueCounts();
      showToast(msg);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSettingsSaving(false);
    }
  }

  function toggleSetting(key: string) {
    const next = { ...settings, [key]: !Boolean(settings[key]) };
    void persistSettings(next, "Notification setting saved");
  }

  function patchSla(patch: Partial<SlaBlock>) {
    const sla = { ...((settings.sla as SlaBlock) || {}), ...patch };
    setSettings({ ...settings, sla });
  }

  async function saveRules() {
    const sla = { ...((settings.sla as SlaBlock) || {}) };
    for (const key of ["High", "Medium", "Low"] as const) {
      const hours = Math.max(1, Number(sla[key]?.hours || 1));
      sla[key] = {
        hours,
        label:
          hours % 24 === 0
            ? `${hours / 24} day${hours / 24 > 1 ? "s" : ""}`
            : `${hours} hours`,
      };
    }
    const rawSoon = Number(sla.dueSoon ?? 0.75);
    // Accept either fraction (0.75) or percent (75) from older drafts.
    sla.dueSoon = Math.min(0.95, Math.max(0.1, rawSoon > 1 ? rawSoon / 100 : rawSoon));
    sla.escalate = Math.max(1, Number(sla.escalate ?? 2));
    await persistSettings(
      { ...settings, sla },
      "Overdue rules saved — close-out notifications updated",
    );
  }

  async function saveSchedule() {
    const rawTime = String(settings.dailyAt ?? "23:59").trim();
    const timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(rawTime);
    const h = timeMatch
      ? Math.min(23, Math.max(0, Number(timeMatch[1])))
      : 23;
    const m = timeMatch
      ? Math.min(59, Math.max(0, Number(timeMatch[2])))
      : 59;
    const dailyAt = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const weeklyDay =
      String(settings.weeklyDay ?? "Saturday").trim() || "Saturday";
    const monthlyDay = Math.min(
      10,
      Math.max(1, Number(settings.monthlyDay ?? 1) || 1),
    );
    const reportTestEmail = String(settings.reportTestEmail ?? "").trim();
    const reportHseEmail = String(settings.reportHseEmail ?? "").trim();
    const reportHseName =
      String(settings.reportHseName ?? "Dept HSE").trim() || "Dept HSE";
    const rawDist = (settings.reportDistribution as Record<string, { name?: string; email?: string }>) || {};
    const reportDistribution: Record<string, { name: string; email: string }> = {};
    for (const p of ADMIN_PROJECTS) {
      const entry = rawDist[p] || {};
      reportDistribution[p] = {
        name: String(entry.name || ADMIN_PMS[p] || `[PM name], ${p} Project`).trim(),
        email: String(entry.email || "").trim(),
      };
    }
    await persistSettings(
      {
        ...settings,
        dailyAt,
        weeklyDay,
        monthlyDay,
        reportTestEmail,
        reportHseEmail,
        reportHseName,
        reportDistribution,
      },
      `Report schedule saved · daily at ${dailyAt}`,
    );
  }

  async function onRoleChange(user: AdminUser, label: string) {
    try {
      await updateUser(user.id, {
        username: user.username,
        display_name: user.display_name,
        badge_number: user.badge_number || "",
        role: roleValue(label),
        projects: user.projects ?? null,
      });
      await loadUsers();
      showToast("Role updated");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function openAccess(user: AdminUser) {
    const all = !user.projects || user.projects.length === 0;
    setAccessEdit(user);
    setAccessAll(all);
    // When "All projects" is on, keep the list empty so unticking it
    // starts from no selection instead of every project pre-checked.
    setAccessSel(all ? [] : [...(user.projects || [])]);
  }

  async function saveAccess() {
    if (!accessEdit) return;
    const projects = accessAll ? null : accessSel;
    if (!accessAll && !projects?.length) {
      showToast("Tick at least one project");
      return;
    }
    try {
      await updateUser(accessEdit.id, {
        username: accessEdit.username,
        display_name: accessEdit.display_name,
        badge_number: accessEdit.badge_number || "",
        role: accessEdit.role,
        projects,
      });
      setAccessEdit(null);
      await loadUsers();
      showToast(`Access saved for ${accessEdit.display_name}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onDeleteUser(user: AdminUser) {
    if (!window.confirm(`Delete ${user.display_name}? Their name stays on old records.`)) return;
    try {
      await deleteUser(user.id);
      await loadUsers();
      showToast("User deleted");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onAddUser(event: FormEvent) {
    event.preventDefault();
    try {
      await createUser(newUser);
      setShowAddUser(false);
      setNewUser({
        username: "",
        password: "",
        display_name: "",
        badge_number: "",
        role: "operator",
      });
      await loadUsers();
      showToast("User added");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function refreshActiveList() {
    if (!activeList) return;
    const data = await fetchList(activeList, { includeInactive: true });
    setListItems(data.items);
    setListCounts((prev) => ({
      ...prev,
      [activeList]: data.items.filter((item) => item.is_active).length,
    }));
  }

  async function onAddListValue(event: FormEvent) {
    event.preventDefault();
    const value = listAdd.trim();
    if (!activeList || !value) return;
    setError(null);
    try {
      await addListItem(activeList, value);
      setListAdd("");
      await refreshActiveList();
      notifyListsChanged();
      showToast(`Added "${value}" — forms updated`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onDisableListItem(item: ListItem) {
    setError(null);
    try {
      await updateListItem(activeList, item.id, {
        label: item.label,
        is_active: false,
      });
      await refreshActiveList();
      notifyListsChanged();
      showToast(`Disabled "${item.label}" — hidden from form dropdowns`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onEnableListItem(item: ListItem) {
    setError(null);
    try {
      await updateListItem(activeList, item.id, {
        label: item.label,
        is_active: true,
      });
      await refreshActiveList();
      notifyListsChanged();
      showToast(`Enabled "${item.label}" — available in form dropdowns`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onDeleteListItem(item: ListItem) {
    if (
      !window.confirm(
        `Delete “${item.label}” from this list? It will be removed from form dropdowns.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteListItem(activeList, item.id);
      await refreshActiveList();
      notifyListsChanged();
      void fetchAuditLog(200)
        .then((data) => {
          const live = data.items.map((row) => mapAuditItem(row, users));
          setAuditRows(live.length ? live : sampleAuditRows());
        })
        .catch(() => undefined);
      showToast(`Deleted "${item.label}"`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function exportAudit() {
    downloadCsv("SCC_Audit_Log.csv", [
      ["Date and time", "User", "Module", "Action", "Case / serial", "Details"],
      ...filteredAudit.map((r) => [fmtAdminDT(r.at), r.by, r.mod, r.act, r.caseId, r.det]),
    ]);
  }

  const highH = slaHours(settings, "High");
  const medH = slaHours(settings, "Medium");
  const lowH = slaHours(settings, "Low");
  const soon = dueSoonPct(settings);
  const esc = escalateMult(settings);

  return (
    <section className="page adm-v1">
      {toast ? <div className="adm-toast">{toast}</div> : null}

      <section className="v1-banner">
        <div className="v1-banner-icon">
          <AdminIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>ADMINISTRATION</h1>
          <p>
            Overdue rules <i>•</i> Integrations <i>•</i> Users, lists and permissions
          </p>
        </div>
        <div className="v1-banner-actions">
          <span className="tagx red">
            <LockIcon /> Admin only
          </span>
        </div>
      </section>

      <nav className="v1-tabs" aria-label="Administration sections">
        {ADMIN_TABS.map((t) => (
          <a
            key={t.id}
            href={`#admin-${t.id}`}
            className={tab === t.id ? "on" : undefined}
            onClick={(event) => {
              event.preventDefault();
              setTab(t.id);
              setError(null);
            }}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {error ? <p className="state error">{error}</p> : null}

      {tab === "audit" ? (
        <Card
          title="Audit log"
          sub="Every action in the platform with who did it and when: records, approvals, deletions, settings, user changes and SCC HW updates. Entries cannot be edited."
        >
          <div className="adm-toolbar">
            <select
              className="sel"
              aria-label="Module"
              value={auditMod}
              onChange={(event) => {
                setAuditMod(event.target.value);
                setAuditPage(0);
              }}
            >
              {auditMods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <label className="adm-search">
              <SearchIcon />
              <input
                value={auditQ}
                onChange={(event) => {
                  setAuditQ(event.target.value);
                  setAuditPage(0);
                }}
                placeholder="User, action or case ID"
                aria-label="Search audit log"
              />
            </label>
            <span className="adm-spacer" />
            <button type="button" className="btn ghost sm" onClick={exportAudit}>
              <DownloadIcon /> Export Excel
            </button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl adm-tbl">
              <thead>
                <tr>
                  <th>Date and time</th>
                  <th>User</th>
                  <th>Module</th>
                  <th>Action</th>
                  <th>Case / serial</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length ? (
                  pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="num nowrap">{fmtAdminDT(r.at)}</td>
                      <td>{r.by}</td>
                      <td>
                        <span className="tagx">{r.mod}</span>
                      </td>
                      <td>{r.act}</td>
                      <td className="id">{r.caseId}</td>
                      <td className="muted adm-det">{r.det}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="empty">
                      No entries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="adm-pager">
            <span>
              {filteredAudit.length} entries · page {pageSafe + 1} of {auditPages}
            </span>
            <button
              type="button"
              className="btn ghost sm"
              disabled={pageSafe === 0}
              onClick={() => setAuditPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={pageSafe >= auditPages - 1}
              onClick={() => setAuditPage((p) => Math.min(auditPages - 1, p + 1))}
            >
              Next
            </button>
          </div>
        </Card>
      ) : null}

      {tab === "rules" ? (
        <div className="v1-grid g2 adm-g2">
          <Card
            title="Close-out deadline by risk level"
            sub="Applies to every unclosed observation and violation. Open and Under Review both count until the record is Closed."
          >
            <div className="tbl-wrap">
              <table className="tbl adm-tbl">
                <thead>
                  <tr>
                    <th>Risk level</th>
                    <th className="n">Deadline (hours)</th>
                    <th>Reminder</th>
                    <th>Overdue</th>
                    <th>Escalation</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["High", highH, "High Risk"],
                      ["Medium", medH, "Medium Risk"],
                      ["Low", lowH, "Low Risk"],
                    ] as const
                  ).map(([key, hours, label]) => (
                    <tr key={key}>
                      <td>
                        <span className={`rk ${key}`}>{label}</span>
                      </td>
                      <td className="n">
                        <input
                          className="inp adm-num"
                          type="number"
                          min={1}
                          value={hours}
                          aria-label={`${key} deadline hours`}
                          onChange={(event) => {
                            const sla = {
                              ...((settings.sla as SlaBlock) || {}),
                              [key]: {
                                ...(((settings.sla as SlaBlock) || {})[key] || {}),
                                hours: Number(event.target.value) || 1,
                              },
                            };
                            setSettings({ ...settings, sla });
                          }}
                        />
                      </td>
                      <td className="muted">
                        at {soon}% ({Math.round((hours * soon) / 100)} h)
                      </td>
                      <td className="muted">after {hours} h</td>
                      <td className="muted">
                        after {hours * esc} h → Dept HSE
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <span className="rk NA">SOS alert</span>
                    </td>
                    <td className="n">2</td>
                    <td className="muted">at 90 min</td>
                    <td className="muted">after 2 h</td>
                    <td className="muted">after 4 h → Dept HSE</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="adm-fgrid">
              <label className="fld">
                &quot;Due soon&quot; reminder at (% of deadline)
                <input
                  type="number"
                  min={10}
                  max={95}
                  value={soon}
                  onChange={(event) =>
                    patchSla({ dueSoon: (Number(event.target.value) || 75) / 100 })
                  }
                />
              </label>
              <label className="fld">
                Escalate after (× deadline)
                <input
                  type="number"
                  min={1}
                  max={5}
                  step={0.5}
                  value={esc}
                  onChange={(event) =>
                    patchSla({ escalate: Number(event.target.value) || 2 })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="btn primary"
              style={{ alignSelf: "flex-start" }}
              disabled={settingsSaving}
              onClick={() => void saveRules()}
            >
              <CheckIcon /> {settingsSaving ? "Saving…" : "Save rules"}
            </button>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              Saved rules apply immediately to open / under-review records and the
              notification bell.
            </p>
          </Card>

          <Card title="Who gets notified">
            {(
              [
                [
                  "notifyOperator",
                  "Operator who registered the record",
                  "In-app bell and email when due soon and when overdue",
                ],
                [
                  "notifyAdmin",
                  "SCC Admin",
                  "In-app bell and email when overdue; daily digest of all overdue items",
                ],
                [
                  "notifyHSE",
                  "Department HSE",
                  "Email on escalation, and in the weekly report",
                ],
              ] as const
            ).map(([key, title, sub]) => (
              <div key={key} className="adm-toggle-row">
                <Switch
                  on={Boolean(settings[key])}
                  label={title}
                  onToggle={() => toggleSetting(key)}
                />
                <div>
                  <b>{title}</b>
                  <br />
                  <small className="muted">{sub}</small>
                </div>
              </div>
            ))}
            <div className="adm-note">
              <BellIcon /> Right now: <b>{overdueCounts.esc}</b> escalated,{" "}
              <b>{overdueCounts.over}</b> overdue, <b>{overdueCounts.soon}</b> due soon.
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "integ" ? (
        <div className="v1-grid g2 adm-g2">
          <Card
            title={
              <>
                <span className="logo-chip sl">SafeLife</span> AI Camera observations
              </>
            }
          >
            {(
              [
                [
                  "safelifeAsk",
                  "Ask the Operator for each observation",
                  "A Yes / No choice on the registration form. When No, a reason is required.",
                ],
                [
                  "safelifeDefault",
                  "Default answer: Update in SafeLife",
                  "Pre-selects Yes on the form. Yes requires a SafeLife reference at register; No leaves status Pending until close-out or Closed.",
                ],
              ] as const
            ).map(([key, title, sub]) => (
              <div key={key} className="adm-toggle-row">
                <Switch
                  on={Boolean(settings[key])}
                  label={title}
                  onToggle={() => toggleSetting(key)}
                />
                <div>
                  <b>{title}</b>
                  <br />
                  <small className="muted">{sub}</small>
                </div>
              </div>
            ))}
            <div className="adm-kv">
              <div>
                <span>Observations to update in SafeLife (YTD)</span>
                <b>{integStats.safelifeYes.toLocaleString()}</b>
              </div>
              <div>
                <span>Not updated, with a reason</span>
                <b>{integStats.safelifeNo.toLocaleString()}</b>
              </div>
            </div>
          </Card>

          <Card
            title={
              <>
                <span className="logo-chip itq">
                  ITQ<em>A</em>N
                </span>{" "}
                Dashcam and over-speeding
              </>
            }
          >
            {(
              [
                [
                  "itqanAsk",
                  "Ask the Operator for each violation",
                  "A Yes / No choice on the Dashcam and Speed forms and again at Confirm Driver & Submit.",
                ],
                [
                  "itqanDefault",
                  "Default answer: Upload to ITQAN",
                  "When Yes, the ITQAN proof image is required. When No, the operator types a free-text reason. Uploaded violations are added to the ITQAN log.",
                ],
              ] as const
            ).map(([key, title, sub]) => (
              <div key={key} className="adm-toggle-row">
                <Switch
                  on={Boolean(settings[key])}
                  label={title}
                  onToggle={() => toggleSetting(key)}
                />
                <div>
                  <b>{title}</b>
                  <br />
                  <small className="muted">{sub}</small>
                </div>
              </div>
            ))}
            <div className="adm-kv">
              <div>
                <span>Dashcam violations to upload (YTD)</span>
                <b>{integStats.dashcamUpload.toLocaleString()}</b>
              </div>
              <div>
                <span>Speed and ROW violations to upload (YTD)</span>
                <b>{integStats.speedUpload.toLocaleString()}</b>
              </div>
              <div>
                <span>Not uploaded, with a reason</span>
                <b>{integStats.itqanNo.toLocaleString()}</b>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "users" ? (
        <div className="v1-grid g2 adm-g2">
          <Card
            title="Users and roles"
            sub="A deleted user keeps their name on old records"
            actions={
              <button type="button" className="btn ghost sm" onClick={() => setShowAddUser(true)}>
                <PlusIcon /> Add user
              </button>
            }
          >
            <div className="tbl-wrap">
              <table className="tbl adm-tbl">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Badge</th>
                    <th>Role</th>
                    <th>Project access</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const all = !u.projects || u.projects.length === 0;
                    return (
                      <tr key={u.id}>
                        <td>
                          <b>{formatUserLabel(u)}</b>
                        </td>
                        <td className="mono">{u.badge_number || "—"}</td>
                        <td>
                          <select
                            className="sel"
                            aria-label={`Role of ${u.display_name}`}
                            value={roleLabel(u.role)}
                            onChange={(event) => void onRoleChange(u, event.target.value)}
                            disabled={
                              u.role === "admin" && u.id !== currentUser?.id
                            }
                          >
                            {ADMIN_ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="adm-access">
                            {all ? (
                              <span className="tagx green">All projects</span>
                            ) : (
                              u.projects?.map((p) => (
                                <span key={p} className="tagx">
                                  {p}
                                </span>
                              ))
                            )}
                            <button
                              type="button"
                              className="linkbtn"
                              onClick={() => openAccess(u)}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className="tagx green">{u.status || "Active"}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn sm ghost-red"
                            onClick={() => void onDeleteUser(u)}
                            disabled={u.id === currentUser?.id}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Roles and permissions"
            sub="Closing and deleting are logged with the Admin’s name"
          >
            <div className="tbl-wrap">
              <table className="tbl adm-tbl adm-matrix">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Permission</th>
                    <th>Operator</th>
                    <th>Admin</th>
                    <th>Dept HSE</th>
                    <th>Project PM</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr key={row.label}>
                      <td style={{ textAlign: "left" }}>{row.label}</td>
                      {(
                        [
                          row.operator,
                          row.admin,
                          row.dept_hse,
                          row.project_pm,
                        ] as boolean[]
                      ).map((ok, i) => (
                        <td key={i}>
                          {ok ? (
                            <span className="adm-ok">
                              <CheckIcon />
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "lists" ? (
        <div className="adm-lists">
          <Card title="Lists">
            <div className="adm-list-nav">
              {listTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`adm-list-chip${activeList === type ? " on" : ""}`}
                  onClick={() => setActiveList(type)}
                >
                  <span>{LIST_LABEL[type] ?? type}</span>
                  <span className="n">{listCounts[type] ?? 0}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card
            title={LIST_LABEL[activeList] ?? activeList ?? "List"}
            sub={
              listNotes[activeList] ||
              "Values appear in the forms straight away. Disabling keeps old records unchanged."
            }
          >
            <form className="adm-toolbar" onSubmit={(event) => void onAddListValue(event)}>
              <input
                className="inp"
                style={{ flex: 1 }}
                placeholder="Add a value"
                value={listAdd}
                onChange={(event) => setListAdd(event.target.value)}
              />
              <button type="submit" className="btn dark sm">
                <PlusIcon /> Add
              </button>
            </form>
            <div className="tbl-wrap">
              <table className="tbl adm-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Value</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listItems.map((item, i) => (
                    <tr key={item.id}>
                      <td className="mono">{i + 1}</td>
                      <td>{item.label}</td>
                      <td>
                        <span className={`tagx${item.is_active ? " green" : ""}`}>
                          {item.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td>
                        <div className="adm-list-row-actions">
                          {item.is_active ? (
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => void onDisableListItem(item)}
                            >
                              Disable
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn dark sm"
                              onClick={() => void onEnableListItem(item)}
                            >
                              Enable
                            </button>
                          )}
                          <button
                            type="button"
                            className="adm-icon-btn danger"
                            aria-label={`Delete ${item.label}`}
                            title="Delete"
                            onClick={() => void onDeleteListItem(item)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "sched" ? (
        <Card title="Automatic report schedule">
          <div className="adm-sched">
            <div className="adm-sched-col">
              <label className="fld">
                Daily report generated at
                <input
                  type="time"
                  step={60}
                  value={(() => {
                    const raw = String(settings.dailyAt ?? "23:59").trim();
                    const match = /^(\d{1,2}):(\d{2})/.exec(raw);
                    if (!match) return "23:59";
                    return `${String(Math.min(23, Number(match[1]))).padStart(2, "0")}:${String(Math.min(59, Number(match[2]))).padStart(2, "0")}`;
                  })()}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      dailyAt: event.target.value.slice(0, 5) || "23:59",
                    })
                  }
                />
                <span className="hint">
                  Reports page uses this time for daily generation
                </span>
              </label>
              <label className="fld">
                Monthly report issued on day
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={Number(settings.monthlyDay ?? 1)}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      monthlyDay: Number(event.target.value) || 1,
                    })
                  }
                />
                <span className="hint">
                  Month becomes Awaiting PM signature on this day of the next month
                </span>
              </label>
              <button
                type="button"
                className="btn primary"
                style={{ alignSelf: "flex-start" }}
                disabled={settingsSaving}
                onClick={() => void saveSchedule()}
              >
                <CheckIcon /> Save schedule
              </button>
            </div>
            <div className="adm-sched-col">
              <label className="fld">
                Weekly report compiled on
                <select
                  value={String(settings.weeklyDay ?? "Saturday")}
                  onChange={(event) =>
                    setSettings({ ...settings, weeklyDay: event.target.value })
                  }
                >
                  {["Saturday", "Sunday", "Thursday"].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <span className="hint">Weeks run Sunday to Saturday</span>
              </label>
              <label className="fld">
                Test email override
                <input
                  type="email"
                  placeholder="rose.subait@binquraya.com"
                  value={String(settings.reportTestEmail ?? "")}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      reportTestEmail: event.target.value,
                    })
                  }
                />
                <span className="hint">
                  When set, compile-ready sign notices (and Issue emails) go here
                  instead of HSE / Project PM addresses
                </span>
              </label>
              <label className="fld">
                Dept HSE email
                <input
                  type="email"
                  placeholder="hse@example.com"
                  value={String(settings.reportHseEmail ?? "")}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      reportHseEmail: event.target.value,
                    })
                  }
                />
                <span className="hint">
                  Weekly compile notices go here; monthly notices also include HSE
                </span>
              </label>
              <div className="fld">
                <span className="adm-dist-label">Distribution · Project PM</span>
                <div className="adm-dist-list">
                  {ADMIN_PROJECTS.map((p) => {
                    const dist =
                      (settings.reportDistribution as Record<
                        string,
                        { name?: string; email?: string }
                      >) || {};
                    const entry = dist[p] || {};
                    return (
                      <div key={p} className="adm-dist-row">
                        <span className="adm-dist-project">{p}</span>
                        <input
                          type="text"
                          aria-label={`${p} PM name`}
                          placeholder={ADMIN_PMS[p]}
                          value={String(entry.name ?? ADMIN_PMS[p] ?? "")}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              reportDistribution: {
                                ...dist,
                                [p]: {
                                  name: event.target.value,
                                  email: String(entry.email || ""),
                                },
                              },
                            })
                          }
                        />
                        <input
                          type="email"
                          aria-label={`${p} PM email`}
                          placeholder="pm@example.com"
                          value={String(entry.email ?? "")}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              reportDistribution: {
                                ...dist,
                                [p]: {
                                  name: String(entry.name || ADMIN_PMS[p] || ""),
                                  email: event.target.value,
                                },
                              },
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {accessEdit ? (
        <div
          className="adm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="adm-access-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAccessEdit(null);
          }}
        >
          <div className="adm-modal-card adm-access-card">
            <h3 id="adm-access-title">Project access · {formatUserLabel(accessEdit)}</h3>
            <p className="adm-access-copy">
              The user sees records, dashboards, reports, weather, contacts and SCC HW only for
              the projects ticked here.
            </p>
            <label className="adm-check-all">
              <input
                type="checkbox"
                checked={accessAll}
                onChange={(event) => {
                  const on = event.target.checked;
                  setAccessAll(on);
                  // Unticking All clears picks so you choose projects manually.
                  setAccessSel([]);
                }}
              />
              <span>All projects</span>
            </label>
            <div className="adm-access-grid">
              {ACCESS_PROJECTS.map((p) => {
                const checked = accessAll || accessSel.includes(p);
                return (
                  <label key={p} className={accessAll ? "is-locked" : undefined}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={accessAll}
                      onChange={(event) => {
                        setAccessSel((prev) =>
                          event.target.checked
                            ? [...prev, p]
                            : prev.filter((x) => x !== p),
                        );
                      }}
                    />
                    <span>{p}</span>
                  </label>
                );
              })}
            </div>
            <div className="adm-modal-actions">
              <button
                type="button"
                className="btn adm-access-cancel"
                onClick={() => setAccessEdit(null)}
              >
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={() => void saveAccess()}>
                Save access
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showAddUser ? (
        <div className="adm-modal" role="dialog" aria-modal="true">
          <form className="adm-modal-card" onSubmit={(event) => void onAddUser(event)}>
            <h3>Add user</h3>
            <div className="adm-fgrid">
              <label className="fld">
                Name
                <input
                  required
                  value={newUser.display_name}
                  onChange={(event) =>
                    setNewUser({ ...newUser, display_name: event.target.value })
                  }
                />
              </label>
              <label className="fld">
                Username
                <input
                  required
                  value={newUser.username}
                  onChange={(event) =>
                    setNewUser({ ...newUser, username: event.target.value })
                  }
                />
              </label>
              <label className="fld">
                Badge
                <input
                  value={newUser.badge_number}
                  onChange={(event) =>
                    setNewUser({ ...newUser, badge_number: event.target.value })
                  }
                />
              </label>
              <label className="fld">
                Password
                <input
                  required
                  type="password"
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser({ ...newUser, password: event.target.value })
                  }
                />
              </label>
              <label className="fld">
                Role
                <select
                  value={roleLabel(newUser.role)}
                  onChange={(event) =>
                    setNewUser({ ...newUser, role: roleValue(event.target.value) })
                  }
                >
                  {ADMIN_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="adm-modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowAddUser(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Add user
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
