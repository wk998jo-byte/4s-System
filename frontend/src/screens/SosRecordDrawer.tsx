import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  closeSos,
  deleteCase,
  fetchCase,
  notifyCasesChanged,
  resolveMediaUrl,
  uploadImage,
  type CaseDetail,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { SignedInNameField, StatusPill, useSignedInName } from "./shared";

type PhotoItem = { title: string; meta: string; src: string };

function makeSampleWorkerFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.resolve(
      new File([new Uint8Array([137, 80, 78, 71])], "sample-sos-worker.png", {
        type: "image/png",
      }),
    );
  }
  ctx.fillStyle = "#e8e4df";
  ctx.fillRect(0, 0, 480, 360);
  ctx.fillStyle = "#c8c2ba";
  ctx.beginPath();
  ctx.arc(240, 140, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#b0a89e";
  ctx.fillRect(160, 220, 160, 100);
  ctx.fillStyle = "#4a474c";
  ctx.font = "600 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Sample worker picture", 240, 340);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not create sample picture"));
        return;
      }
      resolve(new File([blob], "sample-sos-worker.png", { type: "image/png" }));
    }, "image/png");
  });
}

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
const HOUR_MS = 3600000;
const SOS_SLA_HOURS = 2;

function field(row: CaseDetail, key: string): string {
  const v = row.fields?.[key];
  return v == null ? "" : String(v);
}

function formatDt(iso: string | undefined | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDur(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const d = hours / 24;
  if (d < 7) return `${d.toFixed(1)} days`;
  return `${(d / 7).toFixed(1)} wk`;
}

function slaTag(row: CaseDetail, now = Date.now()) {
  if (row.status !== "open") return null;
  const created = new Date(row.created_at).getTime();
  const age = (now - created) / HOUR_MS;
  const h = SOS_SLA_HOURS;
  if (age > h * 2) return { cls: "red", text: `Escalated ${fmtDur(age - h)}` };
  if (age > h) return { cls: "red", text: `Overdue ${fmtDur(age - h)}` };
  if (age > h * 0.75) return { cls: "amber", text: `Due in ${fmtDur(h - age)}` };
  return { cls: "", text: `${fmtDur(h - age)} left` };
}

function timeToSeeSeconds(row: CaseDetail): number | null {
  const stored = field(row, "time_to_see_seconds");
  if (stored) {
    const n = Number(stored);
    if (Number.isFinite(n)) return n;
  }
  const created = field(row, "sos_created_at");
  const seen = field(row, "seen_at");
  if (!created || !seen) return null;
  const a = new Date(created).getTime();
  const b = new Date(seen).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
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
  if (name === "clock")
    return (
      <svg {...c}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...c}>
        <path d="M5 12l5 5L19 7" />
      </svg>
    );
  return null;
}

