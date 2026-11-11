export function lightenHex(hex, amount) {
  const channel = (start) => parseInt(hex.slice(start, start + 2), 16);
  const lighten = (c) => Math.max(0, Math.min(255, Math.round(c + (255 - c) * amount)));
  const toHex = (c) => c.toString(16).padStart(2, "0").toUpperCase();

  const r = lighten(channel(1));
  const g = lighten(channel(3));
  const b = lighten(channel(5));

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
