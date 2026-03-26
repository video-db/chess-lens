import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      // Position above the trigger, centered horizontally
      const top = -tooltipRect.height - 8; // 8px gap for arrow
      const left = (triggerRect.width - tooltipRect.width) / 2;

      setPosition({ top, left });
    }
  }, [isVisible]);

  return (
    <div
      ref={triggerRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          ref={tooltipRef}
          className="absolute z-50 pointer-events-none"
          style={{ top: position.top, left: position.left }}
        >
          <div
            className={cn(
              'h-[32px] px-[12px] flex items-center justify-center',
              'bg-[#1e1e1e] text-white text-[10px] font-medium',
              'rounded-[4px] whitespace-nowrap',
              'shadow-[0px_2.979px_4.468px_0px_rgba(0,2,40,0.14)]'
            )}
          >
            {content}
          </div>
          {/* Arrow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid #1e1e1e',
            }}
          />
        </div>
      )}
    </div>
  );
}
