import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base styles
          'flex h-[50px] w-full rounded-[12px] border bg-input-bg px-[16px] py-[14px] text-base font-medium text-text-label transition-colors',
          // Placeholder
          'placeholder:text-text-muted-brand placeholder:font-medium',
          // Default border
          'border-border-input',
          // Hover
          'hover:border-input-hover hover:bg-white',
          // Focus: brand orange border + ring
          'focus-visible:outline-none focus-visible:bg-white focus-visible:border-input-focus focus-visible:shadow-[0_0_0_3px_var(--color-input-focus-ring)]',
          // Disabled
          'disabled:cursor-not-allowed disabled:opacity-50',
          // File input reset
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
