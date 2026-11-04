import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  deleteCase,
  fetchCase,
  notifyCasesChanged,
  resolveMediaUrl,
  updateItqanStatus,
  type CaseDetail,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { href } from "../lib/routing";
import { StatusPill, useList } from "./shared";

const MON3 = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function field(row: CaseDetail, key: string): string {
  const v = row.fields?.[key];
  return v == null ? "" : String(v);
}

function formatDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON3[(m ?? 1) - 1]} ${y}`;
}

function formatDt(iso: string | undefined | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function escXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function snapUri(row: CaseDetail): string {
  const W = 640;
  const H = 400;
  const ref = escXml(field(row, "itqan_ref") || row.case_id);
  const viol = escXml((field(row, "violation_type") || "ITQAN").slice(0, 40));
  const driver = escXml((field(row, "driver_name") || "—").slice(0, 36));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#f7f5f2"/>
    <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="12" fill="#fff" stroke="#e4ddd4"/>
    <text x="48" y="72" font-family="Georgia,serif" font-size="28" font-weight="700" fill="#1a1a1a">ITQAN</text>
    <rect x="48" y="96" width="${W - 96}" height="48" rx="8" fill="#1f7a3a"/>
    <text x="64" y="126" font-family="IBM Plex Sans,sans-serif" font-size="16" font-weight="600" fill="#fff">Violation uploaded successfully — Ref ${ref}</text>
    <text x="48" y="180" font-family="IBM Plex Sans,sans-serif" font-size="14" fill="#666">Violation</text>
    <text x="48" y="204" font-family="IBM Plex Sans,sans-serif" font-size="18" font-weight="700" fill="#111">${viol}</text>
    <text x="48" y="248" font-family="IBM Plex Sans,sans-serif" font-size="14" fill="#666">Driver</text>
    <text x="48" y="272" font-family="IBM Plex Sans,sans-serif" font-size="16" fill="#111">${driver}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const c = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: size,
    height: size,
    "aria-hidden": true,
  };
  if (name === "x")
    return (
      <svg {...c}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...c}>
        <path d="M5 12l4 4L19 6" />
      </svg>
    );
  return null;
}

type PhotoItem = { title: string; meta: string; src: string };

export function ItqanRecordDrawer({
  caseId,
  onClose,
  onChanged,
}: {
  caseId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const canManageItqan = Boolean(
    user?.capabilities.approve_reject || user?.capabilities.delete_record,
  );
  const canDelete = Boolean(user?.capabilities.delete_record);
  const statuses = useList("itqan_status");
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusId, setStatusId] = useState("");
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null);

  useEffect(() => {
    if (!caseId) {
      setRow(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchCase(caseId)
      .then((data) => {
        if (!cancelled) setRow(data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    if (!row) return;
    const label = field(row, "itqan_status");
    const match = statuses.items.find((i) => i.label === label);
    setStatusId(match?.id || "");
  }, [row, statuses.items]);

  const photos = useMemo(() => {
    if (!row) return [] as PhotoItem[];
    const src = resolveMediaUrl(field(row, "itqan_upload_proof")) || snapUri(row);
    return [
      {
        title: "ITQAN record",
        meta: field(row, "itqan_ref") || row.case_id,
        src,
      },
    ];
  }, [row]);

  const history = useMemo(() => {
    if (!row) return [] as Array<{ title: string; detail: string }>;
    const items: Array<{ title: string; detail: string }> = [];
    const registered = field(row, "registered_at") || row.created_at || "";
    const synced =
      field(row, "source") && field(row, "source") !== "Manual entry"
        ? `ITQAN sync · ${formatDt(registered)}`
        : formatDt(registered);
    items.push({ title: "Registered", detail: synced });
    const raw = row.fields?.status_history;
    if (Array.isArray(raw)) {
      for (const h of raw) {
        if (!h || typeof h !== "object") continue;
        const entry = h as Record<string, unknown>;
        items.push({
          title: `ITQAN status set to ${entry.to || field(row, "itqan_status")}`,
          detail: `${formatDt(String(entry.at || ""))}${entry.by ? ` · ${entry.by}` : ""}`,
        });
      }
    }
    return items;
  }, [row]);

  useEffect(() => {
    if (!caseId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightbox) setLightbox(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [caseId, lightbox, onClose]);

  async function onSaveStatus(event: FormEvent) {
    event.preventDefault();
    if (!row || !statusId || busy) return;
    setBusy(true);
    setError(null);
    try {
      setRow(await updateItqanStatus(row.id, statusId));
      onChanged();
      notifyCasesChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!row) return;
    if (!window.confirm(`Delete ${row.case_id}? This is logged with your name.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCase(row.id);
      onChanged();
      notifyCasesChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!caseId) return null;

  const scope = row?.project
    ? row.project
    : row?.department
      ? row.department
      : "…";

  const sourceLink = (() => {
    if (!row) return null;
    const srcId = field(row, "source_case_id");
    const srcType = field(row, "source_record_type");
    const label = field(row, "source_case_label") || field(row, "linked_from");
    if (!srcId || !srcType) return null;
    const type = srcType === "speed" ? "speed" : "dashcam";
    return {
      href: href({ name: "list", type, caseId: srcId }),
      label: label || "Source record",
    };
  })();

  const pairs = row
    ? [
        ["ITQAN reference", field(row, "itqan_ref") || "—"],
        ["Violation", field(row, "violation_type") || row.title || "—"],
        ["Assigned to", scope],
        ["Source", field(row, "source") || "—"],
        [
          "Driver",
          [field(row, "driver_name"), field(row, "driver_badge_number")]
            .filter(Boolean)
            .join(" / ") || "—",
        ],
        ["Vehicle type", field(row, "vehicle_type") || "—"],
        [
          "Date",
          `${formatDay(row.date)}${field(row, "occurred_time") ? `, ${field(row, "occurred_time")}` : ""}`,
        ],
        ["ITQAN status", field(row, "itqan_status") || "—"],
      ]
    : [];

  const ui = (
    <>
      <div
        className="scrim"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="drawer drawer-page drawer-record"
          role="dialog"
          aria-modal="true"
          aria-label="ITQAN violation"
        >
          <div className="drawer-hd">
            <div>
              <div className="sub">ITQAN Violation · {scope}</div>
              <h2 className="mono">{row?.case_id || "Loading…"}</h2>
            </div>
            <div className="drawer-hd-meta">
              {row ? (
                <StatusPill status={row.status === "closed" ? "closed" : "under_process"} />
              ) : null}
              <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
                <Icon name="x" size={18} />
              </button>
            </div>
          </div>

          <div className="drawer-body">
            {loading ? <p className="state">Loading record…</p> : null}
            {error ? <p className="state error">{error}</p> : null}
            {!loading && row ? (
              <div className="rec-grid">
                <div className="rec-main">
                  <section className="v1-card">
                    <h3>Details</h3>
                    <div className="kv kv-2">
                      {pairs.map(([k, v]) => (
                        <div key={k}>
                          <span>{k}</span>
                          <b>
                            {k === "Source" && sourceLink ? (
                              <>
                                {v} ·{" "}
                                <a className="linkbtn" href={sourceLink.href}>
                                  {sourceLink.label}
                                </a>
                              </>
                            ) : (
                              v
                            )}
                          </b>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="v1-card">
                    <h3>
                      Pictures <small>click to enlarge</small>
                    </h3>
                    <div className="photos">
                      {photos.map((p) => (
                        <figure
                          key={p.title}
                          className="photo"
                          onClick={() => setLightbox(p)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setLightbox(p);
                            }
                          }}
                        >
                          <img src={p.src} alt={p.title} />
                          <figcaption>
                            <b>{p.title}</b>
                            <span>{p.meta}</span>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="rec-side">
                  <section className="v1-card">
                    <h3>ITQAN status</h3>
                    {canManageItqan ? (
                      <form onSubmit={(e) => void onSaveStatus(e)}>
                        <label className="fld-ctl">
                          <span className="lbl">Update status</span>
                          <select
                            value={statusId}
                            onChange={(e) => setStatusId(e.target.value)}
                            required
                          >
                            <option value="">Select status</option>
                            {statuses.items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="btn dark"
                          style={{ marginTop: 10 }}
                          disabled={busy || !statusId}
                        >
                          <Icon name="check" size={13} /> Save status
                        </button>
                      </form>
                    ) : (
                      <div className="note">
                        Current status: <b>{field(row, "itqan_status") || "—"}</b>. Admin updates
                        the ITQAN status.
                      </div>
                    )}
                    {canDelete ? (
                      <div
                        className="row"
                        style={{ marginTop: 12, gap: 10, alignItems: "center", flexWrap: "wrap" }}
                      >
                        <button
                          type="button"
                          className="btn sm ghost-red"
                          disabled={busy}
                          onClick={() => void onDelete()}
                        >
                          Delete record
                        </button>
                        <span className="muted" style={{ fontSize: 12 }}>
                          Deleting is logged with your name.
                        </span>
                      </div>
                    ) : null}
                  </section>

                  <section className="v1-card">
                    <h3>Activity</h3>
                    <ul className="timeline">
                      {history.map((h, i) => (
                        <li key={`${h.title}-${i}`}>
                          <b>{h.title}</b>
                          <small className="muted">{h.detail}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {lightbox ? (
        <div
          className="lightbox"
          role="dialog"
          aria-label={lightbox.title}
          onClick={() => setLightbox(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.title} />
            <p>{lightbox.title} · click anywhere to close</p>
          </div>
        </div>
      ) : null}
    </>
  );

  return createPortal(ui, document.body);
}
