import React from 'react';

interface WidgetContainerProps {
  children: React.ReactNode;
}

export function WidgetContainer({ children }: WidgetContainerProps) {
  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden rounded-[20px] border border-border-default bg-white"
      style={{
        boxShadow: `-197px 225px 84px 0px rgba(0,0,0,0),
          -126px 144px 77px 0px rgba(0,0,0,0.01),
          -71px 81px 65px 0px rgba(0,0,0,0.05),
          -32px 36px 48px 0px rgba(0,0,0,0.09),
          -8px 9px 26px 0px rgba(0,0,0,0.1)`,
      }}
    >
      {children}
    </div>
  );
}
