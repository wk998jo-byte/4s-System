import { useEffect, useMemo, useState } from "react";
import bqLogo from "../assets/bq-logo-white.png";
import { fetchKeyPersonnel, saveKeyPersonnel } from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { useProjectAccess } from "../lib/useProjectAccess";
import {
  ARAMCO_EMERGENCY,
  CONTACTS_BY_PROJECT,
  CONTACT_PROJECTS,
  type ContactGroup,
  type ContactPerson,
  type ContactProjectId,
  type ProjectContacts,
} from "../lib/contactsData";

function asPerson(raw: unknown): ContactPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    name: String(row.name ?? ""),
    position: String(row.position ?? ""),
    number: String(row.number ?? ""),
    email: String(row.email ?? ""),
  };
}

function asGroup(raw: unknown): ContactGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const group = raw as Record<string, unknown>;
  const rows = Array.isArray(group.rows)
    ? group.rows.map(asPerson).filter((r): r is ContactPerson => Boolean(r))
    : [];
  return {
    name: String(group.name ?? "Contacts"),
    ...(group.red ? { red: true } : {}),
    rows,
  };
}

function asPack(projectId: ContactProjectId, raw: unknown): ProjectContacts {
  const fallback = structuredClone(CONTACTS_BY_PROJECT[projectId]);
  if (!raw || typeof raw !== "object") return fallback;
  const pack = raw as Record<string, unknown>;
  const groups = Array.isArray(pack.groups)
    ? pack.groups.map(asGroup).filter((g): g is ContactGroup => Boolean(g))
    : fallback.groups;
  const hospitals = Array.isArray(pack.hospitals)
    ? pack.hospitals
        .filter((h): h is Record<string, unknown> => Boolean(h) && typeof h === "object")
        .map((h) => ({
          name: String(h.name ?? ""),
          number: String(h.number ?? ""),
        }))
    : fallback.hospitals;
  return {
    ...fallback,
    id: String(pack.id ?? projectId),
    division: pack.division != null ? String(pack.division) : fallback.division,
    title: String(pack.title ?? fallback.title),
    contract: pack.contract != null ? String(pack.contract) : fallback.contract,
    client: String(pack.client ?? fallback.client),
    hotline: String(pack.hotline ?? fallback.hotline ?? ""),
    placeholder: Boolean(pack.placeholder ?? fallback.placeholder),
    groups: groups.length ? groups : fallback.groups,
    hospitals: hospitals.length ? hospitals : fallback.hospitals,
    emergency:
      pack.emergency && typeof pack.emergency === "object"
        ? (pack.emergency as ProjectContacts["emergency"])
        : fallback.emergency,
  };
}

function mergePacks(remote: Record<string, unknown> | null | undefined) {
  const next = {} as Record<ContactProjectId, ProjectContacts>;
  for (const id of CONTACT_PROJECTS) {
    next[id] = asPack(id, remote?.[id]);
  }
  return next;
}

function PhoneIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5 15V5a2 2 0 0 1 2-2h10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyBtn({ value, onCopied }: { value: string; onCopied: (v: string) => void }) {
  if (!value || value.startsWith("[")) return null;
  return (
    <button
      type="button"
      className="kp-copy"
      aria-label={`Copy ${value}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => onCopied(value),
          () => onCopied(value),
        );
      }}
    >
      <CopyIcon />
    </button>
  );
}

function ContactTable({
  group,
  editing,
  onChange,
  onCopied,
}: {
  group: ContactGroup;
  editing: boolean;
  onChange: (row: number, col: 0 | 1 | 2 | 3, value: string) => void;
  onCopied: (v: string) => void;
}) {
  return (
    <div className="kp-section">
      <div className={`kp-ct-head${group.red ? " red" : ""}`}>{group.name}</div>
      <div className="tbl-wrap kp-tbl-wrap">
        <table className="v1-tbl kp-tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Position</th>
              <th>Mobile</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row, ri) => (
              <tr key={`${group.name}-${ri}`}>
                <td>
                  {editing ? (
                    <input
                      className="kp-edit"
                      value={row.name}
                      onChange={(e) => onChange(ri, 0, e.target.value)}
                    />
                  ) : (
                    <b>{row.name}</b>
                  )}
                </td>
                <td>
                  {editing ? (
                    <input
                      className="kp-edit"
                      value={row.position}
                      onChange={(e) => onChange(ri, 1, e.target.value)}
                    />
                  ) : (
                    row.position
                  )}
                </td>
                <td>
                  {editing ? (
                    <input
                      className="kp-edit mono"
                      value={row.number}
                      onChange={(e) => onChange(ri, 2, e.target.value)}
                    />
                  ) : (
                    <span className="kp-num">
                      <span className="mono">{row.number || "—"}</span>
                      <CopyBtn value={row.number} onCopied={onCopied} />
                    </span>
                  )}
                </td>
                <td>
                  {editing ? (
                    <input
                      className="kp-edit"
                      value={row.email || ""}
                      onChange={(e) => onChange(ri, 3, e.target.value)}
                      placeholder="Email"
                    />
                  ) : (
                    <span className="muted">{row.email || ""}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function defaultContactProject(
  accessProjects: string[],
  singleProject: string | null,
  hasAllProjectAccess: boolean,
): ContactProjectId {
  const catalog = CONTACT_PROJECTS as readonly string[];
  if (singleProject && catalog.includes(singleProject)) {
    return singleProject as ContactProjectId;
  }
  if (hasAllProjectAccess) return CONTACT_PROJECTS[0]!;
  const firstAssigned = accessProjects.find((p) => catalog.includes(p));
  if (firstAssigned) return firstAssigned as ContactProjectId;
  return CONTACT_PROJECTS[0]!;
}

export function ContactsScreen() {
  const { user } = useAuth();
  const canWrite = Boolean(user?.capabilities.manage_contacts || user?.role === "admin");
  const projectAccess = useProjectAccess(CONTACT_PROJECTS);
  const initialProject = useMemo(
    () =>
      defaultContactProject(
        projectAccess.accessProjects,
        projectAccess.singleProject,
        projectAccess.hasAllProjectAccess,
      ),
    [
      projectAccess.accessProjects,
      projectAccess.singleProject,
      projectAccess.hasAllProjectAccess,
    ],
  );
  const [project, setProject] = useState<ContactProjectId>(initialProject);
  const [packs, setPacks] = useState(() => mergePacks(null));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchKeyPersonnel();
        if (cancelled) return;
        setPacks(mergePacks(data.packs as Record<string, unknown>));
      } catch {
        if (!cancelled) setPacks(mergePacks(null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep packs in sync when a new project tab is added (e.g. Dhahran).
  useEffect(() => {
    setPacks((prev) => {
      let changed = false;
      const next = { ...prev } as Record<ContactProjectId, ProjectContacts>;
      for (const id of CONTACT_PROJECTS) {
        if (!next[id]) {
          next[id] = structuredClone(CONTACTS_BY_PROJECT[id]);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [CONTACT_PROJECTS.length]);

  useEffect(() => {
    if (projectAccess.hasAllProjectAccess) return;
    setProject(initialProject);
    setEditing(false);
  }, [initialProject, projectAccess.hasAllProjectAccess]);

  const pack = packs[project] ?? CONTACTS_BY_PROJECT[project];
  const emergency = {
    landline: pack.emergency?.landline || ARAMCO_EMERGENCY.landline,
    mobile: pack.emergency?.mobile || ARAMCO_EMERGENCY.mobile,
    areas: pack.emergency?.areas?.length
      ? pack.emergency.areas
      : ARAMCO_EMERGENCY.areas,
  };

  function toast(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2200);
  }

  async function finishEditing() {
    if (saving) return;
    setSaving(true);
    try {
      const data = await saveKeyPersonnel(packs as unknown as Record<string, unknown>);
      setPacks(mergePacks(data.packs as Record<string, unknown>));
      setEditing(false);
      toast("Contacts saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save contacts");
    } finally {
      setSaving(false);
    }
  }

  function updateCell(gi: number, ri: number, col: 0 | 1 | 2 | 3, value: string) {
    setPacks((prev) => {
      const next = structuredClone(prev);
      const row = next[project].groups[gi]?.rows[ri];
      if (!row) return prev;
      if (col === 0) row.name = value;
      if (col === 1) row.position = value;
      if (col === 2) row.number = value;
      if (col === 3) row.email = value;
      return next;
    });
  }

  function updateHotline(value: string) {
    setPacks((prev) => {
      const next = structuredClone(prev) as Record<ContactProjectId, ProjectContacts>;
      next[project].hotline = value;
      return next;
    });
  }

  function updateMeta(
    field: "division" | "title" | "contract",
    value: string,
  ) {
    setPacks((prev) => {
      const next = structuredClone(prev) as Record<ContactProjectId, ProjectContacts>;
      next[project][field] = value;
      return next;
    });
  }

  function addRow(gi: number) {
    setPacks((prev) => {
      const next = structuredClone(prev);
      next[project].groups[gi]?.rows.push({
        name: "[Name]",
        position: "[Position]",
        number: "[Number]",
        email: "",
      });
      return next;
    });
  }

  const hotlineDisplay = pack.hotline?.trim()
    ? pack.hotline.trim()
    : editing
      ? ""
      : "[Hotline number]";

  return (
    <section className="page kp-v1">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <PhoneIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>
            KEY PERSONNEL <em>&amp; EMERGENCY CONTACTS</em>
          </h1>
          <p>
            One contact list per project <i>•</i> Updated by Admin <i>•</i> Visible to every user
          </p>
        </div>
        <div className="v1-banner-actions">
          {canWrite ? (
            <button
              type="button"
              className={`btn kp-edit-btn${editing ? " is-done" : ""}`}
              disabled={saving}
              onClick={() => {
                if (editing) {
                  void finishEditing();
                  return;
                }
                setEditing(true);
              }}
            >
              <PenIcon />
              {editing ? (saving ? "Saving…" : "Done editing") : "Edit contacts"}
            </button>
          ) : null}
        </div>
      </section>

      <div className="reports-tabs kp-tabs">
        {CONTACT_PROJECTS.map((id) => (
          <button
            key={id}
            type="button"
            className={project === id ? "on" : undefined}
            onClick={() => {
              setProject(id);
              setEditing(false);
            }}
          >
            {id}
          </button>
        ))}
      </div>

      {flash ? <p className="hw-flash">{flash}</p> : null}

      <section className="kp-pack">
        <div className="kp-pack-banner">
          <img src={bqLogo} alt="Bin Quraya" className="kp-logo" />
          <div className="kp-pack-title">
            {editing ? (
              <>
                <input
                  className="kp-edit kp-banner-edit"
                  value={pack.division || ""}
                  placeholder="Division line"
                  onChange={(e) => updateMeta("division", e.target.value)}
                />
                <input
                  className="kp-edit kp-banner-edit is-title"
                  value={pack.title}
                  placeholder="Project title"
                  onChange={(e) => updateMeta("title", e.target.value)}
                />
                <input
                  className="kp-edit kp-banner-edit"
                  value={pack.contract || ""}
                  placeholder="Contract no."
                  onChange={(e) => updateMeta("contract", e.target.value)}
                />
              </>
            ) : (
              <>
                {pack.division ? <p className="kp-division">{pack.division}</p> : null}
                <h2>{pack.title}</h2>
                {pack.contract ? <p className="kp-contract">{pack.contract}</p> : null}
              </>
            )}
          </div>
        </div>

        <div className="kp-hotline">
          <PhoneIcon />
          <span className="kp-hotline-label">Bin Quraya 24/7 Hotline</span>
          {editing ? (
            <input
              className="kp-edit kp-hotline-edit mono"
              value={pack.hotline || ""}
              placeholder="Enter hotline number"
              onChange={(e) => updateHotline(e.target.value)}
              aria-label="Bin Quraya 24/7 hotline number"
            />
          ) : (
            <strong className="mono kp-hotline-num">
              {hotlineDisplay}
              <CopyBtn value={pack.hotline || ""} onCopied={(v) => toast(`Copied ${v}`)} />
            </strong>
          )}
        </div>

        <div className="kp-pack-body">
          {(pack.groups ?? []).map((group, gi) => (
            <div key={`${group.name}-${gi}`}>
              <ContactTable
                group={group}
                editing={editing}
                onChange={(ri, col, value) => updateCell(gi, ri, col, value)}
                onCopied={(v) => toast(`Copied ${v}`)}
              />
              {editing ? (
                <button type="button" className="btn ghost sm kp-add-row" onClick={() => addRow(gi)}>
                  + Add contact
                </button>
              ) : null}
            </div>
          ))}

          <div className="kp-grid g2">
            <div>
              <div className="kp-ct-head">Saudi Aramco emergency contact number</div>
              <div className="kp-card">
                <div className="kp-badges">
                  <span className="kp-badge red">Dial from landline {emergency.landline}</span>
                  <span className="kp-badge amber">Dial from mobile {emergency.mobile}</span>
                </div>
                <div className="kp-ecall">
                  {emergency.areas.map((a) => (
                    <div key={a.label}>
                      <small>{a.label}</small>
                      <b title={a.number}>
                        <span>{a.number}</span>
                        <CopyBtn value={a.number} onCopied={(v) => toast(`Copied ${v}`)} />
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <div className="kp-ct-head">Saudi Arabian Government emergency number</div>
              <div className="kp-card">
                <div className="kp-ecall">
                  {ARAMCO_EMERGENCY.gov.map((a) => (
                    <div key={a.label}>
                      <small>{a.label}</small>
                      <b>
                        {a.number}
                        <CopyBtn value={a.number} onCopied={(v) => toast(`Copied ${v}`)} />
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="kp-grid g3">
            <div>
              <div className="kp-ct-head green">Action in case of an emergency</div>
              <div className="kp-card">
                <ol>
                  {ARAMCO_EMERGENCY.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
            </div>
            <div>
              <div className="kp-ct-head green">When the operator answers</div>
              <div className="kp-card">
                <ol>
                  {ARAMCO_EMERGENCY.operator.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <small className="muted">{ARAMCO_EMERGENCY.aramcoNote}</small>
              </div>
            </div>
            <div>
              <div className="kp-ct-head amber">Hospital emergency number</div>
              <div className="kp-card">
                <div className="kp-hosp">
                  {(pack.hospitals ?? []).map((h) => (
                    <div key={`${h.name}-${h.number}`}>
                      <span>{h.name}</span>
                      <b className="mono">
                        {h.number}
                        <CopyBtn value={h.number} onCopied={(v) => toast(`Copied ${v}`)} />
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
