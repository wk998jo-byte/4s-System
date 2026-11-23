import { EditGlyph, RecordReviewDetail } from "./SupportScreens";
import type { CaseDetail } from "../api/scc";
import type { AuthUser } from "../auth/types";

/** Operators (and admins) may edit original fields while the record is Open. */
export function canEditOpenRecord(
  user: AuthUser | null | undefined,
  status: string | undefined,
): boolean {
  return Boolean(user?.capabilities.register) && status === "open";
}

export function RecordEditIconButton({
  editing,
  onToggle,
}: {
  editing: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={editing ? "Cancel edit" : "Edit record"}
      title={editing ? "Cancel edit" : "Edit record"}
      onClick={onToggle}
    >
      {editing ? (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      ) : (
        <EditGlyph />
      )}
    </button>
  );
}

export function RecordOpenEditForm({
  detail,
  onCancel,
  onSaved,
}: {
  detail: CaseDetail;
  onCancel: () => void;
  onSaved: (row: CaseDetail) => void;
}) {
  return (
    <section className="v1-card">
      <h3>Edit record</h3>
      <RecordReviewDetail
        detail={detail}
        editing
        onCancel={onCancel}
        onSaved={onSaved}
      />
    </section>
  );
}
