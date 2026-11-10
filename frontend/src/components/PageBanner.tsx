import type { ReactNode } from "react";
import { bannerYear } from "../screens/shared";

export function PageBanner({
  kicker,
  title,
  titleAccent,
  subtitle,
  actions,
  icon,
  withYear = false,
}: {
  kicker?: string;
  title: string;
  titleAccent?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  /** Append the current calendar year to the accent (e.g. DASHBOARD 2027). */
  withYear?: boolean;
}) {
  const accent =
    titleAccent == null
      ? null
      : withYear
        ? `${titleAccent} ${bannerYear()}`
        : titleAccent;
  return (
    <section className="v1-banner">
      <div className="v1-banner-icon" aria-hidden>
        {icon ?? <span>SCC</span>}
      </div>
      <div className="v1-banner-copy">
        {kicker ? <p className="v1-banner-kicker">{kicker}</p> : null}
        <h1>
          {title}
          {accent ? <em> {accent}</em> : null}
        </h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="v1-banner-actions">{actions}</div> : null}
    </section>
  );
}
