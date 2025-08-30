'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseFullAddressToParts, isFullAddressHeader } from '@/lib/addresses';
import { toast } from 'sonner';
import { useSessionData } from '@/contexts/DataContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/utils/supabase/client';

interface CSVRow {
  [key: string]: any; // allow needs_geocode booleans etc.
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

// --- NEW: concurrency-limited geocoder that runs before DB insert ---
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


export default function UploadPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

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
  const { setData } = useSessionData();

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

  const handleFileUpload = async (file: File) => {
    console.log('Upload function called with file:', file.name);
  
    const supabase = createClient();
    setFileName(file.name);
  
    if (!user) {
      toast.error('You must be logged in to upload data.');
      return;
    }
  
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
          workspace_id: user.id,
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
  
  

      console.log('About to upsert to database:', jobsToInsert.length, 'jobs');

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

      // 4) Map to DB schema (now includes lat/lng)
      const jobsToInsert = geocoded.map((row) => {
        const priceStr = String(row[suggestedMapping.price] || '0').replace(/[$,]/g, '');
        return {
          workspace_id: user.id,
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

      // 5) Prefer upsert so duplicates are skipped (requires your unique index)
      const { data: upserted, error } = await supabase
        .from('jobs')
        .upsert(jobsToInsert, {
          onConflict: 'workspace_id,fingerprint', // make sure the unique index exists
          ignoreDuplicates: true,
        })
        .select();

      console.log('Database result:', { error, count: upserted?.length });

      if (error) {
        console.error('Supabase upsert error:', error);
        toast.error(`Failed to save data: ${error.message}`);
      } else {
        const inserted = upserted?.length ?? 0;
        const skipped = jobsToInsert.length - inserted;
        setImportResult({
          total: jobsToInsert.length,
          inserted,
          skipped: Math.max(0, skipped),
          errors: [],
        });
        toast.success(
          `${inserted.toLocaleString()} job${inserted === 1 ? '' : 's'} saved${
            skipped > 0 ? `, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''
          }.`,
        );
      }
    } catch (error) {
      console.error('File processing error:', error);
      toast.error(`Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleGeocode = async () => {
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

  const handleViewReport = () => {
    if (csvData.length === 0) {
      toast.error('No data to report. Please upload and process a CSV first.');
      return;
    }

    // Convert csvData to the format expected by the session store
    setData({ rows: csvData });
    router.push('/report');
  };

  // mapping helpers
  const mappedHeaders = showMapping ? originalHeaders : REQUIRED_HEADERS;
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

  const displayData = showMapping ? csvData : sortedData;

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
              {getRequiredForMapping().map((requiredHeader) => (
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
                      const parsed = parseAddress(full);
                      return (
                        <div key={idx} className="glass-card p-4 rounded-xl border border-white/10">
                          <div className="font-semibold text-white mb-2">Original: {full}</div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                            <div>
                              <span className="text-emerald-400 font-semibold">Street:</span> {parsed.street}
                            </div>
                            <div>
                              <span className="text-emerald-400 font-semibold">City:</span> {parsed.city}
                            </div>
                            <div>
                              <span className="text-emerald-400 font-semibold">State:</span> {parsed.state}
                            </div>
                            <div>
                              <span className="text-emerald-400 font-semibold">ZIP:</span> {parsed.zip}
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
