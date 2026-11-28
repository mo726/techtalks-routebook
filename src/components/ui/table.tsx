import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  ThHTMLAttributes,
} from "react";

type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  caption?: ReactNode;
  containerClassName?: string;
};

export function Table({
  caption,
  children,
  className = "",
  containerClassName = "",
  ...props
}: TableProps) {
  return (
    <div className={`overflow-x-auto ${containerClassName}`}>
      <table
        {...props}
        className={`w-full border-collapse text-left text-sm ${className}`}
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function TableHead({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      {...props}
      className={`bg-slate-50 text-xs uppercase tracking-wide text-slate-500 ${className}`}
    />
  );
}

export function TableBody({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      {...props}
      className={`divide-y divide-slate-100 ${className}`}
    />
  );
}

export function TableRow({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} className={className} />;
}

export function TableHeaderCell({
  className = "",
  scope = "col",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={`px-5 py-3 font-semibold ${className}`}
      scope={scope}
    />
  );
}

export function TableCell({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      className={`px-5 py-4 text-slate-700 ${className}`}
    />
  );
}
