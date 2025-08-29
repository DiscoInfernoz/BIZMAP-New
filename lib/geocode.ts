// lib/geocode.ts
type GeoResult = { lat: number; lng: number; zip?: string } | null;

/**
 * Tries Mapbox first (server-side). You can add Google fallback later if you want.
 * Requires MAPBOX_TOKEN in your env (server).
 */
export async function geocodeOnce(address: string): Promise<GeoResult> {
  const token = (process.env.MAPBOX_TOKEN || "").trim();

  if (!token || !token.startsWith("pk.")) {
    console.error("[geocodeOnce] MAPBOX_TOKEN is missing or invalid");
    return null;
  }

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(address) +
    `.json?access_token=${token}&limit=1&types=address,place,postcode`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("[geocodeOnce] Mapbox HTTP error:", resp.status, await safeText(resp));
      return null;
    }
    const json: any = await resp.json();
    const feat = json?.features?.[0];
    if (!feat?.center || !Array.isArray(feat.center) || feat.center.length < 2) {
      console.warn("[geocodeOnce] No features for address:", address);
      return null;
    }

    const [lng, lat] = feat.center;
    let zip: string | undefined;

    // Try to extract ZIP from context array or properties
    const ctx: any[] = feat.context || [];
    for (const c of ctx) {
      if (typeof c?.id === "string" && c.id.startsWith("postcode.")) {
        zip = (c.text || c.properties?.short_code || "").toString();
        break;
      }
    }
    if (!zip) {
      const props = feat.properties || {};
      if (props.postcode) zip = String(props.postcode);
    }

    return { lat: Number(lat), lng: Number(lng), zip };
  } catch (err) {
    console.error("[geocodeOnce] exception:", err);
    return null;
  }
}

async function safeText(r: Response) {
  try { return await r.text(); } catch { return ""; }
}
