import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-1 focus:ring-zinc-500',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-zinc-800 text-zinc-50 shadow',
        secondary: 'border-transparent bg-zinc-700 text-zinc-200',
        destructive: 'border-transparent bg-red-600 text-zinc-50 shadow',
        success: 'border-transparent bg-emerald-600 text-zinc-50 shadow',
        outline: 'border-zinc-600 text-zinc-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
