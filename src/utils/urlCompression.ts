import LZString from 'lz-string';

/**
 * Compresses a JSON object to a URL-safe string
 */
export function compressToURL<T>(data: T): string {
  const jsonString = JSON.stringify(data);
  const compressed = LZString.compressToEncodedURIComponent(jsonString);
  
  return compressed;
}

/**
 * Decompresses a URL-safe string back to a JSON object
 * Returns null if the string is invalid
 */
export function decompressFromURL<T>(compressed: string | null): T | null {
  if (!compressed) return null;
  
  try {
    const jsonString = LZString.decompressFromEncodedURIComponent(compressed);
    if (!jsonString) return null;
    return JSON.parse(jsonString) as T;
  } catch (e) {
    console.error('Failed to decompress URL data', e);
    return null;
  }
}
