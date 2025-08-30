'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSessionData } from '@/contexts/DataContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUploadManager } from './_hooks/useUploadManager';

export default function UploadPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { setData } = useSessionData();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const {
    // State
    csvData,
    originalHeaders,
    columnMapping,
    showMapping,
    sortColumn,
    sortDirection,
    fileName,
    showAddressParsing,
    addressSourceColumn,
    hasFullAddressColumn,
    fullAddressColumn,
    importResult,
    isGeocoding,
    geocodingProgress,
    
    // Computed values
    sortedData,
    displayData,
    requiredForMapping,
    hasValidAddressMapping,
    missingMappings,
    
    // Actions
    addFiles,
    startUpload,
    clearFiles,
    removeRow,
    retryRow,
    applyMapping,
    applyAddressParsing,
    handleSort,
    handleCellEdit,
    downloadCSV,
    getSortIcon,
    
    // Setters
    setColumnMapping,
    setShowMapping,
    setShowAddressParsing,
    setAddressSourceColumn,
    
    // Constants
    REQUIRED_HEADERS,
    DISPLAY_HEADERS,
    MAX_ROWS,
  } = useUploadManager(user?.id);

  const validateDate = (dateStr: string): boolean => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return !isNaN(d.getTime());
  };

  const validatePrice = (priceStr: string): boolean => {
    if (!priceStr) return false;
    const n = parseFloat(priceStr.replace(/[$,]/g, ''));
    return !isNaN(n) && n >= 0;
  };

  const handleFileUpload = (file: File) => {
    addFiles(file);
  };

  const handleGeocode = () => {
    startUpload();
  };

  const handleViewReport = () => {
    if (csvData.length === 0) {
      toast.error('No data to report. Please upload and process a CSV first.');
      return;
    }

    // Convert csvData to the format expected by the session store
    setData({ rows: csvData });
    router.push('/report');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden p-6">
      {/* Optional background effect */}
      {/* <div className='absolute inset-0 bg-[url("data:image/svg+xml,...")] opacity-20'></div> */}

      <div className="relative z-10 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              CSV Upload
            </span>
            <span className="text-white"> &amp; Management</span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto">
            Transform your data with intelligent processing and visualization
          </p>
        </div>

        {/* File Upload */}
        <div className="glass-card border-2 border-dashed border-white/20 p-12 mb-8 text-center hover:border-emerald-400/50 transition-all duration-300">
          {hasFullAddressColumn && !showMapping && !showAddressParsing && (
            <div className="mb-6 p-4 glass-card border border-emerald-400/30 rounded-xl">
              <div className="flex items-center justify-center text-emerald-400">
                <span className="mr-2">✓</span>
                <span className="text-sm font-semibold">
                  Full address detected in column "{fullAddressColumn}". We'll auto-split what we can and geocode the rest
                  later.
                </span>
              </div>
            </div>
          )}

          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
            className="hidden"
            id="csv-upload"
          />
          <label htmlFor="csv-upload" className="cursor-pointer block">
            <div className="text-6xl mb-6 opacity-60">📄</div>
            <div className="text-2xl font-bold text-white mb-3">Click to upload CSV or Excel file</div>
            <div className="text-slate-400">Drag and drop your CSV (.csv) or Excel (.xlsx, .xls) file here</div>
            <div className="text-xs text-slate-500 mt-2">Supported formats: CSV, Excel (.xlsx, .xls)</div>
          </label>
        </div>

        {/* Column Mapping */}
        {showMapping && originalHeaders.length > 0 && (
          <div className="glass-card p-8 mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">Map Your Columns</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowMapping(false)}
                  className="glass-button px-6 py-3 text-slate-300 hover:text-white transition-colors"
                >
                  Skip Mapping
                </button>
                <button
                  onClick={applyMapping}
                  disabled={!hasValidAddressMapping() || !columnMapping.name || !columnMapping.service_date || !columnMapping.price}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-xl font-semibold transition-all duration-300"
                >
                  Apply Mapping
                </button>
                <button
                  onClick={() => {
                    applyMapping();
                    setShowAddressParsing(true);
                    setShowMapping(false);
                  }}
                  disabled={!hasValidAddressMapping() || !columnMapping.name || !columnMapping.service_date || !columnMapping.price}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-xl font-semibold transition-all duration-300"
                >
                  🏠 Map &amp; Parse Address
                </button>
              </div>
            </div>

            <p className="text-slate-300 mb-8">We've automatically suggested column mappings. Please review and adjust as needed.</p>

            <div className="grid gap-4">
              {requiredForMapping.map((requiredHeader) => (
                <div key={requiredHeader} className="flex items-center gap-6 p-6 glass-card">
                  <div className="w-32">
                    <label className="block text-sm font-bold text-white mb-2">{requiredHeader}</label>
                    <span className="text-xs text-slate-400">
                      {['street', 'city', 'state', 'zip'].includes(requiredHeader) && columnMapping.full_address
                        ? 'Optional (have full address)'
                        : requiredHeader === 'full_address' && hasValidAddressMapping()
                        ? 'Optional (have address parts)'
                        : 'Required'}
                    </span>
                  </div>

                  <div className="flex-1">
                    <select
                      value={columnMapping[requiredHeader] || ''}
                      onChange={(e) =>
                        setColumnMapping((prev) => ({
                          ...prev,
                          [requiredHeader]: e.target.value,
                        }))
                      }
                      className="w-full p-3 glass-card border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-white bg-white/5"
                    >
                      <option value="" className="bg-slate-800">
                        Select a column...
                      </option>
                      {originalHeaders.map((header) => (
                        <option key={header} value={header} className="bg-slate-800">
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>

                  {columnMapping[requiredHeader] && <div className="text-emerald-400 text-sm font-semibold">✓ Mapped</div>}
                </div>
              ))}
            </div>

            {missingMappings.length > 0 && (
              <div className="mt-6 p-4 glass-card border border-yellow-400/30 rounded-xl">
                <p className="text-yellow-400 font-semibold">
                  {!hasValidAddressMapping() ? (
                    <>Please map either "full_address" OR all address parts (street, city, state, zip)</>
                  ) : (
                    <>Please map the following required columns: {missingMappings.join(', ')}</>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Address Parsing */}
        {showAddressParsing && originalHeaders.length > 0 && (
          <div className="glass-card p-8 mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">Parse Full Address</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAddressParsing(false);
                    setShowMapping(true);
                  }}
                  className="glass-button px-6 py-3 text-slate-300 hover:text-white transition-colors"
                >
                  Back to Mapping
                </button>
                <button
                  onClick={applyAddressParsing}
                  disabled={!addressSourceColumn}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-xl font-semibold transition-all duration-300"
                >
                  Parse Addresses
                </button>
              </div>
            </div>

            <p className="text-slate-300 mb-8">
              Select which column contains the full address, and we'll automatically split it into street, city, state, and ZIP components.
            </p>

            <div className="space-y-4">
              <div className="p-6 glass-card">
                <label className="block text-sm font-bold text-white mb-3">Select the column that contains the full address:</label>
                <select
                  value={addressSourceColumn}
                  onChange={(e) => setAddressSourceColumn(e.target.value)}
                  className="w-full p-4 glass-card border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-white bg-white/5"
                >
                  <option value="" className="bg-slate-800">
                    Choose a column...
                  </option>
                  {(showMapping ? originalHeaders : REQUIRED_HEADERS).map((header) => (
                    <option key={header} value={header} className="bg-slate-800">
                      {header}
                    </option>
                  ))}
                </select>
              </div>

              {addressSourceColumn && displayData.length > 0 && (
                <div className="p-6 glass-card border border-blue-400/30 rounded-xl">
                  <h3 className="font-bold text-blue-400 mb-4">Preview of address parsing:</h3>
                  <div className="space-y-2 text-sm">
                    {displayData.slice(0, 3).map((row, idx) => {
                      const full = row[addressSourceColumn] || '';
                      // Note: parseAddress function is now in the hook, but we can recreate a simple version here for preview
                      const address = full.trim();
                      const zipMatch = address.match(/\b(\d{5}(?:-\d{4})?)\b/);
                      const zip = zipMatch ? zipMatch[1] : '';
                      const stateMatch = address.match(/\b([A-Z]{2})\s*$/);
                      const state = stateMatch ? stateMatch[1] : '';
                      const parts = address.split(/,\s*|\s{2,}/);
                      const street = parts[0]?.trim() || '';
                      const city = parts.slice(1).join(' ').trim() || '';
                      
                      return (
                        <div key={idx} className="glass-card p-4 rounded-xl border border-white/10">
                          <div className="font-semibold text-white mb-2">Original: {full}</div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                            <div>
                              <span className="text-emerald-400 font-semibold">Street:</span> {street}
                            </div>
                            <div>
                              <span className="text-emerald-400 font-semibold">City:</span> {city}
                            </div>
                            <div>
                              <span className="text-emerald-400 font-semibold">State:</span> {state}
                            </div>
                            <div>
                              <span className="text-emerald-400 font-semibold">ZIP:</span> {zip}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Import Results */}
        {importResult && (
          <div className="glass-card p-8 mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">Import Results</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="glass-card p-6 rounded-xl text-center border border-blue-400/30">
                <div className="text-3xl font-bold text-blue-400">{importResult.total}</div>
                <div className="text-sm text-slate-300">Total Rows</div>
              </div>
              <div className="glass-card p-6 rounded-xl text-center border border-emerald-400/30">
                <div className="text-3xl font-bold text-emerald-400">{importResult.inserted}</div>
                <div className="text-sm text-slate-300">Inserted</div>
              </div>
              <div className="glass-card p-6 rounded-xl text-center border border-yellow-400/30">
                <div className="text-3xl font-bold text-yellow-400">{importResult.skipped}</div>
                <div className="text-sm text-slate-300">Skipped</div>
              </div>
              <div className="glass-card p-6 rounded-xl text-center border border-red-400/30">
                <div className="text-3xl font-bold text-red-400">{importResult.errors.length}</div>
                <div className="text-sm text-slate-300">Errors</div>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="glass-card border border-red-400/30 rounded-xl p-6">
                <h3 className="font-bold text-red-400 mb-3">Errors:</h3>
                <ul className="text-sm text-slate-300 space-y-1">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Data Table */}
        {csvData.length > 0 && !showMapping && !showAddressParsing && (
          <div className="glass-card overflow-hidden mb-8">
            <div className="flex justify-between items-center p-6 border-b border-white/10">
              <div className="text-xl font-bold text-white">
                Data Preview ({csvData.length.toLocaleString()} rows)
                {csvData.length === MAX_ROWS && (
                  <span className="text-sm text-slate-400 ml-2">(showing first {MAX_ROWS.toLocaleString()} rows)</span>
                )}
              </div>
              <div className="flex gap-2">
                {columnMapping.full_address && (
                  <div className="text-sm text-emerald-400 flex items-center mr-4">
                    <span className="mr-1">✓</span>
                    Using full address from "{columnMapping.full_address}"
                  </div>
                )}
                <button
                  onClick={() => setShowAddressParsing(true)}
                  className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300"
                >
                  🏠 Parse Address
                </button>
                <button
                  onClick={() => setShowMapping(true)}
                  className="glass-button text-white px-6 py-3 font-semibold transition-all duration-300"
                >
                  🔄 Remap Columns
                </button>
                <button
                  onClick={downloadCSV}
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300"
                >
                  📥 Download Cleaned CSV
                </button>
                <button
                  onClick={handleGeocode}
                  disabled={isGeocoding}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-600 disabled:to-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300"
                >
                  {isGeocoding
                    ? geocodingProgress
                      ? `🔄 Geocoding... ${geocodingProgress.current}/${geocodingProgress.total}`
                      : '🔄 Geocoding...'
                    : '🌍 Geocode Addresses'}
                </button>
                <button
                  onClick={handleViewReport}
                  className="bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 hover:scale-105"
                >
                  📊 View Map & Zip Report
                </button>
              </div>
            </div>

            <div className="overflow-auto max-h-96">
              <table className="w-full">
                <thead>
                  <tr>
                    {DISPLAY_HEADERS.filter(
                      (header) =>
                        (REQUIRED_HEADERS.includes(header) && columnMapping[header]) ||
                        (header === 'full_address' && columnMapping.full_address) ||
                        (!columnMapping.full_address && ['street', 'city', 'state', 'zip'].includes(header)) ||
                        ['lat', 'lng'].includes(header),
                    ).map((header) => (
                      <th
                        key={header}
                        onClick={() => handleSort(header)}
                        className="px-6 py-4 text-left text-sm font-bold text-white cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10"
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">{header === 'lat' ? 'Lat' : header === 'lng' ? 'Lng' : header}</span>
                          <span className="ml-2 text-slate-400">{getSortIcon(header)}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                        No data to display
                      </td>
                    </tr>
                  )}
                  {sortedData.slice(0, 100).map((row, rowIndex) => (
                    <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white/5' : 'bg-white/10'}>
                      {DISPLAY_HEADERS.filter(
                        (header) =>
                          (REQUIRED_HEADERS.includes(header) && columnMapping[header]) ||
                          (header === 'full_address' && columnMapping.full_address) ||
                          (!columnMapping.full_address && ['street', 'city', 'state', 'zip'].includes(header)) ||
                          ['lat', 'lng'].includes(header),
                      ).map((header) => {
                        const value = row[header] ?? '';
                        const isInvalidDate = header === 'service_date' && !validateDate(value);
                        const isInvalidPrice = header === 'price' && !validatePrice(value);
                        const isReadOnlyGeocode = ['lat', 'lng'].includes(header);
                        const hasError = isInvalidDate || isInvalidPrice;

                        return (
                          <td
                            key={header}
                            className={`px-6 py-3 text-sm border-b border-white/10 ${
                              hasError ? 'bg-red-500/20' : isReadOnlyGeocode ? 'bg-blue-500/20' : ''
                            }`}
                          >
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => !isReadOnlyGeocode && handleCellEdit(rowIndex, header, e.target.value)}
                              readOnly={isReadOnlyGeocode}
                              className={`w-full bg-transparent border-none outline-none rounded-lg px-3 py-2 ${
                                isReadOnlyGeocode
                                  ? 'cursor-default text-blue-400 font-mono text-xs'
                                  : 'focus:bg-white/10 focus:shadow-lg focus:border focus:border-emerald-400/50 text-white'
                              } ${hasError ? 'text-red-400' : isReadOnlyGeocode ? 'text-blue-400' : 'text-white'}`}
                              title={
                                hasError
                                  ? isInvalidDate
                                    ? 'Invalid date format'
                                    : 'Invalid price format'
                                  : isReadOnlyGeocode
                                  ? 'Geocoded coordinate (read-only)'
                                  : value
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {sortedData.length > 100 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-4 text-center text-slate-400 bg-yellow-500/10 border-t border-yellow-400/30">
                        Showing first 100 of {sortedData.length.toLocaleString()} rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Instructions */}
        {csvData.length === 0 && !showMapping && !showAddressParsing && (
          <div className="glass-card p-8">
            <h2 className="text-2xl font-bold text-white mb-6">Instructions</h2>
            <div className="space-y-4 text-slate-300">
              <p>• Upload a CSV or Excel file - the system will automatically try to map columns to required headers</p>
              <p>• Review and adjust column mappings if needed</p>
              <p>• Use "Parse Address" if your CSV contains full addresses that need to be split</p>
              <p>
                • Required headers:{' '}
                <span className="font-mono bg-white/10 px-3 py-1 rounded-lg text-emerald-400">
                  name, service_date, price, street, city, state, zip
                </span>
              </p>
              <p>• Click column headers to sort the data</p>
              <p>• Edit cells directly in the table</p>
              <p>
                • Invalid dates and prices will be highlighted in <span className="text-red-400">red</span>
              </p>
              <p>• Download the cleaned data as a new CSV file</p>
              <p>
                • Only the first <span className="text-emerald-400 font-semibold">{MAX_ROWS.toLocaleString()} rows</span> are
                display-limited for performance
              </p>
              <p className="text-emerald-400">• Supported file formats: CSV (.csv), Excel (.xlsx, .xls)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
