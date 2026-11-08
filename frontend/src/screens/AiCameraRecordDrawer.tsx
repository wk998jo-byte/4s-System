import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  approveCase,
  closeOutAiCamera,
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
import { safelifeStatusOf } from "../lib/integSettings";
import { RiskPill, StatusPill, useSignedInName } from "./shared";

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

function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Prototype camera-frame SVG (matches V1 snap look when no binary upload store exists). */
function snapUri(
  kind: "obs" | "close" | "safelife",
  row: CaseDetail,
): string {
  const W = 640;
  const H = 400;
  const seed = hashSeed(`${row.case_id}-${kind}-${field(row, "observation_picture")}`);
  let n = seed;
  const R = () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return (n % 10000) / 10000;
  };
  const camera = field(row, "camera_id") || "CAM-01";
  const loc = field(row, "location") || row.project || "";
  const time = field(row, "occurred_time") || "00:00";
  const title = field(row, "category") || "Observation";
  const hseo = field(row, "hseo_name_badge") || "HSEO";
  const slRef = field(row, "safelife_ref") || "SL-";

  let body = "";
  if (kind === "safelife") {
    body = `
      <rect width="${W}" height="${H}" fill="#f2f5f3"/>
      <rect width="${W}" height="54" fill="#0f6b4d"/>
      <text x="22" y="36" font-family="Barlow,sans-serif" font-weight="800" font-size="24" fill="#fff">SafeLife</text>
      <rect x="24" y="72" width="${W - 48}" height="40" rx="6" fill="#dff1e4"/>
      <text x="40" y="97" font-family="Barlow,sans-serif" font-size="15" font-weight="700" fill="#2f7a46">✓ Observation recorded · ${escapeXml(slRef)}</text>
      <text x="40" y="160" font-family="Barlow,sans-serif" font-size="13" fill="#5f6b66">Project</text>
      <text x="180" y="160" font-family="Barlow,sans-serif" font-size="13" fill="#1d1c1f">${escapeXml(row.project || "")}</text>
      <text x="40" y="196" font-family="Barlow,sans-serif" font-size="13" fill="#5f6b66">Location</text>
      <text x="180" y="196" font-family="Barlow,sans-serif" font-size="13" fill="#1d1c1f">${escapeXml(loc)}</text>
      <text x="40" y="232" font-family="Barlow,sans-serif" font-size="13" fill="#5f6b66">Category</text>
      <text x="180" y="232" font-family="Barlow,sans-serif" font-size="13" fill="#1d1c1f">${escapeXml(field(row, "category"))}</text>
    `;
  } else {
    const ok = kind === "close";
    const col = ok ? "#2fd16b" : "#ff2b2b";
    const hz = 160 + Math.floor(R() * 40);
    const wx = 360 + Math.floor(R() * 80);
    const wy = hz + 70;
    body = `
      <defs>
        <linearGradient id="sk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8eb6d8"/><stop offset="1" stop-color="#c5d8ea"/>
        </linearGradient>
        <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9a8b6e"/><stop offset="1" stop-color="#6e6148"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${hz}" fill="url(#sk)"/>
      <rect y="${hz}" width="${W}" height="${H - hz}" fill="url(#gr)"/>
      <rect x="40" y="${hz + 20}" width="180" height="90" rx="4" fill="#c4a574" opacity=".85"/>
      <rect x="250" y="${hz - 40}" width="70" height="140" fill="#5a5a5e"/>
      <g transform="translate(${wx},${wy})">
        <rect x="-12" y="0" width="24" height="48" rx="6" fill="#ee7d12"/>
        <rect x="-12" y="14" width="24" height="5" fill="#d8ff3c"/>
        <circle cx="0" cy="-10" r="10" fill="#a8745a"/>
        ${ok ? '<path d="M-12 -12 a12 11 0 0 1 24 0z" fill="#fff"/>' : ""}
      </g>
      <rect x="${wx - 30}" y="${wy - 36}" width="${ok ? 120 : 160}" height="${ok ? 120 : 130}" fill="none" stroke="${col}" stroke-width="3"/>
      <rect x="${wx - 30}" y="${wy - 60}" width="200" height="22" fill="${col}"/>
      <text x="${wx - 22}" y="${wy - 44}" font-family="IBM Plex Mono,monospace" font-size="13" font-weight="700" fill="#fff">${escapeXml((ok ? "CORRECTED  ✓" : title.toUpperCase()).slice(0, 28))}</text>
      <rect width="${W}" height="28" fill="#111" opacity=".55"/>
      <text x="12" y="19" font-family="IBM Plex Mono,monospace" font-size="12" fill="#fff">${escapeXml(camera)}  ·  ${escapeXml(row.project || "")}  ·  ${escapeXml(loc)}</text>
      <text x="${W - 12}" y="19" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="12" fill="${ok ? "#2fd16b" : "#ff6b6b"}">${ok ? "CLOSE-OUT" : "● REC"}  ${escapeXml(row.date)} ${escapeXml(time)}</text>
      <rect y="${H - 28}" width="${W}" height="28" fill="#000" opacity=".5"/>
      <text x="12" y="${H - 10}" font-family="IBM Plex Mono,monospace" font-size="12" fill="#fff">${ok ? escapeXml(`HSEO: ${hseo}  ·  ${row.date} ${time}`) : escapeXml(`${field(row, "detection_method") === "Manual" ? "MANUAL CAPTURE" : "AI DETECTION"}  ·  ${field(row, "alert_type")}  ·  ${row.case_id}`)}</text>
    `;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function Lightbox({
  title,
  src,
  onClose,
}: {
  title: string;
  src: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-label={title} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={title} />
        <p>
          {title} · click anywhere to close
        </p>
      </div>
    </div>
  );
}

export function AiCameraRecordDrawer({
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
  const canApprove = Boolean(user?.capabilities.approve_reject);
  const canCloseOut = Boolean(user?.capabilities.close_out);
  const canDelete = Boolean(user?.capabilities.delete_record);
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [closeout, setCloseout] = useState({
    hseo_name_badge: "",
    close_out_action: "",
    safelife_reference: "",
  });
  const [closeOutFile, setCloseOutFile] = useState<File | null>(null);

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

  const photos = useMemo(() => {
    if (!row) return [] as PhotoItem[];
    const list: PhotoItem[] = [];
    const cam = field(row, "camera_id") || "CAM-01";
    const time = field(row, "occurred_time");
    const obsSrc =
      resolveMediaUrl(field(row, "observation_picture")) || snapUri("obs", row);
    list.push({
      title: "Observation picture",
      meta: `${cam} · ${formatDay(row.date)}${time ? ` ${time}` : ""}`,
      src: obsSrc,
    });
    if (row.status !== "open" || field(row, "close_out_picture")) {
      list.push({
        title: "Close-out picture",
        meta: (field(row, "hseo_name_badge") || "HSEO").split("/")[0].trim(),
        src:
          resolveMediaUrl(field(row, "close_out_picture")) ||
          snapUri("close", row),
      });
    }
    if (safelifeStatusOf(row) === "Updated") {
      list.push({
        title: "SafeLife entry",
        meta: field(row, "safelife_ref") || "Updated",
        src: snapUri("safelife", row),
      });
    }
    return list;
  }, [row]);

  const activity = useMemo(() => {
    if (!row) return [];
    const items: { act: string; by: string; at: string; tone: string }[] = [
      {
        act: "Registered",
        by: field(row, "reported_by") || "Operator",
        at: formatDt(row.created_at),
        tone: "",
      },
    ];
    if (field(row, "close_out_submitted_by") || row.status !== "open") {
      items.push({
        act: "Close-out submitted",
        by: field(row, "close_out_submitted_by") || field(row, "reported_by") || "Operator",
        at: formatDt(row.created_at),
        tone: "amber",
      });
    }
    if (row.status === "closed") {
      items.push({
        act: "Approved and closed",
        by: field(row, "closed_by") || "Admin",
        at: formatDt(field(row, "approved_at")),
        tone: "green",
      });
    }
    if (field(row, "reject_reason")) {
      items.push({
        act: `Returned: ${field(row, "reject_reason")}`,
        by: field(row, "rejected_by") || "Admin",
        at: formatDt(row.created_at),
        tone: "red",
      });
    }
    return items;
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

  async function onSubmitCloseOut(event: FormEvent) {
    event.preventDefault();
    if (!row || busy) return;
    if (
      !closeout.hseo_name_badge.trim() ||
      !closeout.close_out_action.trim() ||
      !closeOutFile
    ) {
      setError("All close-out fields are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(closeOutFile);
      setRow(
        await closeOutAiCamera(row.id, {
          hseo_name_badge: closeout.hseo_name_badge,
          close_out_action: closeout.close_out_action,
          close_out_picture: uploaded.url,
          safelife_reference: closeout.safelife_reference.trim() || null,
        }),
      );
      setCloseout({ hseo_name_badge: "", close_out_action: "", safelife_reference: "" });
      setCloseOutFile(null);
      onChanged();
      notifyCasesChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const pairs = row
    ? [
        ["Project", row.project || "—"],
        ["Location", field(row, "location") || "—"],
        ["Date", `${formatDay(row.date)} (Week ${row.week_number})`],
        ["Time", field(row, "occurred_time") || "—"],
        ["Alert type", field(row, "alert_type") || "—"],
        ["Category", field(row, "category") || "—"],
        ["Risk level", row.risk_level || "—"],
        ["Detection method", field(row, "detection_method") || "—"],
        ["Camera", field(row, "camera_id") || "—"],
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
          aria-label="AI Camera observation"
        >
          <div className="drawer-hd">
            <div>
              <div className="sub">
                AI Camera Observation · {row?.project || "…"}
              </div>
              <h2 className="mono">{row?.case_id || "Loading…"}</h2>
            </div>
            <div className="drawer-hd-meta">
              {row ? <RiskPill risk={row.risk_level} /> : null}
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
                    {field(row, "close_out_action") ? (
                      <div className="rec-block">
                        <div className="rec-block-label">
                          Close-out action
                          {field(row, "hseo_name_badge")
                            ? ` · HSEO ${field(row, "hseo_name_badge")}`
                            : ""}
                        </div>
                        <div className="note green">{field(row, "close_out_action")}</div>
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
                      Pictures <small>click to enlarge</small>
                    </h3>
                    <div className="photos">
                      {photos.map((p) => (
                        <figure
                          key={p.title}
                          className="photo"
                          onClick={() => setLightbox(p)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setLightbox(p);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          data-lb={p.title}
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
                  <section className="v1-card" id="actBox">
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
                            Review the close-out picture and action.
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
                            The close-out was submitted. Admin approves it (Closed) or returns it
                            with a reason (Open).
                          </div>
                        </>
                      )
                    ) : canCloseOut ? (
                      <>
                        <h3>Submit close-out</h3>
                        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 8px" }}>
                          The close-out action, picture and Safety Officer move the record to Under
                          Review. Reported as {actorName || "signed-in user"}.
                        </p>
                        <form className="closeout-form" onSubmit={(e) => void onSubmitCloseOut(e)}>
                          <label className="fld-ctl">
                            <span className="lbl">
                              Safety Officer (HSEO) in the area: Name &amp; Badge Number{" "}
                              <span className="req">*</span>
                            </span>
                            <input
                              value={closeout.hseo_name_badge}
                              onChange={(e) =>
                                setCloseout({ ...closeout, hseo_name_badge: e.target.value })
                              }
                              placeholder="Type the name / badge number"
                            />
                          </label>
                          <label className="fld-ctl">
                            <span className="lbl">
                              Close-out action <span className="req">*</span>
                            </span>
                            <textarea
                              rows={3}
                              value={closeout.close_out_action}
                              onChange={(e) =>
                                setCloseout({ ...closeout, close_out_action: e.target.value })
                              }
                              placeholder="Action taken on site"
                            />
                          </label>
                          <label className="fld-ctl">
                            <span className="lbl">
                              Close-out picture <span className="req">*</span>
                            </span>
                            <span className="dropzone">
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) =>
                                  setCloseOutFile(e.target.files?.[0] ?? null)
                                }
                              />
                              <strong>Drop a picture here or browse</strong>
                              <span>
                                {closeOutFile?.name || "Image of the corrective action"}
                              </span>
                            </span>
                          </label>
                          {safelifeStatusOf(row) !== "Updated" ? (
                            <label className="fld-ctl">
                              <span className="lbl">SafeLife reference number</span>
                              <input
                                placeholder="Optional — SL-000000"
                                value={closeout.safelife_reference}
                                onChange={(e) =>
                                  setCloseout({
                                    ...closeout,
                                    safelife_reference: e.target.value,
                                  })
                                }
                              />
                              <span className="field-note">
                                Optional. If filled, SafeLife status becomes Updated; otherwise it
                                stays Pending until Admin closes the record (Not required).
                              </span>
                            </label>
                          ) : null}
                          <button className="btn primary" type="submit" disabled={busy}>
                            {busy ? "Saving…" : "Submit close-out"}
                          </button>
                        </form>
                      </>
                    ) : (
                      <>
                        <h3>View only</h3>
                        <div className="note amber">
                          Your role can view this record but cannot submit close-out, approve, or
                          return it.
                        </div>
                      </>
                    )}
                    {canDelete ? (
                      <div className="rec-del">
                        <small className="muted">Deleting is logged with your name.</small>
                        <button
                          type="button"
                          className="btn sm ghost-red"
                          disabled={busy}
                          onClick={() => void onDelete()}
                        >
                          Delete record
                        </button>
                      </div>
                    ) : null}
                  </section>

                  <section className="v1-card">
                    <h3>
                      <span className="logo-chip sl">SafeLife</span> Update
                    </h3>
                    {(() => {
                      const sl = safelifeStatusOf(row);
                      if (sl === "Updated") {
                        return (
                          <div className="note green">
                            Updated in SafeLife · reference{" "}
                            <b className="mono">{field(row, "safelife_ref") || "—"}</b>
                          </div>
                        );
                      }
                      if (sl === "Pending") {
                        return (
                          <div className="note amber">
                            Pending — can be completed with an optional SafeLife reference at
                            close-out. If Admin closes without one, status becomes Not required.
                          </div>
                        );
                      }
                      return (
                        <div className="note">
                          Not required — record closed without a SafeLife entry.
                        </div>
                      );
                    })()}
                  </section>

                  <section className="v1-card">
                    <h3>Activity</h3>
                    <div className="tl">
                      {activity.map((h) => (
                        <div className={`ev ${h.tone}`} key={`${h.act}-${h.at}`}>
                          <i />
                          <div>
                            <b>{h.act}</b>
                            <small>
                              {h.by} · {h.at}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {lightbox ? (
        <Lightbox title={lightbox.title} src={lightbox.src} onClose={() => setLightbox(null)} />
      ) : null}
    </>
  );
}
