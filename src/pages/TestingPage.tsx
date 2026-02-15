import React from 'react';
import type { Recommendations } from '../types';

interface TestingPageProps {
  recommendations: Recommendations;
}

const TestingPage: React.FC<TestingPageProps> = ({
  recommendations
}) => {
  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-blue-900">Littlefield Live Optimizer - Testing</h1>

      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6 rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold mb-2">Optimization Results</h2>
          <p className="text-blue-100">Analysis based on last 14 days (Days {recommendations.analysis.currentDay - 13} - {recommendations.analysis.currentDay})</p>
        </div>

        {/* Revenue Projection for Recommended Config - Continues in next part due to length */}
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600">
            This section is currently a placeholder. The original content may have been truncated.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TestingPage;
