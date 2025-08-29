import { NextRequest, NextResponse } from "next/server";
import { geocodeOnce } from "@/lib/geocode";

/**
 * Safer US address normalizer:
 * - trims & collapses whitespace
 * - maps full state names -> USPS codes (North Carolina -> NC, etc.)
 * - light street-type abbreviations (does NOT abbreviate standalone North/South/East/West words)
 */
const STATE_TO_USPS: Record<string, string> = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO",
  "connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID",
  "illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA",
  "maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS",
  "missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ",
  "new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
  "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
  "tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA",
  "west virginia":"WV","wisconsin":"WI","wyoming":"WY","district of columbia":"DC"
};

function normalizeUSAddress(raw: string) {
  let s = (raw || "")
    .replace(/\s+/g, " ")   // collapse spaces
    .replace(/\s+,/g, ",")  // fix " ,"
    .trim();

  // Map full state names -> USPS codes (do this BEFORE any street-type changes)
  for (const [full, code] of Object.entries(STATE_TO_USPS)) {
    const re = new RegExp(`\\b${full}\\b`, "gi");
    s = s.replace(re, code);
  }

  // Light street-type abbreviations
  s = s
    .replace(/\bStreet\b/gi, "St")
    .replace(/\bAvenue\b/gi, "Ave")
    .replace(/\bBoulevard\b/gi, "Blvd")
    .replace(/\bRoad\b/gi, "Rd")
    .replace(/\bDrive\b/gi, "Dr");

  // Clean extra spaces again after replacements
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

async function handle(addressRaw: string) {
  if (!addressRaw || !addressRaw.trim()) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const address = normalizeUSAddress(addressRaw);

  console.log(
    "[geocode-address] q:",
    address,
    "MAPBOX?",
    !!process.env.MAPBOX_TOKEN,
    "GOOGLE?",
    !!process.env.GOOGLE_MAPS_API_KEY
  );

  try {
    const result = await geocodeOnce(address);
    if (!result) {
      return NextResponse.json(
        { error: "No geocode match", address },
        { status: 422 }
      );
    }
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    console.error("[geocode-address] error:", e?.message || e);
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}

// Support GET ?q=... and POST {address:"..."}
export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") || "";
  return handle(q);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  return handle(body?.address || "");
}

