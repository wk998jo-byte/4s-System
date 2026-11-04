import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchAssets, type AssetItem, type AssetMetaCategory } from "../api/scc";
import { useList } from "./shared";

export type AssetFieldValue = {
  asset_number: string;
  vehicle_type_id: string;
  model_id: string;
};

export function AssetFields({
  value,
  onChange,
  required = true,
}: {
  value: AssetFieldValue;
  onChange: (next: AssetFieldValue) => void;
  required?: boolean;
}) {
  const categories = useList("vehicle_type");
  const types = useList("model");
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [metaCats, setMetaCats] = useState<AssetMetaCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchAssets()
      .then((res) => {
        if (cancelled) return;
        setAssets(res.items ?? []);
        setMetaCats(res.meta?.categories ?? []);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load assets");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const categoryLabel =
    categories.items.find((i) => i.id === value.vehicle_type_id)?.label ?? "";

  const typeOptionsForCategory = useMemo(() => {
    const fromMeta = metaCats.find((c) => c.label === categoryLabel)?.types ?? [];
    if (fromMeta.length) {
      return types.items.filter((item) => fromMeta.includes(item.label));
    }
    return types.items;
  }, [metaCats, categoryLabel, types.items]);

  // Always offer the full asset register in the number dropdown.
  // Category / type still auto-fill on pick; type options still depend on category.
  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => a.asset_number.toLowerCase().includes(q));
  }, [assets, query]);

  function idForCategory(label: string) {
    return categories.items.find((i) => i.label === label)?.id ?? "";
  }
  function idForType(label: string) {
    return types.items.find((i) => i.label === label)?.id ?? "";
  }

  function selectAsset(number: string) {
    const match = assets.find((a) => a.asset_number === number);
    if (!match) {
      onChange({ ...value, asset_number: number });
    } else {
      onChange({
        asset_number: match.asset_number,
        vehicle_type_id: idForCategory(match.asset_category),
        model_id: idForType(match.asset_type),
      });
    }
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <div className="fld full">
        <div className="fld-ctl" ref={rootRef}>
          <span className="lbl">
            Asset number {required ? <span className="req">*</span> : null}
          </span>
          {/* Hidden required input so native form validation still works */}
          <input
            tabIndex={-1}
            aria-hidden
            required={required}
            value={value.asset_number}
            onChange={() => undefined}
            className="asset-combo-required"
          />
          <button
            type="button"
            className={`asset-combo-trigger${open ? " is-open" : ""}${
              value.asset_number ? "" : " is-placeholder"
            }`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            onClick={() =>
              setOpen((prev) => {
                const next = !prev;
                if (!next) setQuery("");
                return next;
              })
            }
          >
            <span>{value.asset_number || "Select…"}</span>
          </button>
          {open ? (
            <div className="asset-combo-panel">
              <input
                ref={searchRef}
                className="asset-combo-search"
                type="text"
                value={query}
                placeholder="Type to search…"
                aria-label="Search asset number"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && visibleAssets[0]) {
                    e.preventDefault();
                    selectAsset(visibleAssets[0].asset_number);
                  }
                }}
              />
              <ul id={listboxId} className="asset-combo-list" role="listbox">
                {visibleAssets.length === 0 ? (
                  <li className="asset-combo-empty">No matching assets</li>
                ) : (
                  visibleAssets.map((a) => (
                    <li key={a.asset_number} role="option">
                      <button
                        type="button"
                        className={`asset-combo-option${
                          a.asset_number === value.asset_number ? " is-on" : ""
                        }`}
                        onClick={() => selectAsset(a.asset_number)}
                      >
                        {a.asset_number}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
          <span className="hint">
            Open the list to pick an asset, or type to search. Category and type fill in
            automatically.
          </span>
          {error ? <span className="field-note error">{error}</span> : null}
        </div>
      </div>
      <div className="fld">
        <label className="fld-ctl">
          <span className="lbl">
            Asset category {required ? <span className="req">*</span> : null}
          </span>
          <select
            required={required}
            value={value.vehicle_type_id}
            onChange={(e) => {
              const vehicle_type_id = e.target.value;
              const nextCat =
                categories.items.find((i) => i.id === vehicle_type_id)?.label ?? "";
              const allowedTypes =
                metaCats.find((c) => c.label === nextCat)?.types ?? [];
              const currentTypeLabel =
                types.items.find((i) => i.id === value.model_id)?.label ?? "";
              const stillValid =
                !!currentTypeLabel &&
                (allowedTypes.length === 0 || allowedTypes.includes(currentTypeLabel));
              const nextTypeId = stillValid ? value.model_id : "";
              onChange({
                ...value,
                vehicle_type_id,
                model_id: nextTypeId,
              });
            }}
          >
            <option value="">Select…</option>
            {categories.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fld">
        <label className="fld-ctl">
          <span className="lbl">
            Asset type {required ? <span className="req">*</span> : null}
          </span>
          <select
            required={required}
            value={value.model_id}
            disabled={!value.vehicle_type_id}
            onChange={(e) => {
              onChange({
                ...value,
                model_id: e.target.value,
              });
            }}
          >
            <option value="">
              {value.vehicle_type_id ? "Select…" : "Select asset category first"}
            </option>
            {typeOptionsForCategory.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

