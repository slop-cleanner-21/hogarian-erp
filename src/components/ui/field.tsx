import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

export const inputClass =
  "h-12 w-full rounded-field border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60";

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[15px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function NumberInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      className={cn(inputClass, "num text-right", className)}
      {...props}
    />
  );
}
