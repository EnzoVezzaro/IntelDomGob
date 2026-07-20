import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

// --- Button -----------------------------------------------------------------
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none px-3 py-2",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary/90",
        outline: "border border-border text-foreground hover:bg-surface",
        danger: "bg-danger text-white hover:bg-danger/90",
        ghost: "text-foreground hover:bg-surface",
      },
      size: { sm: "px-2 py-1 text-xs", md: "px-3 py-2", icon: "p-2" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...p }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} {...p} />
));
Button.displayName = "Button";

// --- Card -------------------------------------------------------------------
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface p-4", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-foreground mb-2", className)} {...p} />;
}

// --- Input / Select ---------------------------------------------------------
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn("rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary", className)} {...p} />
));
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn("rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary", className)} {...p} />
));
Select.displayName = "Select";

// --- Badge ------------------------------------------------------------------
const badge = cva("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      default: "bg-surface text-muted",
      ok: "bg-ok/15 text-ok",
      danger: "bg-danger/15 text-danger",
      warn: "bg-warn/15 text-warn",
      primary: "bg-primary/15 text-primary",
    },
  },
  defaultVariants: { tone: "default" },
});
export function Badge({ tone, className, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

// --- Table ------------------------------------------------------------------
export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-sm border-collapse", className)} {...p} />;
}
export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-t border-border px-3 py-2 align-top", className)} {...p} />;
}
export function Th({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("text-left text-xs uppercase tracking-wide text-muted px-3 py-2 border-b border-border", className)} {...p} />;
}

// --- Tabs -------------------------------------------------------------------
export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-border mb-4">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cn("px-3 py-2 text-sm -mb-px border-b-2", value === t ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground")}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
