import React, { useMemo, useRef, useEffect, useState } from 'react';

interface Player {
  wallet: string;
  displayName: string;
  betAmount: number;
  percentage: number;
  color: string;
}

interface OrangeWheelProps {
  players: Player[];
  totalPot: number;
  isSpinning: boolean;
  isIdleSpinning?: boolean;
  winnerWallet: string | null;
  size?: number;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

export default function OrangeWheel({
  players,
  totalPot,
  isSpinning,
  isIdleSpinning = false,
  winnerWallet,
  size = 380,
}: OrangeWheelProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;
  const innerR = r * 0.28;
  const [rotation, setRotation] = useState(0);
  const [hoveredWallet, setHoveredWallet] = useState<string | null>(null);
  const spinRef = useRef<NodeJS.Timeout | null>(null);
  const idleFrameRef = useRef<number | null>(null);
  const rotationRef = useRef(0);

  // Fast/winner spin
  useEffect(() => {
    if (isSpinning) {
      if (idleFrameRef.current) cancelAnimationFrame(idleFrameRef.current);
      const startRot = rotationRef.current;
      const totalSpin = 720 + Math.random() * 360;
      const startTime = Date.now();
      const duration = 5000;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const newRot = startRot + eased * totalSpin;
        rotationRef.current = newRot;
        setRotation(newRot);
        if (progress < 1) {
          spinRef.current = setTimeout(animate, 16);
        }
      };
      animate();
      return () => {
        if (spinRef.current) clearTimeout(spinRef.current);
      };
    }
  }, [isSpinning]);

  // Idle slow spin while bets are open
  useEffect(() => {
    if (isSpinning) return; // fast spin takes over
    if (isIdleSpinning) {
      let last: number | null = null;
      const tick = (ts: number) => {
        if (last !== null) {
          const delta = ts - last;
          rotationRef.current = (rotationRef.current + delta * 0.025) % 360; // ~9°/sec
          setRotation(rotationRef.current);
        }
        last = ts;
        idleFrameRef.current = requestAnimationFrame(tick);
      };
      idleFrameRef.current = requestAnimationFrame(tick);
      return () => {
        if (idleFrameRef.current) cancelAnimationFrame(idleFrameRef.current);
      };
    } else {
      if (idleFrameRef.current) cancelAnimationFrame(idleFrameRef.current);
    }
  }, [isIdleSpinning, isSpinning]);

  const segments = useMemo(() => {
    if (players.length === 0) return [];
    let cumAngle = 0;
    return players.map((player) => {
      const angle = (player.percentage / 100) * 360;
      const seg = {
        ...player,
        startAngle: cumAngle,
        endAngle: cumAngle + angle,
        angle,
      };
      cumAngle += angle;
      return seg;
    });
  }, [players]);

