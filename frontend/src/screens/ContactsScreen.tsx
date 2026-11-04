import { useEffect, useMemo, useState } from "react";
import bqLogo from "../assets/bq-logo-white.png";
import { useAuth } from "../auth/AuthContext";
import { useProjectAccess } from "../lib/useProjectAccess";
import {
  ARAMCO_EMERGENCY,
  CONTACTS_BY_PROJECT,
  CONTACT_PROJECTS,
  type ContactProjectId,
} from "../lib/contactsData";

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
  group: ProjectContacts["groups"][number];
  editing: boolean;
  onChange: (row: number, col: 0 | 1 | 2, value: string) => void;
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
              <th>Contact number</th>
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
                      <span className="mono">{row.number}</span>
                      <CopyBtn value={row.number} onCopied={onCopied} />
                    </span>
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
): ContactProjectId {
  const catalog = CONTACT_PROJECTS as readonly string[];
  if (singleProject && catalog.includes(singleProject)) {
    return singleProject as ContactProjectId;
  }
  const firstAssigned = accessProjects.find((p) => catalog.includes(p));
  if (firstAssigned) return firstAssigned as ContactProjectId;
  return "Jafurah";
}

export function ContactsScreen() {
  const { user } = useAuth();
  const canWrite = Boolean(user?.capabilities.manage_contacts || user?.role === "admin");
  const projectAccess = useProjectAccess([...CONTACT_PROJECTS]);
  const initialProject = useMemo(
    () =>
      defaultContactProject(
        projectAccess.accessProjects,
        projectAccess.singleProject,
      ),
    [projectAccess.accessProjects, projectAccess.singleProject],
  );
  const [project, setProject] = useState<ContactProjectId>(initialProject);
  const [packs, setPacks] = useState(() => structuredClone(CONTACTS_BY_PROJECT));
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    setProject(initialProject);
    setEditing(false);
  }, [initialProject]);

  const pack = packs[project];

  function toast(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2200);
  }

  function updateCell(gi: number, ri: number, col: 0 | 1 | 2, value: string) {
    setPacks((prev) => {
      const next = structuredClone(prev);
      const row = next[project].groups[gi]?.rows[ri];
      if (!row) return prev;
      if (col === 0) row.name = value;
      if (col === 1) row.position = value;
      if (col === 2) row.number = value;
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
      });
      return next;
    });
  }

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
              onClick={() => {
                if (editing) toast("Contacts saved");
                setEditing((v) => !v);
              }}
            >
              <PenIcon />
              {editing ? "Done editing" : "Edit contacts"}
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
            <h2>{pack.client.toUpperCase()}</h2>
            <p>{pack.title}</p>
          </div>
          <span className="kp-tag">Saudi Aramco</span>
        </div>

        <div className="kp-pack-body">
          {pack.groups.map((group, gi) => (
            <div key={group.name}>
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
                  <span className="kp-badge red">Dial from landline {ARAMCO_EMERGENCY.landline}</span>
                  <span className="kp-badge amber">
                    Dial from mobile {ARAMCO_EMERGENCY.mobile}
                  </span>
                </div>
                <div className="kp-ecall">
                  {ARAMCO_EMERGENCY.areas.map((a) => (
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
                      <b>{a.number}</b>
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
                  {pack.hospitals.map((h) => (
                    <div key={h.name}>
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
