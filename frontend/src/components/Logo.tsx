/**
 * Semantic Explorer logo — a semantic knowledge graph:
 * seven nodes (1 central bright focal point + 6 orbiting) connected by edges,
 * forming a pattern that symbolizes understanding through connected meaning.
 */
export function Logo({ size = 32 }: { size?: number }) {
  const cx = 50;
  const cy = 50;
  const outerR = 36;
  const n = 6;

  // Compute outer node positions (hexagonal arrangement)
  const outer = Array.from({ length: n }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // start at 30°
    return {
      x: cx + outerR * Math.cos(angle),
      y: cy + outerR * Math.sin(angle),
    };
  });

  // Edge pairs: center→each outer + alternating outer→outer (every other)
  const centerEdges = outer.map((p) => ({ x1: cx, y1: cy, x2: p.x, y2: p.y }));
  const ringEdges = outer.map((p, i) => ({
    x1: p.x,
    y1: p.y,
    x2: outer[(i + 1) % n].x,
    y2: outer[(i + 1) % n].y,
  }));
  // Cross-edges: connect every other outer node (Star of David inner triangle)
  const crossEdges = [0, 1, 2].map((i) => ({
    x1: outer[i].x,
    y1: outer[i].y,
    x2: outer[i + 3].x,
    y2: outer[i + 3].y,
  }));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="bg-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1a237e" />
          <stop offset="100%" stopColor="#0d1b5e" />
        </radialGradient>
        <radialGradient id="center-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#b3c8ff" />
          <stop offset="100%" stopColor="#7c9fff" />
        </radialGradient>
        <radialGradient id="node-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#90caf9" />
          <stop offset="100%" stopColor="#42a5f5" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="center-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background circle */}
      <circle cx={cx} cy={cy} r={48} fill="url(#bg-grad)" />

      {/* Ring edges (outer polygon) */}
      {ringEdges.map((e, i) => (
        <line
          key={`ring-${i}`}
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="#3a6bd4"
          strokeWidth={0.8}
          strokeOpacity={0.6}
        />
      ))}

      {/* Cross edges (inner star) */}
      {crossEdges.map((e, i) => (
        <line
          key={`cross-${i}`}
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="#5c8ef5"
          strokeWidth={0.7}
          strokeOpacity={0.45}
        />
      ))}

      {/* Center-to-outer edges */}
      {centerEdges.map((e, i) => (
        <line
          key={`center-${i}`}
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="#7caeff"
          strokeWidth={1.0}
          strokeOpacity={0.75}
        />
      ))}

      {/* Outer nodes */}
      {outer.map((p, i) => (
        <circle
          key={`node-${i}`}
          cx={p.x} cy={p.y} r={5.5}
          fill="url(#node-grad)"
          filter="url(#glow)"
        />
      ))}

      {/* Central focal node — represents the moment of understanding */}
      <circle cx={cx} cy={cy} r={10} fill="url(#center-grad)" filter="url(#center-glow)" />
      <circle cx={cx} cy={cy} r={5} fill="white" opacity={0.92} />
    </svg>
  );
}
