import type { HTMLAttributes, ReactNode } from "react";

export type AlertVariant = "info" | "success" | "warning" | "error";

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
  title?: ReactNode;
};

const variantClasses: Record<AlertVariant, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
};

export function Alert({
  children,
  className = "",
  title,
  variant = "info",
  ...props
}: AlertProps) {
  return (
    <div
      {...props}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={`rounded-xl border p-4 text-sm ${variantClasses[variant]} ${className}`}
      role={variant === "error" ? "alert" : "status"}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}
