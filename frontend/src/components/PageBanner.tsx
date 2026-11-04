import type { ReactNode } from "react";

export function PageBanner({
  kicker,
  title,
  titleAccent,
  subtitle,
  actions,
  icon,
}: {
  kicker?: string;
  title: string;
  titleAccent?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <section className="v1-banner">
      <div className="v1-banner-icon" aria-hidden>
        {icon ?? <span>SCC</span>}
      </div>
      <div className="v1-banner-copy">
        {kicker ? <p className="v1-banner-kicker">{kicker}</p> : null}
        <h1>
          {title}
          {titleAccent ? <em> {titleAccent}</em> : null}
        </h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="v1-banner-actions">{actions}</div> : null}
    </section>
  );
}
