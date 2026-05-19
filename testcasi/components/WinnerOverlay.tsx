import React, { useEffect, useState, useRef } from 'react';
import { Socket } from 'socket.io-client';

interface WinnerOverlayProps {
  winnerDisplayName: string;
  winnerWallet: string;
  winnerShare: number;
  totalPot: number;
  isYou: boolean;
  roundId: string;
  wallet: string | null;
  socket: Socket | null;
  onClose: () => void;
  onReenterPot?: () => void;  // optional: triggers re-enter flow
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

export default function WinnerOverlay({ winnerDisplayName, winnerWallet, winnerShare, totalPot, isYou, roundId, wallet, socket, onClose, onReenterPot }: WinnerOverlayProps) {
  const [visible, setVisible] = useState(true);
  const [claimState, setClaimState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');
  const [reenterState, setReenterState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [reenterError, setReenterError] = useState('');
  // Prevent double-click: track if a claim request is in-flight
  const claimInFlight = useRef(false);

  // Auto-close only if not the winner (winner stays until they claim or manually close)
  useEffect(() => {
    if (isYou) return;
    const t = setTimeout(() => { setVisible(false); onClose(); }, 9000);
    return () => clearTimeout(t);
  }, [onClose, isYou]);

  // Listen for claim result from server
  useEffect(() => {
    if (!socket || !isYou) return;
    const handler = (res: { success: boolean; claimTx?: string; amount?: number; error?: string; alreadyClaimed?: boolean }) => {
      claimInFlight.current = false;
      if (res.success) {
        setClaimState('success');
        setClaimTx(res.claimTx || null);
      } else {
        setClaimState('error');
        setClaimError(res.error || 'Claim failed');
        // If already claimed by a previous session, show success-like state
        if (res.alreadyClaimed && res.claimTx) {
          setClaimState('success');
          setClaimTx(res.claimTx);
        }
      }
    };
    socket.on('claim_result', handler);
    return () => { socket.off('claim_result', handler); };
  }, [socket, isYou]);

  // Listen for re-enter result
  useEffect(() => {
    if (!socket || !isYou) return;
    const handler = (res: { success: boolean; amountLamports?: number; error?: string }) => {
      if (res.success) {
        setReenterState('success');
        setTimeout(() => { onClose(); }, 1800);
      } else {
        setReenterState('error');
        setReenterError(res.error || 'Re-enter failed — try claiming instead');
      }
    };
    socket.on('reenter_result', handler);
    return () => { socket.off('reenter_result', handler); };
  }, [socket, isYou, onClose]);

  const handleClaim = () => {
    // Hard guards: no double submit
    if (claimInFlight.current || claimState === 'loading' || claimState === 'success') return;
    if (!socket || !wallet || !roundId) {
      setClaimError('Not connected — please refresh and try again');
      setClaimState('error');
      return;
    }
    claimInFlight.current = true;
    setClaimState('loading');
    setClaimError('');
    socket.emit('claim_payout', { wallet, roundId });
  };

  const handleReenter = () => {
    if (reenterState === 'loading' || reenterState === 'success') return;
    if (!socket || !wallet || !roundId) {
      setReenterError('Not connected — please refresh and try again');
      setReenterState('error');
      return;
    }
    setReenterState('loading');
    setReenterError('');
    socket.emit('reenter_orangepot', { wallet, roundId });
  };

  if (!visible) return null;

  const solWon = (winnerShare / 1_000_000_000).toFixed(4);
  const totalSol = (totalPot / 1_000_000_000).toFixed(4);

  return (
    <div
      onClick={isYou ? undefined : onClose}
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

          {/* Claim button — only shown to the winner */}
          {isYou ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {claimState === 'success' ? (
                <div style={{ padding: '16px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '12px' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px', color: '#10b981', marginBottom: '6px' }}>
                    ✅ Prize Sent!
                  </div>
                  {claimTx && (
                    <a
                      href={`https://explorer.solana.com/tx/${claimTx}?cluster=${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? 'mainnet' : 'devnet'}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: '11px', color: '#10b981', textDecoration: 'underline', fontFamily: 'Space Mono, monospace' }}
                    >
                      View on Explorer ↗
                    </a>
                  )}
                </div>
              ) : reenterState === 'success' ? (
                <div style={{ padding: '16px', background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.4)', borderRadius: '12px' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px', color: 'var(--orange-bright)', marginBottom: '4px' }}>
                    🍊 Entered the Pot!
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Your winnings are back in play...</div>
                </div>
              ) : (
                <>
                  {/* Primary: Claim SOL */}
                  <button
                    onClick={handleClaim}
                    disabled={claimState === 'loading' || reenterState === 'loading'}
                    style={{
                      display: 'block', width: '100%', padding: '16px',
                      borderRadius: '12px', border: 'none', cursor: (claimState === 'loading' || reenterState === 'loading') ? 'not-allowed' : 'pointer',
                      background: claimState === 'loading'
                        ? 'rgba(255,255,255,0.1)'
                        : 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#fff',
                      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px',
                      letterSpacing: '0.04em',
                      boxShadow: claimState === 'loading' ? 'none' : '0 0 30px rgba(16,185,129,0.5)',
                      transition: 'all 0.2s',
                      opacity: (claimState === 'loading' || reenterState === 'loading') ? 0.7 : 1,
                    }}
                  >
                    {claimState === 'loading' ? '⏳ Sending...' : `💰 Claim ${solWon} SOL`}
                  </button>

                  {/* Secondary: Re-enter Pot */}
                  <button
                    onClick={handleReenter}
                    disabled={claimState === 'loading' || reenterState === 'loading'}
                    style={{
                      display: 'block', width: '100%', padding: '13px',
                      borderRadius: '12px', border: '1px solid rgba(255,140,0,0.4)',
                      cursor: (claimState === 'loading' || reenterState === 'loading') ? 'not-allowed' : 'pointer',
                      background: reenterState === 'loading' ? 'rgba(255,140,0,0.1)' : 'rgba(255,140,0,0.08)',
                      color: 'var(--orange-soft)',
                      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px',
                      letterSpacing: '0.03em',
                      transition: 'all 0.2s',
                      opacity: (claimState === 'loading' || reenterState === 'loading') ? 0.6 : 1,
                    }}
                  >
                    {reenterState === 'loading' ? '⏳ Entering...' : `🍊 Re-enter Pot (${solWon} SOL)`}
                  </button>

                  {(claimState === 'error' || reenterState === 'error') && (
                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '12px', color: '#f87171' }}>
                      {claimState === 'error' ? claimError : reenterError}
                    </div>
                  )}
                </>
              )}

              <button
                onClick={onClose}
                style={{
                  display: 'block', width: '100%', padding: '11px',
                  borderRadius: '10px', border: '1px solid var(--border-color)',
                  background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                  fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {claimState === 'success' || reenterState === 'success' ? 'Next Round →' : 'Claim Later'}
              </button>
            </div>
          ) : (
            <button
              onClick={onClose}
              className="btn-primary"
              style={{ display: 'block', width: '100%', padding: '13px', fontSize: '14px' }}
            >
              Next Round →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
