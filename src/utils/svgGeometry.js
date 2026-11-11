// Parses an SVG path `d` string made only of M/L/z commands (as produced by
// this project's region shapes) into one or more point rings.
function parseRings(d) {
  const tokens = d.match(/[MLz]|-?\d+(?:\.\d+)?/g) ?? [];
  const rings = [];
  let currentRing = null;
  let pendingX = null;

  for (const token of tokens) {
    if (token === "M") {
      currentRing = [];
      rings.push(currentRing);
      pendingX = null;
    } else if (token === "L") {
      pendingX = null;
    } else if (token === "z") {
      // no-op: shoelace math below closes the ring implicitly
    } else {
      const value = Number(token);
      if (pendingX === null) {
        pendingX = value;
      } else {
        currentRing?.push([pendingX, value]);
        pendingX = null;
      }
    }
  }

  return rings.filter((ring) => ring.length >= 3);
}

// Standard polygon centroid formula (shoelace-based), returning the ring's
// centroid along with its signed area.
function ringCentroid(points) {
  const n = points.length;
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  area /= 2;
  if (area === 0) return null;

  return { x: cx / (6 * area), y: cy / (6 * area), area: Math.abs(area) };
}

export function getMultiPolygonCentroid(d) {
  const rings = parseRings(d);
  const centroids = rings.map(ringCentroid).filter((c) => c !== null);

  const totalArea = centroids.reduce((sum, c) => sum + c.area, 0);

  if (totalArea > 0) {
    const x = centroids.reduce((sum, c) => sum + c.x * c.area, 0) / totalArea;
    const y = centroids.reduce((sum, c) => sum + c.y * c.area, 0) / totalArea;
    return { x, y };
  }

  const allPoints = rings.flat();
  if (allPoints.length === 0) return { x: 0, y: 0 };

  const x = allPoints.reduce((sum, [px]) => sum + px, 0) / allPoints.length;
  const y = allPoints.reduce((sum, [, py]) => sum + py, 0) / allPoints.length;
  return { x, y };
}
