'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

export type CsvRow = Record<string, string>;

export interface SessionData {
  rows: CsvRow[];
}

interface DataContextType {
  data: SessionData | null;
  setData: (data: SessionData | null) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

interface DataProviderProps {
  children: ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
  const [data, setData] = useState<SessionData | null>(null);

  return (
    <DataContext.Provider value={{ data, setData }}>
      {children}
    </DataContext.Provider>
  );
}

export function useSessionData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useSessionData must be used within a DataProvider');
  }
  return context;
}