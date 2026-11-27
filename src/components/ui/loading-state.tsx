type LoadingStateProps = {
  label: string;
  className?: string;
};

export function LoadingState({
  className = "",
  label,
}: LoadingStateProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={`flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm ${className}`}
      role="status"
    >
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-blue-700 border-r-transparent motion-reduce:animate-none"
      />
      {label}
    </div>
  );
}
