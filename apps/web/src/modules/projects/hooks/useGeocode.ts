import { useQuery } from '@tanstack/react-query';

type GeocodeResult = { lat: number; lng: number } | null;

export function useGeocode(address: string) {
  return useQuery<GeocodeResult>({
    queryKey: ['geocode', address],
    enabled: !!address,
    staleTime: Infinity,
    queryFn: async (): Promise<GeocodeResult> => {
      // 1. Try existing mock projects first (instant)
      const { mockProjects } = await import('@/modules/projects/mock/index');
      const needle = address.toLowerCase();
      const match = mockProjects.find(
        (p) =>
          p.address.toLowerCase().includes(needle) ||
          needle.includes(p.address.toLowerCase()),
      );
      if (match) return { lat: match.lat, lng: match.lng };

      // 2. Try Mapbox Geocoding API if token available
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (token) {
        try {
          const encoded = encodeURIComponent(address);
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=us`,
          );
          if (res.ok) {
            const data = await res.json();
            const feat = data?.features?.[0];
            if (feat?.center) {
              // Mapbox returns [lng, lat]
              return { lat: feat.center[1], lng: feat.center[0] };
            }
          }
        } catch {
          // Geocoding failed — fall through to null
        }
      }

      // 3. Fallback: rough geocode from ZIP code (US)
      const zip = address.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
      if (zip) {
        const coords = approximateFromZip(zip);
        if (coords) return coords;
      }

      return null;
    },
  });
}

/**
 * Very rough lat/lng from US ZIP prefix.
 * Covers GA/metro-Atlanta area — extend as needed.
 */
function approximateFromZip(zip: string): GeocodeResult {
  const prefix = zip.substring(0, 3);
  const lookup: Record<string, { lat: number; lng: number }> = {
    // Georgia
    '300': { lat: 33.749, lng: -84.388 },   // Atlanta
    '301': { lat: 33.953, lng: -84.55 },     // Springfield / Cobb
    '302': { lat: 33.46, lng: -82.001 },     // Augusta
    '303': { lat: 33.749, lng: -84.388 },    // Atlanta (NE)
    '304': { lat: 32.461, lng: -83.508 },    // Swainsboro
    '305': { lat: 34.248, lng: -84.244 },    // Gainesville
    '306': { lat: 34.235, lng: -84.467 },    // NW Georgia
    '307': { lat: 32.076, lng: -81.088 },    // Savannah
    '308': { lat: 33.079, lng: -83.232 },    // Middle GA
    '309': { lat: 31.578, lng: -84.156 },    // Albany
    '310': { lat: 33.749, lng: -84.388 },    // Atlanta (more)
    '311': { lat: 33.771, lng: -84.296 },    // Atlanta
    '398': { lat: 34.0, lng: -84.0 },        // North GA
    '399': { lat: 33.45, lng: -84.47 },      // South Metro
  };
  return lookup[prefix] ?? null;
}
