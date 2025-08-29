// app/api/geocode-run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { geocodeOnce } from '@/lib/geocode';

interface GeocodeRunRequest {
  limit?: number;
}

interface GeocodeRunResponse {
  attempted: number;
  success: number;
  failed: number;
  remaining: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[geocode-run] start');

    // Check API keys for geocoding (Mapbox and/or Google)
    const mapboxToken = process.env.MAPBOX_TOKEN?.trim();
    const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

    const hasMapbox =
      !!mapboxToken &&
      mapboxToken.length > 0 &&
      !mapboxToken.includes('your_') &&
      !mapboxToken.includes('placeholder');

    const hasGoogle =
      !!googleKey &&
      googleKey.length > 0 &&
      !googleKey.includes('your_') &&
      !googleKey.includes('placeholder');

    if (!hasMapbox && !hasGoogle) {
      const msg =
        'No geocoding API keys configured. Please set MAPBOX_TOKEN or GOOGLE_MAPS_API_KEY in environment variables.';
      console.error('[geocode-run]', msg);
      return NextResponse.json<GeocodeRunResponse>(
        { attempted: 0, success: 0, failed: 0, remaining: 0, error: msg },
        { status: 400 }
      );
    }

    const body: GeocodeRunRequest = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(body.limit ?? 50, 500)); // sane bounds

    // Fetch jobs that need geocoding (any missing latitude/longitude or flagged)
    const { data: jobsToGeocode, error: fetchError } = await supabase
      .from('jobs')
      .select(
        'id, address_line1, address_line2, city, state, zip, latitude, longitude, needs_geocode'
      )
      .or('latitude.is.null,longitude.is.null,needs_geocode.eq.true')
      .limit(limit);

    if (fetchError) {
      console.error('[geocode-run] fetch error:', fetchError);
      return NextResponse.json<GeocodeRunResponse>(
        {
          attempted: 0,
          success: 0,
          failed: 0,
          remaining: 0,
          error: `Database error: ${fetchError.message}`,
        },
        { status: 500 }
      );
    }

    if (!jobsToGeocode || jobsToGeocode.length === 0) {
      return NextResponse.json<GeocodeRunResponse>({
        attempted: 0,
        success: 0,
        failed: 0,
        remaining: 0,
      });
    }

    let success = 0;
    let failed = 0;

    for (const job of jobsToGeocode) {
      const addrParts = [
        job.address_line1?.toString().trim(),
        job.address_line2?.toString().trim(),
        job.city?.toString().trim(),
        job.state?.toString().trim(),
        job.zip?.toString().trim(),
      ].filter(Boolean);

      const addressString = addrParts.join(', ');
      if (!addressString) {
        console.warn('[geocode-run] empty address for job', job.id);
        failed++;
        continue;
      }

      try {
        const result = await geocodeOnce(addressString); // returns {lat, lng, zip} or null
        if (result && typeof result.lat === 'number' && typeof result.lng === 'number') {
          const { error: updateError } = await supabase
            .from('jobs')
            .update({
              latitude: result.lat,
              longitude: result.lng,
              zip: result.zip ?? job.zip ?? null,
              needs_geocode: false,
              geocode_status: 'OK',
            })
            .eq('id', job.id);

          if (updateError) {
            console.error('[geocode-run] update error:', updateError);
            failed++;
          } else {
            success++;
          }
        } else {
          // no coordinates found
          console.warn('[geocode-run] no coords for', job.id, addressString);
          await supabase.from('jobs').update({ geocode_status: 'FAILED' }).eq('id', job.id);
          failed++;
        }
      } catch (err) {
        console.error('[geocode-run] geocodeOnce error:', err);
        await supabase.from('jobs').update({ geocode_status: 'FAILED' }).eq('id', job.id);
        failed++;
      }

      // small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 100));
    }

    // Remaining needing geocode after this pass
    const { count: remainingCount, error: countError } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .or('latitude.is.null,longitude.is.null,needs_geocode.eq.true');

    if (countError) {
      console.warn('[geocode-run] count warning:', countError);
    }

    const response: GeocodeRunResponse = {
      attempted: jobsToGeocode.length,
      success,
      failed,
      remaining: remainingCount || 0,
    };

    console.log('[geocode-run] done', response);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[geocode-run] fatal error:', error?.message || error);
    const resp: GeocodeRunResponse = {
      attempted: 0,
      success: 0,
      failed: 0,
      remaining: 0,
      error: error?.message || 'Internal server error',
    };
    return NextResponse.json(resp, { status: 500 });
  }
}

