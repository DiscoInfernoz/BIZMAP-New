"use client";

import React, { useRef, useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import "mapbox-gl/dist/mapbox-gl.css";
import MapboxMap, { Marker, Popup, Source, Layer } from "react-map-gl/mapbox";
import { useSessionData, type CsvRow } from "@/contexts/DataContext";
import { Calendar, ChevronDown, ChevronUp } from "lucide-react";

interface ZipRow {
  zip: string;
  jobs: number;
  sales: number;
  avg: number;
  jobShare: number; // 0–100
  revenueShare: number; // 0–100
  avgDeltaPct: number; // -100..+∞ (vs overall avg)
}

interface ZipMetrics {
  [zip: string]: {
    jobs: number;
    sales: number;
    avg: number;
  };
}

type SortField = "zip" | "jobs" | "sales" | "avg" | "jobShare" | "revenueShare";
type SortDirection = "asc" | "desc";
type ViewMode = "pins" | "boundaries";

function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function safeAvg(sales: number, jobs: number): number {
  if (!jobs || jobs <= 0) return 0;
  return Math.round((sales || 0) / jobs);
}
function normalizeZip(z?: any): string {
  if (z == null) return "";
  const m = String(z).match(/\d{3,5}/)?.[0] ?? "";
  return m.padStart(5, "0");
}

// Try multiple common ZIP/ZCTA property names from GeoJSON
const ZIP_PROP_KEYS = ["GEOID20", "ZCTA5CE10", "GEOID10", "GEOID", "ZIPCODE", "zip"];

// Read a zip value from a feature.properties, normalized to 5 digits
function readZipFromProps(props: any): string {
  if (!props) return "";
  for (const k of ZIP_PROP_KEYS) {
    const v = props[k];
    if (v != null && v !== "") return normalizeZip(v);
  }
  return "";
}

// -------- Dynamic scale helpers --------

// 5-color "heat" palette (low → high)
const PALETTE = ["#d1d5db", "#facc15", "#f59e0b", "#f97316", "#dc2626"]; // gray → yellow → orange → red

// Nicely format dollars
const fmt$ = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${Math.round(n)}`);

// Simple percentile (no external libs)
function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

// Build 5 breaks by percentiles: 0%, 20%, 40%, 60%, 80%, 100%
// Returns [b0, b1, b2, b3, b4, b5]
function percentileBreaks(values: number[]) {
  const v = values.filter((x) => x > 0).slice().sort((a, b) => a - b);
  if (v.length === 0) return [0, 0, 0, 0, 0, 0];
  return [quantile(v, 0), quantile(v, 0.2), quantile(v, 0.4), quantile(v, 0.6), quantile(v, 0.8), quantile(v, 1.0)];
}

export default function ReportPage() {
  const { data } = useSessionData();
  const [sortField, setSortField] = useState<SortField>("jobs");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [zipFilter, setZipFilter] = useState("");
  const [selectedMarker, setSelectedMarker] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("pins");
  const [hoveredZip, setHoveredZip] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; zip: string } | null>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [dateFilterType, setDateFilterType] = useState<"current" | "past" | "custom">("current");
  const [currentPeriod, setCurrentPeriod] = useState<"today" | "week" | "month" | "quarter" | "year" | "all">("all");
  const [pastPeriod, setPastPeriod] = useState<"yesterday" | "lastWeek" | "lastMonth" | "lastQuarter" | "lastYear" | "last90Days">("last90Days");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showCustomCalendar, setShowCustomCalendar] = useState(false);
  const mapRef = useRef<any>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return <p className="p-4 text-red-400">Missing NEXT_PUBLIC_MAPBOX_TOKEN</p>;

  // Toggle view mode and update map layers
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (viewMode === "pins") {
      if (map.getLayer("zcta-fill")) map.setLayoutProperty("zcta-fill", "visibility", "none");
      if (map.getLayer("zcta-outline")) map.setLayoutProperty("zcta-outline", "visibility", "none");
    } else {
      if (map.getLayer("zcta-fill")) map.setLayoutProperty("zcta-fill", "visibility", "visible");
      if (map.getLayer("zcta-outline")) map.setLayoutProperty("zcta-outline", "visibility", "visible");
    }
  }, [viewMode]);

  // Lock body scroll while map is fullscreen
  useEffect(() => {
    if (!mapFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mapFullscreen]);

  // Ensure Mapbox resizes after container size changes
  useEffect(() => {
    const t = setTimeout(() => {
      const map = mapRef.current?.getMap?.();
      if (map) map.resize();
    }, 50);
    return () => clearTimeout(t);
  }, [mapFullscreen]);

  // Press Escape to exit fullscreen
  useEffect(() => {
    if (!mapFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMapFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapFullscreen]);

  // Map load: wire hover handlers
  const handleMapLoad = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    map.on("mousemove", "zcta-fill", (e: any) => {
      const feat = e.features && e.features[0];
      const z = readZipFromProps(feat?.properties);

      if (z) {
        setHoveredZip(z);
        setHoverInfo({ x: e.point.x, y: e.point.y, zip: z });
        map.getCanvas().style.cursor = "pointer";
      } else {
        setHoveredZip(null);
        setHoverInfo(null);
        map.getCanvas().style.cursor = "";
      }
    });

    map.on("mouseleave", "zcta-fill", () => {
      setHoveredZip(null);
      setHoverInfo(null);
      map.getCanvas().style.cursor = "";
    });
  };

  // Get date range based on selected filter
  const getDateRange = () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (dateFilterType) {
      case "current":
        switch (currentPeriod) {
          case "today":
            return { start: startOfDay, end: now };
          case "week":
            const startOfWeek = new Date(startOfDay);
            startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
            return { start: startOfWeek, end: now };
          case "month":
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start: startOfMonth, end: now };
          case "quarter":
            const quarter = Math.floor(now.getMonth() / 3);
            const startOfQuarter = new Date(now.getFullYear(), quarter * 3, 1);
            return { start: startOfQuarter, end: now };
          case "year":
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            return { start: startOfYear, end: now };
          case "all":
          default:
            return { start: new Date(0), end: now };
        }
      case "past":
        switch (pastPeriod) {
          case "yesterday":
            const yesterday = new Date(startOfDay);
            yesterday.setDate(yesterday.getDate() - 1);
            return { start: yesterday, end: new Date(startOfDay.getTime() - 1) };
          case "lastWeek":
            const lastWeekStart = new Date(startOfDay);
            lastWeekStart.setDate(startOfDay.getDate() - 7);
            return { start: lastWeekStart, end: new Date(startOfDay.getTime() - 1) };
          case "lastMonth":
            const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return { start: lastMonthStart, end: new Date(startOfDay.getTime() - 1) };
          case "lastQuarter":
            const lastQuarter = Math.floor((now.getMonth() - 1) / 3);
            const lastQuarterStart = new Date(now.getFullYear(), lastQuarter * 3, 1);
            return { start: lastQuarterStart, end: new Date(startOfDay.getTime() - 1) };
          case "lastYear":
            const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
            return { start: lastYearStart, end: new Date(startOfDay.getTime() - 1) };
          case "last90Days":
            const last90DaysStart = new Date(startOfDay);
            last90DaysStart.setDate(startOfDay.getDate() - 90);
            return { start: last90DaysStart, end: new Date(startOfDay.getTime() - 1) };
          default:
            return { start: new Date(0), end: now };
        }
      case "custom":
        if (customStartDate && customEndDate) {
          return { 
            start: new Date(customStartDate), 
            end: new Date(customEndDate + 'T23:59:59') 
          };
        }
        return { start: new Date(0), end: now };
      default:
        return { start: new Date(0), end: now };
    }
  };

  // -------- Parse and validate data --------
  const { geocodedRows, zipStats, mapCenter, totalJobs, totalSales } = useMemo(() => {
    if (!data?.rows) {
      return {
        geocodedRows: [] as CsvRow[],
        zipStats: [] as ZipRow[],
        mapCenter: { lat: 39.8283, lng: -98.5795 },
        totalJobs: 0,
        totalSales: 0,
      };
    }

    // Get current date range for filtering
    const dateRange = getDateRange();
    
    // Filter rows by date first
    const dateFilteredRows = data.rows.filter((row: CsvRow) => {
      if (!row.service_date) return true; // Include rows without dates
      
      try {
        const serviceDate = new Date(row.service_date);
        if (isNaN(serviceDate.getTime())) return true; // Include rows with invalid dates
        
        return serviceDate >= dateRange.start && serviceDate <= dateRange.end;
      } catch (error) {
        return true; // Include rows with unparseable dates
      }
    });

    // Filter rows with valid lat/lng for mapping
    const geocoded = dateFilteredRows.filter((row: CsvRow) => {
      const lat = parseFloat(row.lat || "");
      const lng = parseFloat(row.lng || "");
      return !isNaN(lat) && !isNaN(lng) && row.lat !== "-" && row.lng !== "-";
    });

    // Calculate map center
    let center = { lat: 39.8283, lng: -98.5795 }; // US center default
    if (geocoded.length > 0) {
      const avgLat = geocoded.reduce((sum, row) => sum + parseFloat(row.lat), 0) / geocoded.length;
      const avgLng = geocoded.reduce((sum, row) => sum + parseFloat(row.lng), 0) / geocoded.length;
      center = { lat: avgLat, lng: avgLng };
    }

    // Aggregate by ZIP using date-filtered rows
    const zipMap = new Map<string, { jobs: number; sales: number }>();
    let totalJobsCount = 0;
    let totalSalesAmount = 0;

    dateFilteredRows.forEach((row: CsvRow) => {
      const zip = (row.zip || "").trim();
      if (!zip) return; // Skip rows without ZIP

      const priceStr = (row.price || "").replace(/[$,]/g, "");
      const price = parseFloat(priceStr) || 0;

      if (!zipMap.has(zip)) {
        zipMap.set(zip, { jobs: 0, sales: 0 });
      }

      const current = zipMap.get(zip)!;
      current.jobs += 1;
      current.sales += price;

      totalJobsCount += 1;
      totalSalesAmount += price;
    });

    const rows = Array.from(zipMap.entries()).map(([zip, stats]) => ({
      zip,
      jobs: stats.jobs,
      sales: stats.sales,
      avg: safeAvg(stats.sales, stats.jobs),
    }));

    const totalJobs = rows.reduce((s, r) => s + r.jobs, 0);
    const totalSales = rows.reduce((s, r) => s + r.sales, 0);
    const overallAvg = totalJobs > 0 ? totalSales / totalJobs : 0;

    const zipStatsArray: ZipRow[] = rows.map((r) => ({
      ...r,
      jobShare: round1(pct(r.jobs, totalJobs)),
      revenueShare: round1(pct(r.sales, totalSales)),
      avgDeltaPct: overallAvg > 0 ? round1(((r.avg - overallAvg) / overallAvg) * 100) : 0,
    }));

    return {
      geocodedRows: geocoded,
      zipStats: zipStatsArray,
      mapCenter: center,
      totalJobs: totalJobsCount,
      totalSales: totalSalesAmount,
    };
  }, [data, dateFilterType, currentPeriod, pastPeriod, customStartDate, customEndDate]);

  const zipMetrics = useMemo(() => {
    const m: Record<string, { jobs: number; sales: number; avg: number }> = {};
    for (const row of zipStats) {
      const z = normalizeZip(row.zip);
      m[z] = { jobs: row.jobs || 0, sales: row.sales || 0, avg: row.avg || 0 };
    }
    return m;
  }, [zipStats]);

  // Filter + sort table data
  const filteredAndSortedZips = useMemo(() => {
    let filtered = zipStats;

    // Apply ZIP filter
    if (zipFilter.trim()) {
      filtered = filtered.filter((row) => row.zip.toLowerCase().includes(zipFilter.toLowerCase()));
    }

    return filtered.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case "avg":
          aVal = a.avg;
          bVal = b.avg;
          break;
        case "jobShare":
          aVal = a.jobShare;
          bVal = b.jobShare;
          break;
        case "revenueShare":
          aVal = a.revenueShare;
          bVal = b.revenueShare;
          break;
        default:
          aVal = a[sortField];
          bVal = b[sortField];
      }

      if (sortField === "zip") {
        aVal = String(aVal);
        bVal = String(bVal);
      }

      const dir = sortDirection === "asc" ? 1 : -1;

      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;

      // Stable tie-breakers
      if (a.sales !== b.sales) return (a.sales < b.sales ? -1 : 1) * dir;
      return a.zip.localeCompare(b.zip);
    });
  }, [zipStats, zipFilter, sortField, sortDirection]);

  // Compute percentile breaks from this dataset's sales and build legend ranges
  const { breaks, legendStops } = useMemo(() => {
    const vals = Object.values(zipMetrics).map((m) => Number(m.sales || 0));
    let b = percentileBreaks(vals); // [b0..b5]
    if (b.every((x) => x === 0)) b = [0, 0, 0, 0, 0, 0]; // all zero guard

    const stops = [
      { color: PALETTE[0], label: `${fmt$(b[0])} – ${fmt$(b[1])}` },
      { color: PALETTE[1], label: `${fmt$(b[1])} – ${fmt$(b[2])}` },
      { color: PALETTE[2], label: `${fmt$(b[2])} – ${fmt$(b[3])}` },
      { color: PALETTE[3], label: `${fmt$(b[3])} – ${fmt$(b[4])}` },
      { color: PALETTE[4], label: `${fmt$(b[4])} – ${fmt$(b[5])}` },
    ];
    return { breaks: b, legendStops: stops };
  }, [zipMetrics]);

  // Create color expression for choropleth (auto-detects the ZIP field)
  const fillColorExpression = useMemo(() => {
    const zipPropExpr: any[] = ["coalesce", ...ZIP_PROP_KEYS.map((k) => ["get", k] as any)];
    const matchInput: any[] = ["to-string", zipPropExpr];
    const expr: any[] = ["match", matchInput];

    Object.entries(zipMetrics).forEach(([zip, metrics]) => {
      const v = Number(metrics.sales || 0);
      let idx = 0; // default lowest bucket
      if (breaks[5] > 0) {
        if (v >= breaks[4]) idx = 4;
        else if (v >= breaks[3]) idx = 3;
        else if (v >= breaks[2]) idx = 2;
        else if (v >= breaks[1]) idx = 1;
        else idx = 0;
      }
      expr.push(zip, PALETTE[idx]);
    });

    expr.push("#ffffff"); // default color for zips with no data
    return expr;
  }, [zipMetrics, breaks]);

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return "↕️";
    return sortDirection === "asc" ? "↑" : "↓";
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "zip" ? "asc" : "desc");
    }
  };

  const exportCSV = () => {
    const headers = ["Zip", "Jobs", "Sales", "Avg Value", "Job %", "Rev %", "vs Avg"];
    const csvContent = [
      headers.join(","),
      ...filteredAndSortedZips.map(
        (row) =>
          `${row.zip},${row.jobs},${row.sales.toFixed(2)},${row.avg},${row.jobShare.toFixed(1)},${row.revenueShare.toFixed(
            1
          )},${row.avgDeltaPct > 0 ? "+" : ""}${row.avgDeltaPct.toFixed(1)}`
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "zip_report.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // No data state
  if (!data?.rows || data.rows.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
        <div className="glass-card p-12 text-center max-w-md">
          <div className="text-6xl mb-6 opacity-60">📊</div>
          <h1 className="text-2xl font-bold text-white mb-4">No Data Available</h1>
          <p className="text-slate-300 mb-8">Upload and process a CSV file first to view the map and zip report.</p>
          <Link
            href="/upload"
            className="inline-block bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 hover:scale-105"
          >
            Go to Upload
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4">
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Map & Zip Report</span>
          </h1>
          <div className="flex justify-center gap-4 text-sm text-slate-300">
            <span className="glass-card px-4 py-2 rounded-xl">
              {viewMode === "pins" ? `${geocodedRows.length} addresses plotted` : `${Object.keys(zipMetrics).length} ZIP codes`}
            </span>
            <span className="glass-card px-4 py-2 rounded-xl">
              {zipStats.length} zips | {totalJobs} total jobs | ${totalSales.toFixed(2)} total sales
            </span>
            <span className="glass-card px-4 py-2 rounded-xl text-emerald-400">
              {dateFilterType === "current" && currentPeriod !== "all" && `📅 ${currentPeriod === "today" ? "Today" : currentPeriod === "week" ? "This Week" : currentPeriod === "month" ? "This Month" : currentPeriod === "quarter" ? "This Quarter" : "This Year"}`}
              {dateFilterType === "past" && `📅 ${pastPeriod === "yesterday" ? "Yesterday" : pastPeriod === "lastWeek" ? "Last Week" : pastPeriod === "lastMonth" ? "Last Month" : pastPeriod === "lastQuarter" ? "Last Quarter" : pastPeriod === "lastYear" ? "Last Year" : "Last 90 Days"}`}
              {dateFilterType === "custom" && customStartDate && customEndDate && `📅 ${new Date(customStartDate).toLocaleDateString()} - ${new Date(customEndDate).toLocaleDateString()}`}
              {dateFilterType === "current" && currentPeriod === "all" && "📅 All Time"}
            </span>
            {data?.rows && (
              <span className="glass-card px-4 py-2 rounded-xl text-blue-400">
                📊 {data.rows.length} total jobs | {totalJobs} filtered jobs
              </span>
            )}
          </div>
        </div>

        {/* Date Filter */}
        <div className="glass-card p-6 mb-8">
          <div className="flex flex-wrap gap-6 items-center">
            {/* Filter Type Selector */}
            <div className="flex gap-2">
              <button
                onClick={() => setDateFilterType("current")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  dateFilterType === "current"
                    ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg"
                    : "text-slate-300 hover:text-white hover:bg-white/10"
                }`}
              >
                Current
              </button>
              <button
                onClick={() => setDateFilterType("past")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  dateFilterType === "past"
                    ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg"
                    : "text-slate-300 hover:text-white hover:bg-white/10"
                }`}
              >
                Past
              </button>
              <button
                onClick={() => setDateFilterType("custom")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  dateFilterType === "custom"
                    ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg"
                    : "text-slate-300 hover:text-white hover:bg-white/10"
                }`}
              >
                Custom
              </button>
            </div>

            {/* Current Period Options */}
            {dateFilterType === "current" && (
              <div className="flex gap-2">
                {[
                  { key: "today", label: "Today" },
                  { key: "week", label: "This Week" },
                  { key: "month", label: "This Month" },
                  { key: "quarter", label: "This Quarter" },
                  { key: "year", label: "This Year" },
                  { key: "all", label: "All Time" }
                ].map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setCurrentPeriod(option.key as any)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      currentPeriod === option.key
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-slate-300 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {/* Past Period Options */}
            {dateFilterType === "past" && (
              <div className="flex gap-2">
                {[
                  { key: "yesterday", label: "Yesterday" },
                  { key: "lastWeek", label: "Last Week" },
                  { key: "lastMonth", label: "Last Month" },
                  { key: "lastQuarter", label: "Last Quarter" },
                  { key: "lastYear", label: "Last Year" },
                  { key: "last90Days", label: "Last 90 Days" }
                ].map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setPastPeriod(option.key as any)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      pastPeriod === option.key
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-slate-300 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {/* Custom Date Range */}
            {dateFilterType === "custom" && (
              <div className="flex gap-4 items-center">
                <div className="relative">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/20 text-white focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
                    placeholder="Start Date"
                  />
                </div>
                <span className="text-slate-400">to</span>
                <div className="relative">
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/20 text-white focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
                    placeholder="End Date"
                  />
                </div>
                <button
                  onClick={() => setShowCustomCalendar(!showCustomCalendar)}
                  className="px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/20 text-white hover:bg-white/10 transition-colors flex items-center gap-2"
                >
                  <Calendar className="w-4 h-4" />
                  Calendar
                  {showCustomCalendar ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-10">
          {/* Top: Location Map */}
          <div className="glass-card overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">
                  Location Map
                  <span className="text-sm text-slate-400 ml-2 font-normal">
                    {viewMode === "pins" ? `(${geocodedRows.length} markers)` : `(${Object.keys(zipMetrics).length} ZIP codes)`}
                  </span>
                </h2>
              </div>

              {/* View Mode Toggle */}
              <div className="flex glass-card rounded-xl p-1 w-fit">
                <button
                  onClick={() => setViewMode("pins")}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    viewMode === "pins"
                      ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg"
                      : "text-slate-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  • Pins
                </button>
                <button
                  onClick={() => setViewMode("boundaries")}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    viewMode === "boundaries"
                      ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg"
                      : "text-slate-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  ZIP Boundaries
                </button>
              </div>

              {viewMode === "pins" && geocodedRows.length > 0 && (
                <p className="text-xs text-slate-400 mt-2">Click any marker to view job details</p>
              )}
            </div>

            {(geocodedRows.length > 0 || viewMode === "boundaries") ? (
              // ---- Map container (portal when fullscreen) ----
              mapFullscreen
                ? createPortal(
                    <div className="fixed inset-0 z-[9999] w-screen h-screen p-4 bg-slate-900/95 backdrop-blur flex">
                      {/* Exit/Enter fullscreen button */}
                      <button
  type="button"
  onClick={() => setMapFullscreen((v) => !v)}
  className="absolute top-4 right-4 z-[60] px-4 py-2 rounded-lg text-sm font-semibold 
             bg-gradient-to-r from-emerald-500 to-cyan-500 
             text-white shadow-lg border border-white/20 
             hover:from-emerald-600 hover:to-cyan-600 
             transition-all duration-300 hover:scale-105"
  aria-label={mapFullscreen ? "Exit fullscreen map" : "Enter fullscreen map"}
>
  {mapFullscreen ? "🗗 Exit Fullscreen" : "🗖 Fullscreen"}
</button>

                      <div className="relative w-full h-full">
                        <MapboxMap
                          ref={mapRef}
                          mapboxAccessToken={token}
                          initialViewState={{
                            longitude: mapCenter.lng,
                            latitude: mapCenter.lat,
                            zoom: viewMode === "boundaries" ? 11 : geocodedRows.length === 1 ? 14 : 10,
                          }}
                          style={{ width: "100%", height: "100%" }}
                          mapStyle="mapbox://styles/mapbox/streets-v12"
                          attributionControl={false}
                          onClick={() => setSelectedMarker(null)}
                          onLoad={handleMapLoad}
                        >
                          {/* ZIP boundaries */}
                          <Source id="zctas" type="geojson" data="/data/charlotte-zctas.geojson">
                            <Layer
                              id="zcta-fill"
                              type="fill"
                              paint={{ "fill-color": fillColorExpression as any, "fill-opacity": 0.55 }}
                              layout={{ visibility: viewMode === "boundaries" ? "visible" : "none" }}
                            />
                            <Layer
                              id="zcta-outline"
                              type="line"
                              paint={{ "line-color": "#7c3aed", "line-width": 1 }}
                              layout={{ visibility: viewMode === "boundaries" ? "visible" : "none" }}
                            />
                          </Source>

                          {/* Pin markers */}
                          {viewMode === "pins" &&
                            geocodedRows.map((row, index) => {
                              const lat = parseFloat(row.lat);
                              const lng = parseFloat(row.lng);
                              return (
                                <Marker key={index} longitude={lng} latitude={lat} anchor="bottom">
                                  <div
                                    className="w-4 h-4 bg-gradient-to-r from-teal-400 to-emerald-400 rounded-full shadow-lg border-2 border-white/50 hover:scale-125 transition-transform cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedMarker(index);
                                    }}
                                  />
                                </Marker>
                              );
                            })}

                          {/* Selected marker popup */}
                          {selectedMarker !== null && (
                            <Popup
                              longitude={parseFloat(geocodedRows[selectedMarker].lng)}
                              latitude={parseFloat(geocodedRows[selectedMarker].lat)}
                              anchor="bottom"
                              onClose={() => setSelectedMarker(null)}
                              closeButton
                              closeOnClick={false}
                              className="map-popup"
                            >
                              <div className="glass-card p-4 min-w-[250px] max-w-[300px] bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl">
                                <div className="space-y-3">
                                  <div>
                                    <h3 className="text-white font-bold text-lg mb-1 gradient-text">
                                      {geocodedRows[selectedMarker].name || "Unknown Customer"}
                                    </h3>
                                  </div>

                                  <div className="space-y-2 text-sm">
                                    <div>
                                      <span className="text-emerald-400 font-semibold">Address:</span>
                                      <p className="text-slate-200 mt-1 leading-relaxed">
                                        {geocodedRows[selectedMarker].full_address ||
                                          [geocodedRows[selectedMarker].street, geocodedRows[selectedMarker].city, geocodedRows[selectedMarker].state, geocodedRows[selectedMarker].zip]
                                            .filter(Boolean)
                                            .join(", ") ||
                                          "No address available"}
                                      </p>
                                    </div>

                                    {geocodedRows[selectedMarker].service_date && (
                                      <div>
                                        <span className="text-emerald-400 font-semibold">Service Date:</span>
                                        <p className="text-slate-200 mt-1">
                                          {new Date(geocodedRows[selectedMarker].service_date).toLocaleDateString("en-US", {
                                            year: "numeric",
                                            month: "long",
                                            day: "numeric",
                                          })}
                                        </p>
                                      </div>
                                    )}

                                    {geocodedRows[selectedMarker].price && (
                                      <div>
                                        <span className="text-emerald-400 font-semibold">Price:</span>
                                        <p className="text-slate-200 mt-1 font-mono text-lg">
                                          $
                                          {parseFloat(geocodedRows[selectedMarker].price.toString().replace(/[$,]/g, "") || "0").toFixed(2)}
                                        </p>
                                      </div>
                                    )}

                                    {geocodedRows[selectedMarker].service_type && (
                                      <div>
                                        <span className="text-emerald-400 font-semibold">Service Type:</span>
                                        <p className="text-slate-200 mt-1">{geocodedRows[selectedMarker].service_type}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </Popup>
                          )}

                          {/* Hover tooltip for ZIP boundaries */}
                          {viewMode === "boundaries" && hoverInfo && (
                            <div
                              className="absolute pointer-events-none z-10"
                              style={{ left: hoverInfo.x + 10, top: hoverInfo.y - 10, transform: "translate(0, -100%)" }}
                            >
                              <div className="glass-card p-3 bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl">
                                <h3 className="text-white font-bold text-sm mb-2">ZIP {hoverInfo.zip}</h3>
                                <div className="space-y-1 text-xs">
                                  <div className="text-slate-300">
                                    <span className="text-emerald-400">Jobs:</span> {zipMetrics[hoverInfo.zip]?.jobs || 0}
                                  </div>
                                  <div className="text-slate-300">
                                    <span className="text-emerald-400">Sales:</span> $
                                    {(zipMetrics[hoverInfo.zip]?.sales || 0).toFixed(2)}
                                  </div>
                                  <div className="text-slate-300">
                                    <span className="text-emerald-400">Avg Ticket:</span> $
                                    {(zipMetrics[hoverInfo.zip]?.avg || 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </MapboxMap>

                        {/* Legend (only in boundaries mode) */}
                        {viewMode === "boundaries" && (
                          <div className="absolute top-4 right-4 glass-card p-4 bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl pointer-events-auto">
                            <h4 className="text-white font-bold text-sm mb-3">Revenue by ZIP (relative)</h4>
                            <div className="space-y-2 text-xs">
                              {[...legendStops].reverse().map((s, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <div className="w-4 h-3 rounded" style={{ backgroundColor: s.color }} />
                                  <span className="text-slate-300">{s.label}</span>
                                </div>
                              ))}
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-3 rounded" style={{ backgroundColor: "#ffffff" }} />
                                <span className="text-slate-300">No data</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>,
                    document.body
                  )
                : (
                    <div className="relative h-96 w-full">
                      <button
                        type="button"
                        onClick={() => setMapFullscreen((v) => !v)}
                        className="absolute top-4 right-4 z-[60] px-4 py-2 rounded-lg text-sm font-semibold 
                                   bg-gradient-to-r from-emerald-500 to-cyan-500 
                                   text-white shadow-lg border border-white/20 
                                   hover:from-emerald-600 hover:to-cyan-600 
                                   transition-all duration-300 hover:scale-105"
                        aria-label={mapFullscreen ? "Exit fullscreen map" : "Enter fullscreen map"}
                      >
                        {mapFullscreen ? "🗗 Exit Fullscreen" : "🗖 Fullscreen"}
                      </button>


                      <MapboxMap
                        ref={mapRef}
                        mapboxAccessToken={token}
                        initialViewState={{
                          longitude: mapCenter.lng,
                          latitude: mapCenter.lat,
                          zoom: viewMode === "boundaries" ? 11 : geocodedRows.length === 1 ? 14 : 10,
                        }}
                        style={{ width: "100%", height: "100%" }}
                        mapStyle="mapbox://styles/mapbox/streets-v12"
                        attributionControl={false}
                        onClick={() => setSelectedMarker(null)}
                        onLoad={handleMapLoad}
                      >
                        {/* ZIP boundaries */}
                        <Source id="zctas" type="geojson" data="/data/charlotte-zctas.geojson">
                          <Layer
                            id="zcta-fill"
                            type="fill"
                                                          paint={{ "fill-color": fillColorExpression as any, "fill-opacity": 0.55 }}
                            layout={{ visibility: viewMode === "boundaries" ? "visible" : "none" }}
                          />
                          <Layer
                            id="zcta-outline"
                            type="line"
                            paint={{ "line-color": "#7c3aed", "line-width": 1 }}
                            layout={{ visibility: viewMode === "boundaries" ? "visible" : "none" }}
                          />
                        </Source>

                        {/* Pin markers */}
                        {viewMode === "pins" &&
                          geocodedRows.map((row, index) => {
                            const lat = parseFloat(row.lat);
                            const lng = parseFloat(row.lng);
                            return (
                              <Marker key={index} longitude={lng} latitude={lat} anchor="bottom">
                                <div
                                  className="w-4 h-4 bg-gradient-to-r from-teal-400 to-emerald-400 rounded-full shadow-lg border-2 border-white/50 hover:scale-125 transition-transform cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedMarker(index);
                                  }}
                                />
                              </Marker>
                            );
                          })}

                        {/* Selected marker popup */}
                        {selectedMarker !== null && (
                          <Popup
                            longitude={parseFloat(geocodedRows[selectedMarker].lng)}
                            latitude={parseFloat(geocodedRows[selectedMarker].lat)}
                            anchor="bottom"
                            onClose={() => setSelectedMarker(null)}
                            closeButton
                            closeOnClick={false}
                            className="map-popup"
                          >
                            <div className="glass-card p-4 min-w-[250px] max-w-[300px] bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl">
                              <div className="space-y-3">
                                <div>
                                  <h3 className="text-white font-bold text-lg mb-1 gradient-text">
                                    {geocodedRows[selectedMarker].name || "Unknown Customer"}
                                  </h3>
                                </div>

                                <div className="space-y-2 text-sm">
                                  <div>
                                    <span className="text-emerald-400 font-semibold">Address:</span>
                                    <p className="text-slate-200 mt-1 leading-relaxed">
                                      {geocodedRows[selectedMarker].full_address ||
                                        [geocodedRows[selectedMarker].street, geocodedRows[selectedMarker].city, geocodedRows[selectedMarker].state, geocodedRows[selectedMarker].zip]
                                          .filter(Boolean)
                                          .join(", ") ||
                                        "No address available"}
                                    </p>
                                  </div>

                                  {geocodedRows[selectedMarker].service_date && (
                                    <div>
                                      <span className="text-emerald-400 font-semibold">Service Date:</span>
                                      <p className="text-slate-200 mt-1">
                                        {new Date(geocodedRows[selectedMarker].service_date).toLocaleDateString("en-US", {
                                          year: "numeric",
                                          month: "long",
                                          day: "numeric",
                                        })}
                                      </p>
                                    </div>
                                  )}

                                  {geocodedRows[selectedMarker].price && (
                                    <div>
                                      <span className="text-emerald-400 font-semibold">Price:</span>
                                      <p className="text-slate-200 mt-1 font-mono text-lg">
                                        ${parseFloat(geocodedRows[selectedMarker].price.toString().replace(/[$,]/g, "") || "0").toFixed(2)}
                                      </p>
                                    </div>
                                  )}

                                  {geocodedRows[selectedMarker].service_type && (
                                    <div>
                                      <span className="text-emerald-400 font-semibold">Service Type:</span>
                                      <p className="text-slate-200 mt-1">{geocodedRows[selectedMarker].service_type}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </Popup>
                        )}

                        {/* Hover tooltip for ZIP boundaries */}
                        {viewMode === "boundaries" && hoverInfo && (
                          <div
                            className="absolute pointer-events-none z-10"
                            style={{ left: hoverInfo.x + 10, top: hoverInfo.y - 10, transform: "translate(0, -100%)" }}
                          >
                            <div className="glass-card p-3 bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl">
                              <h3 className="text-white font-bold text-sm mb-2">ZIP {hoverInfo.zip}</h3>
                              <div className="space-y-1 text-xs">
                                <div className="text-slate-300">
                                  <span className="text-emerald-400">Jobs:</span> {zipMetrics[hoverInfo.zip]?.jobs || 0}
                                </div>
                                <div className="text-slate-300">
                                  <span className="text-emerald-400">Sales:</span> $
                                  {(zipMetrics[hoverInfo.zip]?.sales || 0).toFixed(2)}
                                </div>
                                <div className="text-slate-300">
                                  <span className="text-emerald-400">Avg Ticket:</span> $
                                  {(zipMetrics[hoverInfo.zip]?.avg || 0).toFixed(2)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </MapboxMap>

                      {/* Legend (only in boundaries mode) */}
                      {viewMode === "boundaries" && (
                        <div className="absolute top-4 right-4 glass-card p-4 bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl pointer-events-auto">
                          <h4 className="text-white font-bold text-sm mb-3">Revenue by ZIP (relative)</h4>
                          <div className="space-y-2 text-xs">
                            {[...legendStops].reverse().map((s, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <div className="w-4 h-3 rounded" style={{ backgroundColor: s.color }} />
                                <span className="text-slate-300">{s.label}</span>
                              </div>
                            ))}
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-3 rounded" style={{ backgroundColor: "#ffffff" }} />
                              <span className="text-slate-300">No data</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
            ) : (
              <div className="h-96 flex items-center justify-center">
                <div className="text-center text-slate-400">
                  <div className="text-4xl mb-4 opacity-50">🗺️</div>
                  <p>No geocoded addresses to display</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom: Zip Code Report */}
          <div className="glass-card overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">Zip Code Report</h2>
                <div className="flex gap-2">
                  <button onClick={exportCSV} className="glass-button px-4 py-2 text-sm text-white hover:text-emerald-400 transition-colors">
                    📥 Export CSV
                  </button>
                </div>
              </div>

              {/* Filter */}
              <input
                type="text"
                placeholder="Filter by zip code..."
                value={zipFilter}
                onChange={(e) => setZipFilter(e.target.value)}
                className="w-full p-3 glass-card border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-white bg-white/5 placeholder-slate-400"
              />
            </div>

            <div className="relative overflow-auto max-h-96">
              <table className="w-full">
                <thead className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-xl border-b border-white/10 shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset]">
                  <tr>
                    <th onClick={() => handleSort("zip")} className="px-6 py-4 text-left text-sm font-bold text-white cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10">
                      <div className="flex items-center justify-between">
                        <span>Zip Code</span>
                        <span className="ml-2 text-slate-400">{getSortIcon("zip")}</span>
                      </div>
                    </th>
                    <th onClick={() => handleSort("jobs")} className="px-6 py-4 text-left text-sm font-bold text-white cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10">
                      <div className="flex items-center justify-between">
                        <span>Jobs</span>
                        <span className="ml-2 text-slate-400">{getSortIcon("jobs")}</span>
                      </div>
                    </th>
                    <th onClick={() => handleSort("sales")} className="px-6 py-4 text-left text-sm font-bold text-white cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10">
                      <div className="flex items-center justify-between">
                        <span>Sales</span>
                        <span className="ml-2 text-slate-400">{getSortIcon("sales")}</span>
                      </div>
                    </th>
                    <th onClick={() => handleSort("avg")} className="px-6 py-4 text-left text-sm font-bold text-white cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10">
                      <div className="flex items-center justify-between">
                        <span>Avg Value</span>
                        <span className="ml-2 text-slate-400">{getSortIcon("avg")}</span>
                      </div>
                    </th>
                    <th onClick={() => handleSort("jobShare")} className="px-6 py-4 text-right text-sm font-bold text-white cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10">
                      <div className="flex items-center justify-between">
                        <span>Job %</span>
                        <span className="ml-2 text-slate-400">{getSortIcon("jobShare")}</span>
                      </div>
                    </th>
                    <th onClick={() => handleSort("revenueShare")} className="px-6 py-4 text-right text-sm font-bold text-white cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10">
                      <div className="flex items-center justify-between">
                        <span>Rev %</span>
                        <span className="ml-2 text-slate-400">{getSortIcon("revenueShare")}</span>
                      </div>
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-white border-b border-white/10">vs Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Totals Row */}
                  <tr className="bg-emerald-500/10 border-b-2 border-emerald-400/30">
                    <td className="px-6 py-3 text-sm font-bold text-emerald-400">TOTAL ({zipStats.length} zips)</td>
                    <td className="px-6 py-3 text-sm font-bold text-emerald-400">{totalJobs}</td>
                    <td className="px-6 py-3 text-sm font-bold text-emerald-400">${totalSales.toFixed(2)}</td>
                    <td colSpan={4}></td>
                  </tr>

                  {/* Data Rows */}
                  {filteredAndSortedZips.map((row, index) => (
                    <tr key={row.zip} className={index % 2 === 0 ? "bg-white/5" : "bg-white/10"}>
                      <td className="px-6 py-3 text-sm text-white font-mono">{row.zip}</td>
                      <td className="px-6 py-3 text-sm text-white">{row.jobs}</td>
                      <td className="px-6 py-3 text-sm text-white">${row.sales.toFixed(2)}</td>
                      <td className="px-6 py-3 text-sm text-white">${row.avg.toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm text-white text-right">{row.jobShare.toFixed(1)}%</td>
                      <td className="px-6 py-3 text-sm text-white text-right">{row.revenueShare.toFixed(1)}%</td>
                      <td className="px-6 py-3 text-sm text-white text-right">
                        {row.avgDeltaPct > 0 ? `+${row.avgDeltaPct.toFixed(1)}%` : `${row.avgDeltaPct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}

                  {filteredAndSortedZips.length === 0 && zipFilter && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                        No zip codes match "{zipFilter}"
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Back Button */}
        <div className="text-center mt-8">
          <Link href="/upload" className="inline-block glass-button px-6 py-3 text-white hover:text-emerald-400 transition-colors">
            ← Back to Upload
          </Link>
        </div>
      </div>
    </div>
  );
}
