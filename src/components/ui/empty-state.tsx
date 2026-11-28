import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  action,
  className = "",
  description,
  title,
}: EmptyStateProps) {
  return (
    <section
      className={`rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center ${className}`}
      role="status"
    >
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
