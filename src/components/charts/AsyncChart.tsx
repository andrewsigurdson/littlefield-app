import React, { useState, useEffect, useTransition } from 'react';
import type { ReactNode } from 'react';
import { ChartLoader } from './ChartLoader';

interface AsyncChartProps {
  children: ReactNode;
  height?: number;
  title?: string;
  delay?: number; // Optional delay in ms before rendering
}

export const AsyncChart: React.FC<AsyncChartProps> = ({
  children,
  height = 300,
  title,
  delay = 0
}) => {
  const [isReady, setIsReady] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // Use setTimeout to defer rendering and allow other charts to start loading
    const timer = setTimeout(() => {
      startTransition(() => {
        setIsReady(true);
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  if (!isReady || isPending) {
    return <ChartLoader height={height} title={title} />;
  }

  return <>{children}</>;
};
