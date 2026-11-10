/**
 * The Whence logo: four arrows converging on a destination marker.
 * Drawn in currentColor so it follows the surrounding text colour.
 * public/favicon.svg is the same drawing, white on an accent tile.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  const arrowRotations = [0, 90, 180, 270];
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="1.9" fill="currentColor" />
      <g fill="currentColor" stroke="currentColor" strokeLinejoin="round">
        {arrowRotations.map(degrees => (
          <g key={degrees} transform={`rotate(${degrees} 16 16)`}>
            <line x1="4.6" y1="4.6" x2="8" y2="8" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M11 11 L6.2 9.8 L9.8 6.2 Z" strokeWidth="1" />
          </g>
        ))}
      </g>
    </svg>
  );
}
