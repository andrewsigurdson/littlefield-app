import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Config } from '../types';

interface InputPageProps {
  loading: boolean;
  error: string;
  parsedDataLength: number;
  currentSettings: Config;
  setCurrentSettings: (settings: Config) => void;
  cashOnHand: string;
  setCashOnHand: (value: string) => void;
  debt: string;
  setDebt: (value: string) => void;
  csvData: string;
}

const InputPage: React.FC<InputPageProps> = ({
  loading,
  error,
  parsedDataLength,
  currentSettings,
  setCurrentSettings,
  cashOnHand,
  setCashOnHand,
  debt,
  setDebt,
  csvData
}) => {
  const navigate = useNavigate();

  const handleRun = () => {
    if (loading) {
      alert('Please wait for data to finish loading');
      return;
    }
    if (error || !csvData) {
      alert('Please make sure the Excel file is loaded successfully');
      return;
    }
    if (!cashOnHand) {
      alert('Please enter cash on hand');
      return;
    }
    navigate('/testing');
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-blue-900">Littlefield Live Optimizer</h1>

      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-bold mb-4 text-gray-800">Step 1: Historical Data Status</h2>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-blue-600 font-medium">Loading data from Excel file...</div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border-2 border-red-300 rounded p-4">
              <p className="text-red-800 font-bold mb-2">Error loading data:</p>
              <p className="text-red-600 text-sm">{error}</p>
              <p className="text-gray-600 text-xs mt-3">
                Make sure "Consolidate Data-Daily Data.xlsx" exists in the /data folder
              </p>
            </div>
          ) : (
            <div className="bg-green-50 border-2 border-green-300 rounded p-4">
              <p className="text-green-800 font-bold mb-2">✓ Data loaded successfully!</p>
              <p className="text-gray-600 text-sm">
                Loaded {parsedDataLength} days of data from "Consolidate Data-Daily Data.xlsx"
              </p>
              <p className="text-gray-500 text-xs mt-2">
                To update data, replace the Excel file in the /data folder and refresh the page
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Step 2: Current Settings</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Lot Size (kits)</label>
                <input
                  type="number"
                  value={currentSettings.lotSize}
                  onChange={(e) => setCurrentSettings({...currentSettings, lotSize: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-gray-300 rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Contract</label>
                <select
                  value={currentSettings.contract}
                  onChange={(e) => setCurrentSettings({...currentSettings, contract: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-gray-300 rounded"
                >
                  <option value={1}>Contract 1 (7 day, $750)</option>
                  <option value={2}>Contract 2 (1 day, $1,000)</option>
                  <option value={3}>Contract 3 (0.5 day, $1,250)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 1 Machines</label>
                <input
                  type="number"
                  value={currentSettings.station1Machines}
                  onChange={(e) => setCurrentSettings({...currentSettings, station1Machines: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-gray-300 rounded"
                  min="1"
                  max="5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 2 Machines</label>
                <input
                  type="number"
                  value={currentSettings.station2Machines}
                  onChange={(e) => setCurrentSettings({...currentSettings, station2Machines: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-gray-300 rounded"
                  min="1"
                  max="5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 3 Machines</label>
                <input
                  type="number"
                  value={currentSettings.station3Machines}
                  onChange={(e) => setCurrentSettings({...currentSettings, station3Machines: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-gray-300 rounded"
                  min="1"
                  max="5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 2 Priority</label>
                <select
                  value={currentSettings.station2Priority}
                  onChange={(e) => setCurrentSettings({...currentSettings, station2Priority: e.target.value})}
                  className="w-full p-2 border-2 border-gray-300 rounded"
                >
                  <option value="FIFO">FIFO</option>
                  <option value="Step 2">Prioritize Step 2</option>
                  <option value="Step 4">Prioritize Step 4</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Step 3: Financial Status</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Cash on Hand ($1000s)</label>
                <input
                  type="number"
                  value={cashOnHand}
                  onChange={(e) => setCashOnHand(e.target.value)}
                  className="w-full p-2 border-2 border-blue-300 rounded"
                  placeholder="e.g., 52.916"
                  step="0.001"
                />
                <p className="text-xs text-gray-500 mt-1">Enter value in thousands</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Current Debt ($1000s)</label>
                <input
                  type="number"
                  value={debt}
                  onChange={(e) => setDebt(e.target.value)}
                  className="w-full p-2 border-2 border-blue-300 rounded"
                  placeholder="e.g., 0"
                  step="0.001"
                />
                <p className="text-xs text-gray-500 mt-1">Leave as 0 if no debt</p>
              </div>

              {cashOnHand && (
                <div className="mt-4 p-3 bg-blue-50 rounded">
                  <p className="text-sm font-medium">Net Cash Available:</p>
                  <p className="text-2xl font-bold text-blue-600">
                    ${((parseFloat(cashOnHand) || 0) - (parseFloat(debt) || 0)).toFixed(2)}k
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Machine Costs</h2>

            <div className="space-y-3">
              <div className="p-3 bg-blue-50 rounded">
                <p className="font-medium">Station 1 (Stuffer)</p>
                <p className="text-2xl font-bold text-blue-600">$90k</p>
              </div>

              <div className="p-3 bg-green-50 rounded">
                <p className="font-medium">Station 2 (Tester)</p>
                <p className="text-2xl font-bold text-green-600">$80k</p>
              </div>

              <div className="p-3 bg-yellow-50 rounded">
                <p className="font-medium">Station 3 (Tuner)</p>
                <p className="text-2xl font-bold text-yellow-600">$100k</p>
              </div>

              <div className="mt-4 p-3 bg-red-50 rounded border-2 border-red-300">
                <p className="text-xs font-bold text-red-700 mb-1">Debt Terms:</p>
                <p className="text-xs text-red-600">• 5% upfront fee</p>
                <p className="text-xs text-red-600">• 20% annual interest</p>
                <p className="text-xs text-red-600">• Can use debt to buy machines</p>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleRun}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg text-xl shadow-lg transition"
        >
          🚀 RUN OPTIMIZATION ALGORITHM
        </button>
      </div>
    </div>
  );
};

export default InputPage;
