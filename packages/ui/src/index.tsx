// packages/ui — shared brutalist UI primitives.
//
// Single source of truth for the platform's visual language (the "brutalist"
// cards, borders and shadows used across Studio/Web/Admin). Clients import
// these instead of re-implementing the same classes, keeping the look
// consistent without duplicating utility logic.

import type { ReactNode } from "react";

export interface PanelProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Brutalist panel: white card, 2px border, hard offset shadow. */
export function Panel({ title, icon, children, className = "" }: PanelProps) {
  return (
    <div className={`bg-white border-2 border-[#141414] shadow-[6px_6px_0px_0px_#141414] p-5 ${className}`}>
      <h3 className="text-sm font-black uppercase tracking-widest text-[#141414] flex items-center gap-2 mb-4 border-b-2 border-[#141414] pb-2">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "dark" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-[#E94E31] text-white hover:bg-[#141414]",
  dark: "bg-[#141414] text-white hover:bg-[#E94E31]",
  ghost: "bg-white text-[#141414] hover:bg-[#E4E3E0]",
};

/** Brutalist button: uppercase, 2px border, hard offset shadow. */
export function Button({ children, onClick, variant = "primary", disabled, className = "", type = "button" }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 font-black uppercase text-[10px] tracking-wider border-2 border-[#141414] shadow-[2px_2px_0px_0px_#141414] transition-all disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
