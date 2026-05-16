import React from 'react';

interface Player {
  wallet: string;
  displayName: string;
  betAmount: number;
  percentage: number;
  color: string;
}

interface PlayerListProps {
  players: Player[];
  totalPot: number;
  winnerWallet: string | null;
  currentWallet: string | null;
}

function lamportsToSol(l: number): string {
  return (l / 1_000_000_000).toFixed(4);
}

export default function PlayerList({ players, totalPot, winnerWallet, currentWallet }: PlayerListProps) {
  const sorted = [...players].sort((a, b) => b.betAmount - a.betAmount);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(139,92,246,0.04)',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
          PLAYERS ({players.length})
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          POT: <span style={{ color: 'var(--purple-soft)', fontWeight: 700 }}>{lamportsToSol(totalPot)} SOL</span>
        </span>
      </div>

      <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.8 }}>
            <div style={{ fontSize: '24px', marginBottom: '6px' }}>🎯</div>
            No players yet.<br />Be the first to buy a ticket!
          </div>
        ) : (
          sorted.map((player, i) => {
            const isWinner = winnerWallet === player.wallet;
            const isYou = currentWallet === player.wallet;
            return (
              <div
                key={player.wallet}
                style={{
                  padding: '9px 16px',
                  borderBottom: '1px solid rgba(139,92,246,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: isWinner
                    ? 'rgba(16,185,129,0.07)'
                    : isYou
                    ? 'rgba(139,92,246,0.06)'
                    : 'transparent',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', width: '16px', textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>

                <div style={{ width: 9, height: 9, borderRadius: '50%', background: player.color, flexShrink: 0, boxShadow: `0 0 6px ${player.color}80` }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 600,
                    color: isWinner ? '#10b981' : 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    {player.displayName}
                    {isYou && (
                      <span style={{ fontSize: '9px', background: 'rgba(139,92,246,0.2)', color: 'var(--purple-soft)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '4px', padding: '1px 5px' }}>
                        YOU
                      </span>
                    )}
                    {isWinner && (
                      <span style={{ fontSize: '9px', background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '4px', padding: '1px 5px' }}>
                        👑 WINNER
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--purple-soft)', fontWeight: 700 }}>{lamportsToSol(player.betAmount)} SOL</div>
                  <div style={{ fontSize: '10px', color: player.color }}>{player.percentage.toFixed(2)}%</div>
                </div>

                {/* Bar */}
                <div style={{ width: '36px', height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ width: `${player.percentage}%`, height: '100%', background: player.color, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
