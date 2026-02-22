/** Girona city center coordinates */
export const GIRONA_CENTER: [number, number] = [41.9794, 2.8214];

/** Service area radius in meters */
export const SERVICE_RADIUS_M = 5000;

/** Map configuration */
export const MAP_CONFIG = {
  minZoom: 13,
  maxZoom: 19,
  defaultZoom: 15,
} as const;

/** Photo constraints */
export const PHOTO_CONFIG = {
  maxCount: 5,
  maxSizeBytes: 1 * 1024 * 1024, // 1 MB after compression
  maxDimension: 1920,
  quality: 0.8,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
} as const;

/** LocalStorage keys */
export const STORAGE_KEYS = {
  lang: 'girotrash-lang',
  deviceId: 'girotrash-device-id',
  myReports: 'girotrash-my-reports',
} as const;

/** Haversine distance calculation */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Check if coordinates are inside service area */
export function isInsideServiceArea(lat: number, lon: number): boolean {
  return (
    haversineDistance(lat, lon, GIRONA_CENTER[0], GIRONA_CENTER[1]) <=
    SERVICE_RADIUS_M
  );
}

/** Get or create a stable device ID */
export function getDeviceId(): string {
  let id = localStorage.getItem(STORAGE_KEYS.deviceId);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEYS.deviceId, id);
  }
  return id;
}
