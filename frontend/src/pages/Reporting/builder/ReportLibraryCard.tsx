import type { ReactNode } from 'react';
import type { Locale } from '../../../i18n';
import { reportBuilderGuideMessages } from '../reportBuilderGuideMessages';

interface Props {
  locale: Locale;
  title: string;
  description?: string;
  source?: string;
  visualization: string;
  headingAction?: ReactNode;
  metadata?: ReactNode;
  children: ReactNode;
}

export function ReportLibraryCard({
  locale,
  title,
  description,
  source,
  visualization,
  headingAction,
  metadata,
  children,
}: Props) {
  const t = reportBuilderGuideMessages[locale];
  return (
    <article className="rbs-lib-card">
      <div className="rbs-lib-card-content">
        <div className="rbs-lib-card-head">
          <h3 className="rbs-lib-card-title">{title}</h3>
          {headingAction}
        </div>
        {description && <p className="rbs-lib-card-desc">{description}</p>}
      </div>
      <dl className="rbs-lib-facts">
        {source && (
          <div>
            <dt>{t.source}</dt>
            <dd>{source}</dd>
          </div>
        )}
        <div>
          <dt>{t.reportType}</dt>
          <dd>{visualization}</dd>
        </div>
      </dl>
      {metadata && <div className="rbs-lib-meta">{metadata}</div>}
      <div className="rbs-lib-actions">{children}</div>
    </article>
  );
}

export function ReportCardArrow() {
  return (
    <svg
      className="rbs-card-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
