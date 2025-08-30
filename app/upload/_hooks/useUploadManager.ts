'use client';

import { useState, useMemo } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseFullAddressToParts, isFullAddressHeader } from '@/lib/addresses';
import { toast } from 'sonner';
import { createClient } from '@/utils/supabase/client';

interface CSVRow {
  [key: string]: any;
}

interface ImportResult {
  total: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

type SortDirection = 'asc' | 'desc' | null;

const REQUIRED_HEADERS = [
  'name',
  'service_date',
  'price',
  'street',
  'city',
  'state',
  'zip',
  'full_address',
];

const DISPLAY_HEADERS = [
  'name',
  'service_date',
  'price',
  'street',
  'city',
  'state',
  'zip',
  'full_address',
  'lat',
  'lng',
];

const MAX_ROWS = 1000;

// Suggestions for auto-mapping user CSV headers
const HEADER_SUGGESTIONS: Record<string, string[]> = {
  name: ['name', 'customer_name', 'client_name', 'full_name', 'customer', 'client'],
  service_date: ['service_date', 'date', 'service_dt', 'appointment_date', 'visit_date', 'created_date'],
  price: ['price', 'amount', 'cost', 'total', 'fee', 'charge', 'payment'],
  street: ['street', 'address', 'street_address', 'addr1', 'address1', 'street1', 'full_address'],
  city: ['city', 'town', 'municipality'],
  state: ['state', 'province', 'region', 'st'],
  zip: ['zip', 'zipcode', 'postal_code', 'postcode', 'zip_code'],
  full_address: ['full_address', 'address', 'addr', 'street_address', 'location', 'address_1', 'full_addr', 'complete_address'],
};

// Minimal inline full-address parser as a fallback preview
const parseAddress = (fullAddress: string) => {
  if (!fullAddress) return { street: '', city: '', state: '', zip: '' };
  const address = fullAddress.trim();

  // ZIP (5 or 9)
  const zipMatch = address.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  let remaining = zip && zipMatch ? address.replace(zipMatch[0], '').trim() : address;

  // State (2 letters at end)
  const stateMatch = remaining.match(/\b([A-Z]{2})\s*$/);
  const state = stateMatch ? stateMatch[1] : '';
  remaining = state && stateMatch ? remaining.replace(stateMatch[0], '').trim() : remaining;

  // Split street/city
  const parts = remaining.split(/,\s*|\s{2,}/);
  let street = '';
  let city = '';

  if (parts.length >= 2) {
    street = parts[0].trim();
    city = parts.slice(1).join(' ').trim();
  } else if (parts.length === 1) {
    const streetSuffixes = /\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Pl|Place|Way|Circle|Cir)\b/i;
    const match = remaining.match(new RegExp(`^(.+?${streetSuffixes.source})\\s+(.+)$`, 'i'));
    if (match) {
      street = match[1].trim();
      city = match[2].trim();
    } else {
      const words = remaining.split(/\s+/);
      if (words.length > 3) {
        street = words.slice(0, Math.ceil(words.length / 2)).join(' ');
        city = words.slice(Math.ceil(words.length / 2)).join(' ');
      } else {
        street = remaining;
      }
    }
  }

  return {
    street: street.replace(/,$/, '').trim(),
    city: city.replace(/,$/, '').trim(),
    state,
    zip,
  };
};

// Concurrency-limited geocoder that runs before DB insert
async function geocodeAll(
  rows: CSVRow[],
  makeAddress: (r: CSVRow) => string,
  onProgress?: (done: number, total: number) => void,
  concurrency = 5
) {
  let i = 0;
  const total = rows.length;
  const out = [...rows];

  async function worker() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = i++;
      if (idx >= total) break;

      const r = out[idx];
      const address = makeAddress(r).trim();
      if (!address) {
        onProgress?.(idx + 1, total);
        continue;
      }

      try {
        const res = await fetch('/api/geocode-address', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });

        if (res.ok) {
          const { lat, lng, zip } = await res.json();
          if (lat && lng) {
            out[idx] = {
              ...r,
              lat: String(lat),
              lng: String(lng),
              zip: zip ?? r.zip,
              needs_geocode: 'false',
            };
          } else {
            out[idx] = { ...r, needs_geocode: 'false' };
          }
        } else {
          out[idx] = { ...r, needs_geocode: 'false' };
        }
      } catch {
        out[idx] = { ...r, needs_geocode: 'false' };
      }

      onProgress?.(idx + 1, total);
      // gentle pacing
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return out;
}

