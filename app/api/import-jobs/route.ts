import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseFullAddressToParts } from '@/lib/addresses';

interface ImportJobData {
  name: string;
  service_date: string;
  price: string | number;
  service_type?: string;
  lead_source?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  full_address?: string;
  needs_geocode?: boolean;
}

function validateAndCoerceRow(row: ImportJobData, index: number): { valid: boolean; data?: any; error?: string } {
  try {
    // Validate required fields
    if (!row.name || typeof row.name !== 'string' || row.name.trim() === '') {
      return { valid: false, error: `Row ${index + 1}: Name is required` };
    }

    if (!row.service_date) {
      return { valid: false, error: `Row ${index + 1}: Service date is required` };
    }

    if (!row.price && row.price !== 0) {
      return { valid: false, error: `Row ${index + 1}: Price is required` };
    }

    // Coerce price to number
    let price: number;
    if (typeof row.price === 'string') {
      // Remove $ and commas, then parse
      const cleanPrice = row.price.replace(/[$,]/g, '');
      price = parseFloat(cleanPrice);
    } else {
      price = Number(row.price);
    }

    if (isNaN(price) || price < 0) {
      return { valid: false, error: `Row ${index + 1}: Invalid price format` };
    }

    // Validate and coerce service_date
    const serviceDate = new Date(row.service_date);
    if (isNaN(serviceDate.getTime())) {
      return { valid: false, error: `Row ${index + 1}: Invalid date format` };
    }

    // Validate address - must have either components OR full_address
    const hasAddressComponents = row.street && row.city && row.state && row.zip;
    const hasFullAddress = row.full_address && row.full_address.trim() !== '';

    if (!hasAddressComponents && !hasFullAddress) {
      return { valid: false, error: `Row ${index + 1}: Must have either address components (street, city, state, zip) or full address` };
    }

    // Determine if geocoding is needed and try to parse full address
    let needsGeocode = false;
    let street = row.street?.trim() || null;
    let city = row.city?.trim() || null;
    let state = row.state?.trim() || null;
    let zip = row.zip?.trim() || null;

    if (hasFullAddress && !hasAddressComponents && row.full_address) {
      // Try to parse the full address
      const parsed = parseFullAddressToParts(row.full_address);
      street = parsed.street || null;
      city = parsed.city || null;
      state = parsed.state || null;
      zip = parsed.zip || null;
      
      // Set needs_geocode if parsing confidence is low or components are missing
      needsGeocode = parsed.confidence === 'low' || !street || !city || !state || !zip;
    }

    const validatedData = {
      name: row.name.trim(),
      service_date: serviceDate.toISOString().split('T')[0], // Convert to YYYY-MM-DD
      price,
      service_type: row.service_type?.trim() || null,
      lead_source: row.lead_source?.trim() || null,
      street,
      city,
      state,
      zip,
      full_address: row.full_address?.trim() || null,
      needs_geocode: row.needs_geocode || needsGeocode,
      user_id: null // For now, all imports are anonymous
    };

    return { valid: true, data: validatedData };
  } catch (error) {
    return { valid: false, error: `Row ${index + 1}: Validation error - ${error}` };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rows } = body;

    if (!Array.isArray(rows)) {
      return NextResponse.json(
        { error: 'Invalid request: rows must be an array' },
        { status: 400 }
      );
    }

    // Validate and process each row
    const validatedRows: any[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const validation = validateAndCoerceRow(rows[i], i);
      if (validation.valid && validation.data) {
        validatedRows.push(validation.data);
      } else if (validation.error) {
        errors.push(validation.error);
      }
    }

    if (validatedRows.length === 0) {
      return NextResponse.json({
        total: rows.length,
        inserted: 0,
        skipped: rows.length,
        errors: errors.length > 0 ? errors : ['No valid rows to insert']
      });
    }

    // Insert into Supabase
    const { data, error } = await supabase
      .from('jobs')
      .insert(validatedRows)
      .select();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({
        total: rows.length,
        inserted: 0,
        skipped: rows.length,
        errors: [`Database error: ${error.message}`]
      }, { status: 500 });
    }

    const result = {
      total: rows.length,
      inserted: data?.length || 0,
      skipped: rows.length - validatedRows.length,
      errors
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Import jobs error:', error);
    return NextResponse.json(
      { 
        total: 0,
        inserted: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Internal server error']
      },
      { status: 500 }
    );
  }
}