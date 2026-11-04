import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  approveCase,
  confirmDriver,
  deleteCase,
  fetchCase,
  notifyCasesChanged,
  rejectCase,
  resolveMediaUrl,
  uploadImage,
  type CaseDetail,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { ITQAN_SKIP_REASONS, useIntegSettings } from "../lib/integSettings";
import { StatusPill, useSignedInName } from "./shared";

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

function snapUri(row: CaseDetail): string {
  const W = 640;
  const H = 400;
  const title = (field(row, "speed_violation_type") || "Speed").toUpperCase();
  const asset = field(row, "asset_number") || "ASSET";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2f38"/><stop offset="1" stop-color="#12151a"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="210" y="90" width="220" height="200" rx="8" fill="none" stroke="#ff2b2b" stroke-width="3"/>
    <rect x="210" y="68" width="160" height="22" fill="#ff2b2b"/>
    <text x="220" y="84" font-family="IBM Plex Mono,monospace" font-size="13" font-weight="700" fill="#fff">${title.slice(0, 18)}</text>
    <text x="24" y="${H - 18}" font-family="IBM Plex Mono,monospace" font-size="12" fill="#fff">${asset} · ${row.case_id} · ${row.date}</text>
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

export function SpeedRecordDrawer({
  caseId,
  onClose,
  onChanged,
}: {
  caseId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const actorName = useSignedInName();
  const integ = useIntegSettings(Boolean(caseId));
  const canApprove = Boolean(user?.capabilities.approve_reject);
  const canConfirm = Boolean(user?.capabilities.confirm_driver);
  const canDelete = Boolean(user?.capabilities.delete_record);
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [itqan, setItqan] = useState<"Yes" | "No">("Yes");
  const [itqanSkipReason, setItqanSkipReason] = useState("");

  useEffect(() => {
    if (!caseId) {
      setRow(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCase(caseId)
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
    if (!caseId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lightbox) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [caseId, lightbox, onClose]);

  useEffect(() => {
    if (!row) return;
    const wantUpload = row.fields?.upload_to_itqan !== false;
    setItqan(wantUpload ? "Yes" : "No");
    setItqanSkipReason(field(row, "itqan_skip_reason"));
    setProofFile(null);
  }, [row?.id]);

  const photos = useMemo(() => {
    if (!row) return [] as PhotoItem[];
    const list: PhotoItem[] = [];
    const fms = resolveMediaUrl(field(row, "fms_evidence"));
    if (fms || field(row, "fms_evidence")) {
      list.push({
        title: "FMS evidence",
        meta: `${field(row, "asset_number") || "Asset"} · ${formatDay(row.date)}`,
        src: fms || snapUri(row),
      });
    }
    if (field(row, "itqan_upload_proof")) {
      list.push({
        title: "ITQAN upload proof",
        meta: field(row, "uploaded_by") || "Uploaded",
        src: resolveMediaUrl(field(row, "itqan_upload_proof")) || snapUri(row),
      });
    }
    return list;
  }, [row]);

  if (!caseId) return null;

  async function onApprove() {
    if (!row || busy) return;
    setBusy(true);
    setError(null);
    try {
      setRow(await approveCase(row.id));
      onChanged();
      notifyCasesChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (!row || busy || !rejectReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setRow(await rejectCase(row.id, rejectReason.trim()));
      setRejectReason("");
      onChanged();
      notifyCasesChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!row || busy) return;
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

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    if (!row || busy) return;
    if (itqan === "Yes" && !proofFile) {
      setError("ITQAN upload proof is required.");
      return;
    }
    if (itqan === "No" && !itqanSkipReason.trim()) {
      setError("Reason for not uploading to ITQAN is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded =
        itqan === "Yes" && proofFile ? await uploadImage(proofFile) : null;
      setRow(
        await confirmDriver("speed", row.id, {
          upload_to_itqan: itqan === "Yes",
          itqan_proof: uploaded?.url ?? null,
          itqan_skip_reason: itqan === "No" ? itqanSkipReason : null,
          uploaded_by: actorName,
        }),
      );
      setProofFile(null);
      onChanged();
      notifyCasesChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const scope = row?.project
    ? row.project
    : row?.department
      ? `Dept: ${row.department}`
      : "…";

  const pairs = row
    ? [
        ["Assign to", row.project ? "Project" : row.department ? "Department" : "—"],
        ["Project / Dept", scope],
        ["Asset", field(row, "asset_number") || "—"],
        [
          "Asset category / type",
          [field(row, "vehicle_type"), field(row, "model")].filter(Boolean).join(" · ") || "—",
        ],
        [
          "Driver",
          [field(row, "driver_name"), field(row, "driver_badge_number")]
            .filter(Boolean)
            .join(" / ") || "—",
        ],
        ["Position", field(row, "position") || "—"],
        [
          "Rental",
          field(row, "rental_driver") === "true" || row.fields?.rental_driver ? "Yes" : "No",
        ],
        ["Location", field(row, "location_coordinates") || "—"],
        ["Date", `${formatDay(row.date)} (Week ${row.week_number})`],
        ["Time", field(row, "occurred_time") || "—"],
        ["Violation type", field(row, "speed_violation_type") || "—"],
        ["Permitted speed", field(row, "permitted_speed_kmh") ? `${field(row, "permitted_speed_kmh")} km/h` : "—"],
        ["Vehicle speed", field(row, "vehicle_speed_kmh") ? `${field(row, "vehicle_speed_kmh")} km/h` : "—"],
        [
          "Exceedance",
          field(row, "exceedance_kmh")
            ? `+${field(row, "exceedance_kmh")} km/h`
            : "—",
        ],
        ["Reported by", field(row, "reported_by") || "—"],
      ]
    : [];

  return (
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
          aria-label="Speed violation"
        >
          <div className="drawer-hd">
            <div>
              <div className="sub">Speed Violation · {scope}</div>
              <h2 className="mono">{row?.case_id || "Loading…"}</h2>
            </div>
            <div className="drawer-hd-meta">
              {row ? <StatusPill status={row.status} /> : null}
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
                          <b>{v}</b>
                        </div>
                      ))}
                    </div>
                    {field(row, "alert_summary") ? (
                      <div className="rec-block">
                        <div className="rec-block-label">Alert summary</div>
                        <div className="note">{field(row, "alert_summary")}</div>
                      </div>
                    ) : null}
                    {field(row, "reject_reason") && row.status === "open" ? (
                      <div className="note red">
                        <b>Returned by {field(row, "rejected_by") || "Admin"}:</b>{" "}
                        {field(row, "reject_reason")}
                      </div>
                    ) : null}
                  </section>

                  <section className="v1-card">
                    <h3>
                      Evidence <small>click to enlarge</small>
                    </h3>
                    <div className="photos">
                      {photos.length ? photos.map((p) => (
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
                      )) : (
                        <p className="muted">No evidence files attached.</p>
                      )}
                    </div>
                  </section>
                </div>

                <div className="rec-side">
                  <section className="v1-card">
                    {row.status === "closed" ? (
                      <>
                        <h3>Record closed</h3>
                        <div className="note green">
                          Approved and closed by {field(row, "closed_by") || "Admin"}
                          {field(row, "approved_at")
                            ? ` on ${formatDt(field(row, "approved_at"))}`
                            : ""}
                          .
                        </div>
                      </>
                    ) : row.status === "under_process" ? (
                      canApprove ? (
                        <>
                          <h3>Admin decision</h3>
                          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                            Review the ITQAN proof and driver confirmation.
                          </p>
                          <label className="fld-ctl" style={{ marginTop: 8 }}>
                            <span className="lbl">
                              Rejection reason <span className="muted">(required to return)</span>
                            </span>
                            <textarea
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder="Explain what the Operator needs to fix"
                              rows={3}
                            />
                          </label>
                          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="btn sm ghost-red"
                              disabled={busy || !rejectReason.trim()}
                              onClick={() => void onReject()}
                            >
                              <Icon name="x" size={13} /> Return with reason
                            </button>
                            <button
                              type="button"
                              className="btn sm primary"
                              disabled={busy}
                              onClick={() => void onApprove()}
                            >
                              <Icon name="check" size={13} /> Approve and close
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3>Waiting for Admin review</h3>
                          <div className="note amber">
                            Confirm Driver was submitted. Admin approves (Closed) or returns with a
                            reason (Open).
                          </div>
                        </>
                      )
                    ) : canConfirm ? (
                      <>
                        <h3>Confirm Driver &amp; Submit</h3>
                        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 8px" }}>
                          Verify the driver
                          {itqan === "Yes"
                            ? " and attach ITQAN upload proof"
                            : " (ITQAN upload skipped)"}
                          . Status moves to Under Review. Submitted by{" "}
                          {actorName || "signed-in user"}.
                        </p>
                        <form className="closeout-form" onSubmit={(e) => void onConfirm(e)}>
                          {integ.itqanAsk ? (
                            <div className="fld" style={{ marginBottom: 10 }}>
                              <span className="field-label lbl">
                                Upload to ITQAN? <span className="req">*</span>
                              </span>
                              <div
                                className="radio-pills"
                                role="radiogroup"
                                aria-label="Upload to ITQAN"
                              >
                                {(["Yes", "No"] as const).map((opt) => (
                                  <label
                                    key={opt}
                                    className={`radio-pill${itqan === opt ? " is-on" : ""}`}
                                  >
                                    <input
                                      type="radio"
                                      name="confirm-itqan-speed"
                                      checked={itqan === opt}
                                      onChange={() => {
                                        setItqan(opt);
                                        if (opt === "Yes") setItqanSkipReason("");
                                      }}
                                    />
                                    <span className="radio-dot" aria-hidden />
                                    <span>{opt}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {itqan === "Yes" ? (
                            <label className="fld-ctl">
                              <span className="lbl">
                                ITQAN upload proof <span className="req">*</span>
                              </span>
                              <span className="dropzone">
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) =>
                                    setProofFile(e.target.files?.[0] ?? null)
                                  }
                                />
                                <strong>Drop a picture here or browse</strong>
                                <span>
                                  {proofFile?.name ||
                                    "Screenshot that shows the violation uploaded to ITQAN"}
                                </span>
                              </span>
                            </label>
                          ) : (
                            <label className="fld-ctl">
                              <span className="lbl">
                                Reason for not uploading to ITQAN{" "}
                                <span className="req">*</span>
                              </span>
                              <select
                                required
                                value={itqanSkipReason}
                                onChange={(e) => setItqanSkipReason(e.target.value)}
                              >
                                <option value="">Select</option>
                                {ITQAN_SKIP_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {reason}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <button
                            type="submit"
                            className="btn primary"
                            disabled={
                              busy ||
                              (itqan === "Yes" ? !proofFile : !itqanSkipReason.trim())
                            }
                          >
                            <Icon name="check" size={14} />{" "}
                            {busy ? "Submitting…" : "Confirm Driver & Submit"}
                          </button>
                        </form>
                      </>
                    ) : (
                      <>
                        <h3>View only</h3>
                        <div className="note amber">
                          Your role can view this record but cannot confirm, approve, or return it.
                        </div>
                      </>
                    )}
                    {canDelete ? (
                      <button
                        type="button"
                        className="linkbtn"
                        style={{ marginTop: 12, color: "var(--red)" }}
                        disabled={busy}
                        onClick={() => void onDelete()}
                      >
                        Delete record
                      </button>
                    ) : null}
                  </section>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {lightbox ? (
        <div className="lightbox" role="dialog" aria-label={lightbox.title} onClick={() => setLightbox(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.title} />
            <p>
              {lightbox.title} · click anywhere to close
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