const parseExcelFile = (file: File): Promise<{ data: CSVRow[]; headers: string[] }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Use the first worksheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert to JSON with header row
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          raw: false, // format dates/numbers as strings
        }) as string[][];

        if (jsonData.length === 0) {
          reject(new Error('Excel file is empty'));
          return;
        }

        // First row is headers
        const headers = jsonData[0] as string[];

        // Convert remaining rows to objects
        const rows: CSVRow[] = jsonData.slice(1).map((row) => {
          const obj: CSVRow = {};
          headers.forEach((header, index) => {
            obj[header] = row[index] || '';
          });
          return obj;
        });

        resolve({ data: rows, headers });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read Excel file'));
    reader.readAsArrayBuffer(file);
  });
};

const parseCSVFile = (file: File): Promise<{ data: CSVRow[]; headers: string[] }> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = (results.data as CSVRow[]).slice(0, MAX_ROWS);
        const headers = results.meta.fields || [];
        resolve({ data, headers });
      },
      error: (error) => {
        reject(error);
      },
    });
  });
};

// Geocode rows one-by-one (gentle pacing). Keeps existing lat/lng if present.
async function geocodeRows(
  rows: CSVRow[],
  pickAddress: (row: CSVRow) => string
): Promise<CSVRow[]> {
  const out: CSVRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const address = (pickAddress(row) || '').trim();

    if (row.lat && row.lng) {
      out.push(row);
    } else if (!address) {
      out.push({ ...row, lat: row.lat ?? '', lng: row.lng ?? '' });
    } else {
      try {
        const res = await fetch('/api/geocode-address', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
        if (res.ok) {
          const g = await res.json();
          out.push({
            ...row,
            lat: g.lat ? String(g.lat) : row.lat ?? '',
            lng: g.lng ? String(g.lng) : row.lng ?? '',
            // opportunistically fill ZIP from geocoder if provided
            zip:
              g.zip ||
              row.zip ||
              row.postal_code ||
              row.Zip ||
              row.ZIP ||
              row.zipcode ||
              row.postcode ||
              '',
          });
        } else {
          out.push({ ...row, lat: row.lat ?? '', lng: row.lng ?? '' });
        }
      } catch {
        out.push({ ...row, lat: row.lat ?? '', lng: row.lng ?? '' });
      }
    }

    if (i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return out;
}

export function useUploadManager(userId: string | undefined) {
  // State
  const [csvData, setCsvData] = useState<CSVRow[]>([]);
  const [originalHeaders, setOriginalHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [fileName, setFileName] = useState<string>('');
  const [showAddressParsing, setShowAddressParsing] = useState(false);
  const [addressSourceColumn, setAddressSourceColumn] = useState<string>('');
  const [hasFullAddressColumn, setHasFullAddressColumn] = useState(false);
  const [fullAddressColumn, setFullAddressColumn] = useState<string>('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState<{ current: number; total: number } | null>(null);

  // Computed values
  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) return csvData;
    return [...csvData].sort((a, b) => {
      const aVal = a[sortColumn] ?? '';
      const bVal = b[sortColumn] ?? '';
      return sortDirection === 'asc'
        ? String(aVal).localeCompare(String(bVal), undefined, { numeric: true })
        : String(bVal).localeCompare(String(aVal), undefined, { numeric: true });
    });
  }, [csvData, sortColumn, sortDirection]);

  const displayData = showMapping ? csvData : sortedData;

  // Helper functions
  const suggestMapping = (headers: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    REQUIRED_HEADERS.forEach((required) => {
      const suggestions = HEADER_SUGGESTIONS[required] || [];
      const exact = headers.find((h) => h.toLowerCase() === required.toLowerCase());
      if (exact) {
        mapping[required] = exact;
        return;
      }
      for (const s of suggestions) {
        const match = headers.find(
          (h) => h.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(h.toLowerCase()),
        );
        if (match) {
          mapping[required] = match;
          break;
        }
      }
    });

    if (mapping.full_address) {
      setHasFullAddressColumn(true);
      setFullAddressColumn(mapping.full_address);
    }
    return mapping;
  };

  const getRequiredForMapping = () => {
    const baseReq = ['name', 'service_date', 'price'];
    const hasFullAddr = columnMapping.full_address;
    const hasParts = columnMapping.street && columnMapping.city && columnMapping.state && columnMapping.zip;
    if (hasFullAddr) return [...baseReq, 'full_address'];
    if (hasParts) return [...baseReq, 'street', 'city', 'state', 'zip'];
    return [...baseReq, 'street', 'city', 'state', 'zip', 'full_address'];
  };

  const requiredForMapping = getRequiredForMapping();

  const hasValidAddressMapping = () =>
    !!columnMapping.full_address ||
    (columnMapping.street && columnMapping.city && columnMapping.state && columnMapping.zip);

  const missingMappings = requiredForMapping.filter((h) => {
    if (['street', 'city', 'state', 'zip'].includes(h) && columnMapping.full_address) return false;
    if (h === 'full_address' && hasValidAddressMapping()) return false;
    return !columnMapping[h];
  });

  // Actions
  const addFiles = async (file: File) => {
    if (!userId) {
      toast.error('You must be logged in to upload data.');
      return;
    }

    setFileName(file.name);

    try {
      // 1) Parse file
      const fileExtension = file.name.toLowerCase().split('.').pop();
      let parseResult: { data: CSVRow[]; headers: string[] };

      if (fileExtension === 'csv') {
        parseResult = await parseCSVFile(file);
      } else if (['xlsx', 'xls'].includes(fileExtension || '')) {
        parseResult = await parseExcelFile(file);
      } else {
        toast.error('Unsupported file format. Please upload a CSV or Excel file.');
        return;
      }

      const { data, headers: fileHeaders } = parseResult;
      const limitedData = data.slice(0, MAX_ROWS);

      setOriginalHeaders(fileHeaders);

      // 2) Pre-process full address if provided
      const fullHeader = fileHeaders.find((h) => isFullAddressHeader(h));
      let processedData = limitedData;
      if (fullHeader) {
        setHasFullAddressColumn(true);
        setFullAddressColumn(fullHeader);
        processedData = processedData.map((row) => {
          const full = row[fullHeader];
          if (full) {
            const parsed = parseFullAddressToParts(full);
            return {
              ...row,
              street: row.street || parsed.street || '',
              city: row.city || parsed.city || '',
              state: row.state || parsed.state || '',
              zip: row.zip || parsed.zip || '',
              full_address: full,
            };
          }
          return row;
        });
      }

      setCsvData(processedData);
      const suggestedMapping = suggestMapping(fileHeaders);
      setColumnMapping(suggestedMapping);

      const missing = REQUIRED_HEADERS.filter((h) => !suggestedMapping[h]);
      if (missing.length > 0) {
        setShowMapping(true);
      }

      if (data.length > MAX_ROWS) {
        toast.info(
          `File contains ${data.length.toLocaleString()} rows. Only the first ${MAX_ROWS.toLocaleString()} will be processed and saved.`
        );
      }

      // 3) Geocode BEFORE saving (so lat/lng are in DB)
      const addressFromRow = (r: CSVRow) => {
        const full = r[suggestedMapping.full_address] || r.full_address;
        if (full && String(full).trim()) return String(full);

        const street = r[suggestedMapping.street] || r.street || '';
        const city   = r[suggestedMapping.city]   || r.city   || '';
        const state  = r[suggestedMapping.state]  || r.state  || '';
        const zip    = r[suggestedMapping.zip]    || r.zip    || '';
        return [street, city, state, zip].filter(Boolean).join(', ');
      };

      setIsGeocoding(true);
      setGeocodingProgress({ current: 0, total: processedData.length });

      const geocoded = await geocodeRows(processedData, addressFromRow);

      setIsGeocoding(false);
      setGeocodingProgress(null);

      // 4) Map to DB schema (now includes lat/lng)
      const jobsToInsert = geocoded.map((row) => {
        const priceStr = String(row[suggestedMapping.price] || '0').replace(/[$,]/g, '');
        return {
          workspace_id: userId,
          customer_name: row[suggestedMapping.name] || null,
          job_date: row[suggestedMapping.service_date] || null,
          revenue: parseFloat(priceStr) || 0,
          address_line1: row[suggestedMapping.street] || null,
          city: row[suggestedMapping.city] || null,
          state: row[suggestedMapping.state] || null,
          zip: row[suggestedMapping.zip] || null,
          full_address: row[suggestedMapping.full_address] || null,
          latitude: row.lat ? Number(row.lat) : null,
          longitude: row.lng ? Number(row.lng) : null,
        };
      });

      console.log('About to upsert to database:', jobsToInsert.length, 'jobs');

      // 5) Upsert so duplicates are skipped (requires unique index on workspace_id,fingerprint)
      const supabase = createClient();
      const { data: insertedJobs, error } = await supabase
        .from('jobs')
        .upsert(jobsToInsert, {
          onConflict: 'workspace_id,fingerprint',
          ignoreDuplicates: true,
        })
        .select();

      console.log('Database result:', { error, count: insertedJobs?.length });

      if (error) {
        console.error('Supabase upsert error:', error);
        toast.error(`Failed to save data: ${error.message}`);
      } else {
        const inserted = insertedJobs?.length ?? 0;
        const skipped = jobsToInsert.length - inserted;
        setImportResult({
          total: jobsToInsert.length,
          inserted,
          skipped,
          errors: [],
        });
        toast.success(
          `${inserted.toLocaleString()} new job(s) saved, ${skipped.toLocaleString()} skipped as duplicates.`
        );
      }
    } catch (error) {
      console.error('File processing error:', error);
      toast.error(`Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const startUpload = async () => {
    setIsGeocoding(true);
    setGeocodingProgress(null);

    try {
      const rowsNeeding = csvData.filter((row) => {
        const hasAddress = row.street || row.city || row.full_address;
        const needsGeocode = row.needs_geocode === 'true' || row.needs_geocode === true;
        const missingCoords = !row.lat || !row.lng;
        return hasAddress && (needsGeocode || missingCoords);
      });

      if (rowsNeeding.length === 0) {
        toast.info('No addresses found that need geocoding');
        return;
      }

      setGeocodingProgress({ current: 0, total: rowsNeeding.length });

      const updated = await geocodeAll(
        csvData,
        (r) => r.full_address || [r.street, r.city, r.state, r.zip].filter(Boolean).join(', '),
        (done, total) => setGeocodingProgress({ current: done, total }),
        5
      );

      setCsvData(updated);
      setGeocodingProgress(null);
      const successCount = updated.filter((r) => r.lat && r.lng).length;
      const failedCount = rowsNeeding.length - successCount;

      if (successCount > 0) {
        toast.success(
          `Successfully geocoded ${successCount} address${successCount === 1 ? '' : 'es'}${
            failedCount ? `, ${failedCount} failed` : ''
          }`,
        );
      } else if (failedCount) {
        toast.error(`Failed to geocode ${failedCount} addresses. Check console/token/config.`);
      }
    } finally {
      setIsGeocoding(false);
      setGeocodingProgress(null);
    }
  };

  const clearFiles = () => {
    setCsvData([]);
    setOriginalHeaders([]);
    setColumnMapping({});
    setShowMapping(false);
    setFileName('');
    setShowAddressParsing(false);
    setAddressSourceColumn('');
    setHasFullAddressColumn(false);
    setFullAddressColumn('');
    setImportResult(null);
    setIsGeocoding(false);
    setGeocodingProgress(null);
    setSortColumn(null);
    setSortDirection(null);
  };

  const removeRow = (rowIndex: number) => {
    setCsvData((prev) => prev.filter((_, index) => index !== rowIndex));
  };

  const retryRow = async (rowIndex: number) => {
    const row = csvData[rowIndex];
    if (!row) return;

    const address = row.full_address || [row.street, row.city, row.state, row.zip].filter(Boolean).join(', ');
    if (!address) return;

    try {
      const res = await fetch('/api/geocode-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      if (res.ok) {
        const g = await res.json();
        if (g.lat && g.lng) {
          setCsvData((prev) => {
            const copy = [...prev];
            copy[rowIndex] = {
              ...copy[rowIndex],
              lat: String(g.lat),
              lng: String(g.lng),
              needs_geocode: 'false',
            };
            return copy;
          });
          toast.success('Address geocoded successfully');
        } else {
          toast.error('Failed to geocode address');
        }
      } else {
        toast.error('Failed to geocode address');
      }
    } catch {
      toast.error('Failed to geocode address');
    }
  };

  const applyMapping = () => {
    let mapped = csvData.map((row) => {
      const newRow: CSVRow = {};
      REQUIRED_HEADERS.forEach((required) => {
        const orig = columnMapping[required];
        newRow[required] = orig ? row[orig] ?? '' : '';
      });
      return newRow;
    });

    if (columnMapping.full_address) {
      mapped = mapped.map((row) => {
        const full = row.full_address || '';
        if (full && (!row.street || !row.city || !row.state || !row.zip)) {
          const parsed = parseFullAddressToParts(full);
          return {
            ...row,
            street: row.street || parsed.street || '',
            city: row.city || parsed.city || '',
            state: row.state || parsed.state || '',
            zip: row.zip || parsed.zip || '',
            needs_geocode: (parsed as any).confidence === 'low' ? 'true' : 'false',
          };
        }
        return { ...row, needs_geocode: 'false' };
      });
    }

    setCsvData(mapped);
    setShowMapping(false);
  };

  const applyAddressParsing = () => {
    if (!addressSourceColumn) return;
    const parsedData = csvData.map((row) => {
      const full = row[addressSourceColumn] || '';
      const parsed = parseAddress(full);
      return { ...row, street: parsed.street, city: parsed.city, state: parsed.state, zip: parsed.zip };
    });
    setCsvData(parsedData);
    setShowAddressParsing(false);
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'));
      if (sortDirection === 'desc') setSortColumn(null);
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const handleCellEdit = (rowIndex: number, column: string, value: string) => {
    setCsvData((prev) => {
      const copy = [...prev];
      copy[rowIndex] = { ...copy[rowIndex], [column]: value };
      return copy;
    });
  };

  const downloadCSV = () => {
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `cleaned_${fileName || 'data.csv'}`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return {
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
  };
}
