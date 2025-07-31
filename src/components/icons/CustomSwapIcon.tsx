import React from 'react';

interface Props {
  width?: number;
  height?: number;
  className?: string;
}

export function CustomSwapIcon({ width = 20, height = 20, className }: Props) {
  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox="0 0 670.41 670.41"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>
          {`
            .cls-1 {
              fill: #fff;
            }
            .cls-2 {
              fill: #7aaede;
            }
          `}
        </style>
      </defs>
      <circle className="cls-2" cx="335.21" cy="335.21" r="335.21" />
      <path
        className="cls-1"
        d="m240.08,280.95h207.05l-37.04,37.04c-6.66,6.66-6.66,17.45,0,24.11,3.33,3.33,7.69,4.99,12.05,4.99s8.73-1.66,12.05-4.99l66.14-66.14c3.2-3.2,4.99-7.53,4.99-12.05s-1.8-8.86-4.99-12.05l-66.14-66.14c-6.66-6.66-17.45-6.66-24.11,0-6.66,6.66-6.66,17.45,0,24.11l37.04,37.03h-207.05c-9.42,0-17.05,7.63-17.05,17.05s7.63,17.05,17.05,17.05Z"
      />
      <path
        className="cls-1"
        d="m236.2,484.7c3.33,3.33,7.69,4.99,12.05,4.99s8.73-1.66,12.05-4.99c6.66-6.66,6.66-17.45,0-24.11l-37.04-37.04h207.05c9.42,0,17.05-7.63,17.05-17.05s-7.63-17.05-17.05-17.05h-207.05l37.04-37.04c6.66-6.66,6.66-17.45,0-24.11-6.66-6.66-17.45-6.66-24.11,0l-66.14,66.14c-6.66,6.66-6.66,17.45,0,24.11l66.14,66.14Z"
      />
    </svg>
  );
}