import { useId, type InputHTMLAttributes, type ReactNode } from "react";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

export function Input({
  "aria-describedby": describedBy,
  className = "",
  error,
  hint,
  id,
  label,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const descriptionIds = [describedBy, hintId, errorId]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      <label
        className="block text-sm font-medium text-slate-800"
        htmlFor={inputId}
      >
        {label}
      </label>
      <input
        {...props}
        aria-describedby={descriptionIds || undefined}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 ${error ? "border-red-500 focus:border-red-600 focus:ring-red-100" : ""} ${className}`}
        id={inputId}
      />
      {hint ? (
        <p className="text-sm text-slate-500" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-700" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