export function SosRecordDrawer({
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
  const canCloseSos = Boolean(user?.capabilities.close_sos);
  const canDelete = Boolean(user?.capabilities.delete_record);
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [closure, setClosure] = useState({
    alarm: "" as "" | "False Alarm" | "True Alarm",
    picture_shared_by: "",
    closed_at: "",
    close_out_report: "",
  });

  useEffect(() => {
    if (!caseId) {
      setRow(null);
      setPictureFile(null);
      setLightbox(null);
      setClosure({
        alarm: "",
        picture_shared_by: "",
        closed_at: "",
        close_out_report: "",
      });
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
    const url = resolveMediaUrl(field(row, "worker_picture"));
    if (!url) return [] as PhotoItem[];
    return [
      {
        title: "Worker picture",
        meta: field(row, "picture_shared_by")
          ? `Shared by ${field(row, "picture_shared_by")}`
          : "Uploaded at close-out",
        src: url,
      },
    ];
  }, [row]);

  if (!caseId) return null;

  const sla = row ? slaTag(row) : null;
  const tts = row ? timeToSeeSeconds(row) : null;
  const open = row?.status === "open";
  const filled = [
    closure.alarm,
    pictureFile ? "ok" : "",
    closure.picture_shared_by.trim(),
    closure.closed_at,
    closure.close_out_report.trim(),
  ].filter(Boolean).length;
  const canClose = filled === 5 && !closing;

  async function onCloseOut(event: FormEvent) {
    event.preventDefault();
    if (!row || !open || !canClose || !pictureFile) return;
    setClosing(true);
    setError(null);
    try {
      const uploaded = await uploadImage(pictureFile);
      const updated = await closeSos(row.id, {
        alarm: closure.alarm,
        worker_picture: uploaded.url,
        picture_shared_by: closure.picture_shared_by,
        closed_at: new Date(closure.closed_at).toISOString(),
        close_out_report: closure.close_out_report,
      });
      setRow(updated);
      setPictureFile(null);
      onChanged();
      notifyCasesChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClosing(false);
    }
  }

  async function onDelete() {
    if (!row || !window.confirm(`Delete ${row.case_id}?`)) return;
    setError(null);
    try {
      await deleteCase(row.id);
      notifyCasesChanged();
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const detailPairs: [string, string][] = row
    ? [
        ["Project", row.project || "—"],
        ["Location", field(row, "location") || "—"],
        ["Source", field(row, "source") || "—"],
        ["Worker name & badge", field(row, "worker_name_badge") || row.title || "—"],
        ["SOS created at", formatDt(field(row, "sos_created_at"))],
        [
          "Seen at",
          `${formatDt(field(row, "seen_at"))}${tts != null ? ` (+${tts} s)` : ""}`,
        ],
        ["Week", String(row.week_number || "—")],
        ["Registered by", field(row, "reported_by") || "—"],
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
        aria-label="SOS Alert"
      >
        <div className="drawer-hd">
          <div>
            <div className="sub">
              SOS Alert · {row?.project || "…"}
            </div>
            <h2 className="mono">{row?.case_id || "Loading…"}</h2>
          </div>
          <div className="drawer-hd-meta">
            <span className="tagx">N/A</span>
            {sla ? (
              <span className={`tagx ${sla.cls}`}>
                <Icon name="clock" size={12} /> {sla.text}
              </span>
            ) : null}
            {row ? <StatusPill status={row.status} /> : null}
            <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {loading ? <p className="state">Loading…</p> : null}
          {error ? <p className="state error">{error}</p> : null}
          {!loading && row ? (
            <div className="rec-grid">
              <div className="rec-main">
                <section className="v1-card">
                  <h3>Details</h3>
                  <div className="kv kv-2">
                    {detailPairs.map(([k, v]) => (
                      <div key={k}>
                        <span>{k}</span>
                        <b>{v}</b>
                      </div>
                    ))}
                  </div>
                  {field(row, "alarm") ? (
                    <div className="kv one" style={{ marginTop: 10 }}>
                      <div>
                        <span>Alarm</span>
                        <b>
                          <span
                            className={`tagx${field(row, "alarm") === "True Alarm" ? " red" : ""}`}
                          >
                            {field(row, "alarm")}
                          </span>
                        </b>
                      </div>
                    </div>
                  ) : null}
                  {row.status === "closed" ? (
                    <div className="note green" style={{ marginTop: 12 }}>
                      Closed by {field(row, "closed_by") || "Operator"}
                      {field(row, "closure_closed_at")
                        ? ` on ${formatDt(field(row, "closure_closed_at"))}`
                        : ""}
                      .
                    </div>
                  ) : null}
                  {field(row, "close_out_report") ? (
                    <div className="rec-block" style={{ marginTop: 12 }}>
                      <div className="rec-block-label">Close-out report</div>
                      <div className="note" style={{ whiteSpace: "pre-wrap" }}>
                        {field(row, "close_out_report")}
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="v1-card">
                  <h3>
                    Pictures <small>click to enlarge</small>
                  </h3>
                  {photos.length ? (
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
                  ) : (
                    <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                      {field(row, "worker_picture")
                        ? `Stored as ${field(row, "worker_picture")} (re-upload to attach an image file).`
                        : "Worker picture is uploaded at close-out."}
                    </p>
                  )}
                </section>
              </div>

              <div className="rec-side">
                {open && canCloseSos ? (
                  <section className="v1-card">
                    <h3>Close the SOS alert</h3>
                    <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
                      The closure fields close the alert. No Admin approval is needed.
                    </p>
                    <form className="sos-close-form" onSubmit={(e) => void onCloseOut(e)}>
                      <div className="fld">
                        <span className="field-label lbl">
                          Alarm <span className="req">*</span>
                        </span>
                        <div
                          className="radio-pills"
                          role="radiogroup"
                          aria-label="Alarm"
                          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
                        >
                          {(
                            [
                              ["False Alarm", "False alarm"],
                              ["True Alarm", "True alarm"],
                            ] as const
                          ).map(([value, label]) => (
                            <label
                              key={value}
                              className={`radio-pill${closure.alarm === value ? " is-on" : ""}`}
                              style={{ justifyContent: "flex-start" }}
                            >
                              <input
                                type="radio"
                                name="sosAlarm"
                                checked={closure.alarm === value}
                                onChange={() => setClosure({ ...closure, alarm: value })}
                              />
                              <span className="radio-dot" aria-hidden />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <label className="fld-ctl">
                        <span className="lbl">
                          Worker picture <span className="req">*</span>
                        </span>
                        <span className="dropzone">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
                            onChange={(e) =>
                              setPictureFile(e.target.files?.[0] ?? null)
                            }
                          />
                          <strong>Drop a picture here or browse</strong>
                          <span>{pictureFile?.name || "Image of the worker"}</span>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="linkbtn"
                        style={{ marginTop: 8, marginLeft: 0, marginBottom: 10 }}
                        onClick={() => {
                          void makeSampleWorkerFile()
                            .then((file) => setPictureFile(file))
                            .catch((err) => setError(errorMessage(err)));
                        }}
                      >
                        Use sample picture
                      </button>

                      <label className="fld-ctl">
                        <span className="lbl">
                          Worker picture shared by: Name &amp; Badge{" "}
                          <span className="req">*</span>
                        </span>
                        <input
                          value={closure.picture_shared_by}
                          onChange={(e) =>
                            setClosure({
                              ...closure,
                              picture_shared_by: e.target.value,
                            })
                          }
                          placeholder="Type the name / badge number"
                        />
                      </label>

                      <label className="fld-ctl">
                        <span className="lbl">
                          Closed at <span className="req">*</span>
                        </span>
                        <input
                          type="datetime-local"
                          value={closure.closed_at}
                          onChange={(e) =>
                            setClosure({ ...closure, closed_at: e.target.value })
                          }
                        />
                      </label>

                      <label className="fld-ctl">
                        <span className="lbl">
                          Close-out report <span className="req">*</span>
                        </span>
                        <textarea
                          rows={4}
                          value={closure.close_out_report}
                          onChange={(e) =>
                            setClosure({
                              ...closure,
                              close_out_report: e.target.value,
                            })
                          }
                          placeholder="What happened and how the worker was confirmed safe"
                        />
                      </label>

                      <SignedInNameField
                        label="Closed by"
                        note="Filled in by the system from the logged-in user"
                      />

                      <div className="sos-close-actions">
                        <span className="muted sos-close-progress">
                          {filled} of 5 closure fields completed
                          {!actorName ? " · sign in required" : ""}
                        </span>
                        <button
                          type="submit"
                          className="btn primary"
                          disabled={!canClose || !actorName}
                        >
                          <Icon name="check" size={14} />{" "}
                          {closing ? "Saving…" : "Close alert"}
                        </button>
                      </div>
                    </form>
                  </section>
                ) : open ? (
                  <section className="v1-card">
                    <h3>View only</h3>
                    <div className="note amber">
                      Your role can view this SOS alert but cannot close it out.
                    </div>
                  </section>
                ) : (
                  <section className="v1-card">
                    <h3>Record closed</h3>
                    <div className="note green">
                      Closed by {field(row, "closed_by") || "Operator"}
                      {field(row, "closure_closed_at")
                        ? ` on ${formatDt(field(row, "closure_closed_at"))}`
                        : ""}
                      {field(row, "alarm") ? ` · ${field(row, "alarm")}` : ""}.
                    </div>
                    {field(row, "picture_shared_by") ? (
                      <div className="kv one" style={{ marginTop: 10 }}>
                        <div>
                          <span>Picture shared by</span>
                          <b>{field(row, "picture_shared_by")}</b>
                        </div>
                      </div>
                    ) : null}
                  </section>
                )}

                <section className="v1-card">
                  <h3>Response time</h3>
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    SOS alerts must be closed within 2 hours of SOS created at or they show as
                    overdue.
                  </p>
                </section>

                {canDelete ? (
                  <button type="button" className="btn sm" onClick={() => void onDelete()}>
                    Delete record
                  </button>
                ) : null}
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
          <p>
            {lightbox.title} · click anywhere to close
          </p>
        </div>
      </div>
    ) : null}
    </>
  );
}
