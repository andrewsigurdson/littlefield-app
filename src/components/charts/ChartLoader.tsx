import React from 'react';

interface ChartLoaderProps {
  height?: number;
  title?: string;
}

export const ChartLoader: React.FC<ChartLoaderProps> = ({
  height = 300,
  title
}) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {title && (
        <div className="mb-4">
          <div className="h-6 bg-gray-200 rounded w-2/3 animate-pulse"></div>
        </div>
      )}
      <div
        className="flex items-center justify-center bg-gray-50 rounded"
        style={{ height: `${height}px` }}
      >
        <div className="flex flex-col items-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-500">Loading chart...</p>
        </div>
      </div>
    </div>
  );
};
