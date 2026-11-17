// Titik-dalam-poligon (ray casting). Koordinat GeoJSON: [lng, lat].
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((r) => inRing(x, y, r));

export function inFeature(feature, x, y) {
  const g = feature.geometry;
  if (g.type === 'Polygon') return inPolygon(x, y, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => inPolygon(x, y, p));
  return false;
}

export const zoneAt = (fc, x, y) => fc.features.find((f) => inFeature(f, x, y)) || null;
