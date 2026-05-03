import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Variants alineadas 1:1 con la landing (.btn-primary, .btn-secondary,
// .btn-ghost): rounded-lg, font-semibold, padding 5x3 (=20px x 12px),
// hover primary-dark / bg-subtle. La landing usa shadow-sm en primary.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // .btn-primary
        default:
          "bg-[var(--primary)] text-white shadow-sm hover:bg-[var(--primary-dark)] active:bg-[var(--primary-dark)]",
        destructive:
          "bg-red-500 text-white shadow-sm hover:bg-red-600 active:bg-red-700",
        // .btn-secondary
        outline:
          "border border-[var(--color-border,#E2E8F0)] bg-white text-[var(--color-text-dark,#0F172A)] hover:bg-[var(--bg-subtle,#F8FAFC)]",
        secondary:
          "bg-[var(--bg-subtle,#F8FAFC)] text-[var(--color-text-dark,#0F172A)] hover:bg-slate-100",
        // .btn-ghost
        ghost:
          "font-medium text-[var(--color-text-dark,#0F172A)] hover:bg-[var(--bg-subtle,#F8FAFC)]",
        "ghost-primary":
          "font-medium text-[var(--primary)] hover:bg-[var(--primary-light)]",
        link:
          "font-medium text-[var(--primary)] underline-offset-4 hover:underline",
      },
      size: {
        // sm = h-9 px-4 (densidad media)
        sm: "h-9 px-4 text-sm",
        // default = .btn-primary de landing: py-3 px-5 text-sm => h-11
        default: "h-11 px-5 text-sm",
        md: "h-11 px-5 text-sm",
        // lg = más grande para CTAs hero (px-8 py-4)
        lg: "h-12 px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild: _asChild, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
