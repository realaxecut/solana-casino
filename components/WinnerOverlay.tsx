import React, { useEffect, useState } from 'react';

interface WinnerOverlayProps {
  winnerDisplayName: string;
  winnerWallet: string;
  winnerShare: number;
  totalPot: number;
  isYou: boolean;
  onClose: () => void;
}

function Confetti() {
  const pieces = Array.from({ length: 36 });
  const colors = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#22d3ee', '#10b981', '#f472b6', '#fbbf24'];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {pieces.map((_, i) => {
        const color = colors[i % colors.length];
        const left = Math.random() * 100;
        const delay = Math.random() * 2;
        const size = 6 + Math.random() * 8;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${left}%`,
            top: '-10px',
            width: size,
            height: size,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            background: color,
            animation: `confetti-fall ${1.5 + Math.random()}s ${delay}s ease-in forwards`,
            opacity: 0.85,
          }} />
        );
      })}
    </div>
  );
}

export default function WinnerOverlay({ winnerDisplayName, winnerWallet, winnerShare, totalPot, isYou, onClose }: WinnerOverlayProps) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onClose(); }, 9000);
    return () => clearTimeout(t);
  }, [onClose]);

  if (!visible) return null;

  const solWon = (winnerShare / 1_000_000_000).toFixed(4);
  const totalSol = (totalPot / 1_000_000_000).toFixed(4);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ position: 'relative', overflow: 'hidden', maxWidth: '440px', width: '100%', margin: '0 20px' }}>
        <Confetti />
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: 'linear-gradient(145deg,#13082a,#0d0520)',
            border: '2px solid rgba(255,107,0,0.5)',
            borderRadius: '24px',
            padding: '48px 48px 40px',
            textAlign: 'center',
            boxShadow: '0 0 80px rgba(255,107,0,0.35), 0 0 160px rgba(255,107,0,0.1)',
            position: 'relative', zIndex: 1,
          }}
        >
          {/* Top line */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg,#cc5500,#22d3ee)', borderRadius: '24px 24px 0 0' }} />

          <div style={{ fontSize: '60px', marginBottom: '8px', lineHeight: 1 }}>🏆</div>

          <div style={{ fontFamily: 'var(--font-display)', fontSize: '12px', letterSpacing: '0.2em', color: 'var(--text-muted)', marginBottom: '12px' }}>
            JACKPOT WINNER
          </div>

          <div style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: isYou ? '38px' : '28px',
            color: isYou ? '#10b981' : 'var(--orange-bright)',
            marginBottom: '8px',
            textShadow: isYou ? '0 0 40px rgba(16,185,129,0.6)' : '0 0 40px rgba(255,107,0,0.6)',
            animation: 'winner-flash 0.8s ease-in-out infinite',
          }}>
            {isYou ? '🎉 YOU WIN!' : winnerDisplayName}
          </div>

          {isYou && (
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {winnerDisplayName}
            </div>
          )}

          <div style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '36px',
            color: '#10b981',
            marginBottom: '4px',
            textShadow: '0 0 24px rgba(16,185,129,0.4)',
          }}>
            +{solWon} ◎
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '24px' }}>
            from {totalSol} SOL pot · 5% fee deducted
          </div>

          <div style={{
            fontSize: '11px', color: 'var(--text-muted)',
            fontFamily: 'Space Mono, monospace',
            marginBottom: '24px',
            padding: '8px 14px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '8px',
            display: 'inline-block',
            border: '1px solid var(--border-color)',
          }}>
            {winnerWallet.slice(0, 8)}...{winnerWallet.slice(-8)}
          </div>

          <button
            onClick={onClose}
            className="btn-primary"
            style={{ display: 'block', width: '100%', padding: '13px', fontSize: '14px' }}
          >
            Next Round →
          </button>
        </div>
      </div>
    </div>
  );
}
