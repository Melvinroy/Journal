import {
  journalSemanticClass,
  type JournalSemanticTone,
} from "../lib/journal-presentation";

export function MetricCard({
  detail,
  label,
  title,
  tone = "neutral",
  value,
}: {
  detail: React.ReactNode;
  label: React.ReactNode;
  title?: string;
  tone?: JournalSemanticTone;
  value: React.ReactNode;
}) {
  return (
    <article className="metric-card" data-metric-tone={tone}>
      <span className="metric-label" title={title}>{label}</span>
      <strong className={`metric-value ${journalSemanticClass(tone)}`}>{value}</strong>
      <small className="metric-detail">{detail}</small>
    </article>
  );
}
