// lib/addressString.ts
export const STATE_TO_USPS: Record<string, string> = {
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

export function normalizeUSAddress(raw: string) {
  let s = (raw || "")
    .replace(/\s+/g, " ")   // collapse whitespace
    .replace(/\s+,/g, ",")  // fix " ,"
    .trim();

  // Map full state names -> USPS codes (no "N Carolina" problems)
  for (const [full, code] of Object.entries(STATE_TO_USPS)) {
    const re = new RegExp(`\\b${full}\\b`, "gi");
    s = s.replace(re, code);
  }

  // Light street-type abbreviations (do NOT abbreviate plain North/South/East/West)
  s = s
    .replace(/\bStreet\b/gi, "St")
    .replace(/\bAvenue\b/gi, "Ave")
    .replace(/\bBoulevard\b/gi, "Blvd")
    .replace(/\bRoad\b/gi, "Rd")
    .replace(/\bDrive\b/gi, "Dr");

  return s.replace(/\s+/g, " ").trim();
}

// optional helper to try without ZIP in a second pass
export function simplifyAddress(a: string) {
  return (a || "")
    .replace(/\b\d{5}(?:-\d{4})?\b/, "") // drop ZIP if present
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}
