import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary empleaIA — bg primary, hover primary-dark.
        default:
          "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] active:bg-[var(--primary-dark)]",
        // Destructive: rojo, sin sombra agresiva.
        destructive:
          "bg-red-500 text-white hover:bg-red-600 active:bg-red-700",
        // Secondary "outline": white + border slate-300, hover slate-50.
        outline:
          "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900",
        // Secondary "fill": slate-100.
        secondary:
          "bg-slate-100 text-slate-700 hover:bg-slate-200",
        // Ghost: text primary, hover primary-light.
        ghost:
          "text-slate-700 hover:bg-slate-100",
        // Ghost-primary: para CTAs ligeras.
        "ghost-primary":
          "text-[var(--primary)] hover:bg-[var(--primary-light)]",
        // Link
        link:
          "text-[var(--primary)] underline-offset-4 hover:underline",
      },
      size: {
        // sm = px-3 py-1.5 text-sm (h-8)
        sm: "h-8 px-3 text-sm",
        // md = px-4 py-2 text-sm (h-9) — alineado con default
        default: "h-9 px-4 text-sm",
        md: "h-9 px-4 text-sm",
        // lg = px-5 py-2.5 text-base (h-11)
        lg: "h-11 px-5 text-base",
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
