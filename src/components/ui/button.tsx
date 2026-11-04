import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold select-none transition-[background,opacity,transform] active:scale-[0.98] active:opacity-90 disabled:opacity-40 disabled:pointer-events-none [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink",
  secondary: "bg-surface text-ink border border-line active:bg-sunken",
  ghost: "text-ink hover:bg-ink/5",
  danger: "bg-danger text-surface",
};

const sizes: Record<Size, string> = {
  md: "h-12 px-4 text-base",
  lg: "h-14 px-5 text-[17px] w-full",
  icon: "h-12 w-12",
};

type Common = { variant?: Variant; size?: Size };

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & Common) {
  return (
    <button
      type="button"
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & Common) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