  const lamportsToSol = (l: number) => (l / 1_000_000_000).toFixed(3);
  const isEmpty = players.length === 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          filter: isSpinning
            ? 'drop-shadow(0 0 30px rgba(255,107,0,0.8))'
            : isIdleSpinning
            ? 'drop-shadow(0 0 20px rgba(255,107,0,0.45))'
            : 'drop-shadow(0 0 15px rgba(255,107,0,0.3))',
          transform: `rotate(${rotation}deg)`,
          transition: 'filter 0.3s',
          transformOrigin: 'center',
          willChange: 'transform',
        }}
      >
        {/* Outer glow rings */}
        <circle cx={cx} cy={cy} r={r + 8} fill="none" stroke="rgba(255,107,0,0.15)" strokeWidth="4" />
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="rgba(255,107,0,0.08)" strokeWidth="3" />

        {/* Main background */}
        <circle cx={cx} cy={cy} r={r} fill="#1a0800" />

        {isEmpty ? (
          <>
            <circle cx={cx} cy={cy} r={r} fill="#ff6b00" opacity="0.15" />
            {[0, 60, 120, 180, 240, 300].map((angle) => {
              const pt = polarToCartesian(cx, cy, r, angle);
              return (
                <line key={angle} x1={cx} y1={cy} x2={pt.x} y2={pt.y}
                  stroke="rgba(255,107,0,0.2)" strokeWidth="1" />
              );
            })}
            <circle cx={cx} cy={cy} r={innerR} fill="#0a0500" />
            <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="rgba(255,107,0,0.3)" strokeWidth="2" />
          </>
        ) : (
          <>
            {segments.map((seg) => {
              const isWinner = winnerWallet === seg.wallet;
              const isHovered = hoveredWallet === seg.wallet;
              return (
                <g key={seg.wallet}
                  onMouseEnter={() => setHoveredWallet(seg.wallet)}
                  onMouseLeave={() => setHoveredWallet(null)}
                  className="pie-segment"
                >
                  <path
                    d={describeArc(cx, cy, r, seg.startAngle, seg.endAngle)}
                    fill={seg.color}
                    stroke="#0a0500"
                    strokeWidth="2"
                    opacity={isWinner ? 1 : isHovered ? 0.9 : 0.85}
                    style={{
                      filter: isWinner
                        ? `drop-shadow(0 0 12px ${seg.color})`
                        : isHovered ? `drop-shadow(0 0 6px ${seg.color})` : 'none',
                    }}
                  />
                  {seg.angle > 25 && (() => {
                    const midAngle = seg.startAngle + seg.angle / 2;
                    const labelR = r * 0.65;
                    const lp = polarToCartesian(cx, cy, labelR, midAngle);
                    return (
                      <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
                        fontSize="10" fill="rgba(255,255,255,0.85)"
                        fontFamily="'Space Mono', monospace" fontWeight="bold"
                        style={{ pointerEvents: 'none' }}>
                        {seg.percentage.toFixed(1)}%
                      </text>
                    );
                  })()}
                </g>
              );
            })}
            {segments.map((seg) => {
              const pt = polarToCartesian(cx, cy, r, seg.startAngle);
              return (
                <line key={`line-${seg.wallet}`} x1={cx} y1={cy} x2={pt.x} y2={pt.y}
                  stroke="#0a0500" strokeWidth="2" />
              );
            })}
          </>
        )}

        {/* Orange peel texture */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="rgba(255,140,0,0.1)" strokeWidth="1" strokeDasharray="4 8" />

        {/* Inner hub */}
        <circle cx={cx} cy={cy} r={innerR} fill="#0a0400" />
        <circle cx={cx} cy={cy} r={innerR - 2} fill="#110600" />
        <circle cx={cx} cy={cy} r={innerR - 4} fill="none"
          stroke="rgba(255,107,0,0.4)" strokeWidth="2" />
        <circle cx={cx} cy={cy} r={6} fill="rgba(255,107,0,0.6)" />

        {/* Outer ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,107,0,0.4)" strokeWidth="2" />

        {/* Tick marks */}
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i * 360) / 24;
          const outer = polarToCartesian(cx, cy, r + 1, angle);
          const inner2 = polarToCartesian(cx, cy, r - (i % 4 === 0 ? 10 : 5), angle);
          return (
            <line key={`tick-${i}`} x1={outer.x} y1={outer.y} x2={inner2.x} y2={inner2.y}
              stroke="rgba(255,140,0,0.5)" strokeWidth={i % 4 === 0 ? 2 : 1} />
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hoveredWallet && (() => {
        const seg = segments.find((s) => s.wallet === hoveredWallet);
        if (!seg) return null;
        return (
          <div className="absolute pointer-events-none" style={{
            bottom: 0, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(10,4,0,0.95)', border: `1px solid ${seg.color}`,
            borderRadius: '8px', padding: '8px 14px', whiteSpace: 'nowrap', zIndex: 10,
          }}>
            <div style={{ color: seg.color, fontWeight: 700, fontSize: '13px', fontFamily: 'Syne' }}>
              {seg.displayName}
            </div>
            <div style={{ color: '#c8a070', fontSize: '11px' }}>
              {lamportsToSol(seg.betAmount)} SOL · {seg.percentage.toFixed(2)}%
            </div>
          </div>
        );
      })()}
    </div>
  );
}
