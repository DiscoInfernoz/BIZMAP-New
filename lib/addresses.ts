interface AddressParts {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Attempts to parse a full address string into component parts
 * Returns confidence level based on how well the parsing succeeded
 */
export function parseFullAddressToParts(input: string): AddressParts {
  if (!input || typeof input !== 'string') {
    return { confidence: 'low' };
  }

  const address = input.trim();
  
  // Try to extract state and ZIP from the end using regex
  const stateZipMatch = address.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b\s*$/);
  
  if (!stateZipMatch) {
    // No state/ZIP found, low confidence
    return { 
      street: address,
      confidence: 'low' 
    };
  }

  const state = stateZipMatch[1];
  const zip = stateZipMatch[2];
  
  // Remove state and ZIP from the address for further parsing
  const remaining = address.replace(stateZipMatch[0], '').trim();
  
  // Split by commas to separate street and city
  const parts = remaining.split(',').map(part => part.trim()).filter(Boolean);
  
  let street = '';
  let city = '';
  
  if (parts.length >= 2) {
    // Multiple comma-separated parts: assume last is city, rest is street
    street = parts.slice(0, -1).join(', ');
    city = parts[parts.length - 1];
  } else if (parts.length === 1) {
    // Single part: try to split on common street suffixes
    const streetSuffixes = /\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Pl|Place|Way|Circle|Cir|Pkwy|Parkway)\b/i;
    const match = parts[0].match(new RegExp(`^(.+?\\s+${streetSuffixes.source})\\s+(.+)$`, 'i'));
    
    if (match) {
      street = match[1].trim();
      city = match[2].trim();
    } else {
      // Can't reliably split, put everything in street
      street = parts[0];
    }
  }
  
  // Determine confidence based on what we successfully parsed
  let confidence: 'high' | 'medium' | 'low' = 'high';
  
  if (!city) {
    confidence = 'medium';
  }
  
  if (!street || !city) {
    confidence = 'low';
  }

  return {
    street: street || undefined,
    city: city || undefined,
    state,
    zip,
    confidence
  };
}

/**
 * Checks if a header name represents a full address column
 */
export function isFullAddressHeader(header: string): boolean {
  const normalizedHeader = header.toLowerCase().replace(/[\s_-]/g, '');
  const fullAddressVariants = [
    'fulladdress',
    'address',
    'addr',
    'streetaddress', 
    'location',
    'address1'
  ];
  
  return fullAddressVariants.some(variant => 
    normalizedHeader.includes(variant) || variant.includes(normalizedHeader)
  );
}