import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import * as XLSX from 'xlsx';
import type { Config } from '../types';

interface LittlefieldContextValue {
  csvData: string;
  setCsvData: (data: string) => void;
  dataFileName: string;
  setDataFileName: (name: string) => void;
  transactionData: string;
  setTransactionData: (data: string) => void;
  transactionFileName: string;
  setTransactionFileName: (name: string) => void;
  cashOnHand: string;
  setCashOnHand: (cash: string) => void;
  debt: string;
  setDebt: (debt: string) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string;
  setError: (error: string) => void;
  currentSettings: Config;
  setCurrentSettings: (settings: Config) => void;
  testSettings: Config;
  setTestSettings: (settings: Config) => void;
  handleFileUpload: (file: File) => Promise<void>;
  handleTransactionFileUpload: (file: File) => Promise<void>;
}

const LittlefieldContext = createContext<LittlefieldContextValue | undefined>(undefined);

// Initial system defaults (before any transactions)
const defaultSettings: Config = {
  lotSize: 60,
  contract: 1,
  station1Machines: 3,
  station2Machines: 1,
  station3Machines: 1,
  station2Priority: 'FIFO',
  materialReorderPoint: 1200,
  materialOrderQty: 7200
};

export const LittlefieldProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [csvData, setCsvData] = useState('');
  const [dataFileName, setDataFileName] = useState('');
  const [transactionData, setTransactionData] = useState('');
  const [transactionFileName, setTransactionFileName] = useState('');
  const [cashOnHand, setCashOnHand] = useState('');
  const [debt, setDebt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentSettings, setCurrentSettings] = useState<Config>(defaultSettings);
  const [testSettings, setTestSettings] = useState<Config>(() => ({
    ...defaultSettings
  }));

  const handleFileUpload = async (file: File) => {
    try {
      setLoading(true);
      setError('');
      setDataFileName(file.name);

      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Get the first sheet
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      // Convert to tab-separated values (TSV)
      const tsvData = XLSX.utils.sheet_to_csv(firstSheet, { FS: '\t' });

      setCsvData(tsvData);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading Excel file');
      setLoading(false);
    }
  };

  const handleTransactionFileUpload = async (file: File) => {
    try {
      setTransactionFileName(file.name);

      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Get the first sheet
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      // Convert to tab-separated values (TSV)
      const tsvData = XLSX.utils.sheet_to_csv(firstSheet, { FS: '\t' });

      setTransactionData(tsvData);
    } catch (err) {
      // Don't set error state - transaction history is optional
    }
  };

  const value: LittlefieldContextValue = {
    csvData,
    setCsvData,
    dataFileName,
    setDataFileName,
    transactionData,
    setTransactionData,
    transactionFileName,
    setTransactionFileName,
    cashOnHand,
    setCashOnHand,
    debt,
    setDebt,
    loading,
    setLoading,
    error,
    setError,
    currentSettings,
    setCurrentSettings,
    testSettings,
    setTestSettings,
    handleFileUpload,
    handleTransactionFileUpload
  };

  return (
    <LittlefieldContext.Provider value={value}>
      {children}
    </LittlefieldContext.Provider>
  );
};

export const useLittlefield = () => {
  const context = useContext(LittlefieldContext);
  if (!context) {
    throw new Error('useLittlefield must be used within LittlefieldProvider');
  }
  return context;
};
