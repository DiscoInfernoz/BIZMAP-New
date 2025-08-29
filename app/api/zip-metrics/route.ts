import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface ZipMetrics {
  [zip: string]: {
    jobs: number;
    sales: number;
    avg: number;
  };
}

interface ZipMetricsResponse {
  metrics: ZipMetrics;
  totals: {
    totalZips: number;
    totalJobs: number;
    totalSales: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const minPriceStr = searchParams.get('minPrice');
    const minPrice = minPriceStr ? parseFloat(minPriceStr) : null;

    // Build the query with filters
    let query = supabase
      .from('jobs')
      .select('zip, price')
      .not('zip', 'is', null)
      .neq('zip', '');

    // Apply date filters if provided
    if (from) {
      query = query.gte('service_date', from);
    }
    if (to) {
      query = query.lte('service_date', to);
    }
    if (minPrice !== null && !isNaN(minPrice)) {
      query = query.gte('price', minPrice);
    }

    const { data: jobs, error } = await query;

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { 
          metrics: {} as ZipMetrics,
          totals: { totalZips: 0, totalJobs: 0, totalSales: 0 }
        },
        { status: 500 }
      );
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({
        metrics: {} as ZipMetrics,
        totals: { totalZips: 0, totalJobs: 0, totalSales: 0 }
      });
    }

    // Aggregate by ZIP code
    const zipMetrics: ZipMetrics = {};
    let totalJobs = 0;
    let totalSales = 0;

    jobs.forEach((job) => {
      if (!job.zip) return;

      // Normalize ZIP to 5 digits
      const zip = job.zip.toString().padStart(5, '0').substring(0, 5);
      const price = parseFloat(job.price?.toString().replace(/[$,]/g, '') || '0') || 0;

      if (!zipMetrics[zip]) {
        zipMetrics[zip] = {
          jobs: 0,
          sales: 0,
          avg: 0
        };
      }

      zipMetrics[zip].jobs += 1;
      zipMetrics[zip].sales += price;
      totalJobs += 1;
      totalSales += price;
    });

    // Calculate averages
    Object.keys(zipMetrics).forEach(zip => {
      const metrics = zipMetrics[zip];
      metrics.avg = metrics.jobs > 0 ? metrics.sales / metrics.jobs : 0;
    });

    const response: ZipMetricsResponse = {
      metrics: zipMetrics,
      totals: {
        totalZips: Object.keys(zipMetrics).length,
        totalJobs,
        totalSales
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('ZIP metrics error:', error);
    return NextResponse.json(
      { 
        metrics: {} as ZipMetrics,
        totals: { totalZips: 0, totalJobs: 0, totalSales: 0 }
      },
      { status: 500 }
    );
  }
}