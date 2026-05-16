import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

interface UserAccount {
  wallet: string;
  displayName: string;
  createdAt: number;
  totalWon: number;
  totalBet: number;
  gamesPlayed: number;
}

interface AccountPanelProps {
  onDisplayNameChange: (name: string) => void;
  displayName: string;
}

export default function AccountPanel({ onDisplayNameChange, displayName }: AccountPanelProps) {
  const { publicKey } = useWallet();
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState('');
  const [account, setAccount] = useState<UserAccount | null>(null);

  const wallet = publicKey?.toBase58() || null;

  useEffect(() => {
    if (!wallet) return;
    fetchUser(wallet);
  }, [wallet]);

  const fetchUser = async (w: string) => {
    try {
      const res = await fetch(`/api/user?wallet=${w}`);
      const data = await res.json();
      if (data.user) {
        setAccount(data.user);
        // Only set display name from server if not already set
        if (data.user.displayName && !displayName) {
          onDisplayNameChange(data.user.displayName);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveDisplayName = async () => {
    if (!wallet || !tempName.trim()) return;
    const name = tempName.trim().slice(0, 20);
    try {
      const res = await fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, displayName: name }),
      });
      const data = await res.json();
      if (data.user) {
        setAccount(data.user);
        onDisplayNameChange(data.user.displayName);
        localStorage.setItem(`username_${wallet}`, name);
      }
    } catch (e) {
      console.error(e);
    }
    setEditing(false);
  };

  const lamportsToSol = (l: number) => (l / 1_000_000_000).toFixed(3);

  if (!wallet) return null;

  const shortWallet = wallet.slice(0, 6) + '…' + wallet.slice(-4);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: 'linear-gradient(90deg,#cc5500,#22d3ee)',
        borderRadius: '12px 12px 0 0',
      }} />

      {/* Avatar + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'linear-gradient(135deg,#cc5500,#22d3ee)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '18px', fontFamily: 'var(--font-display)', fontWeight: 800, color: '#fff',
          flexShrink: 0,
          boxShadow: '0 0 16px rgba(255,107,0,0.4)',
        }}>
          {displayName ? displayName.charAt(0).toUpperCase() : '?'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value.slice(0, 20))}
                onKeyDown={(e) => e.key === 'Enter' && saveDisplayName()}
                autoFocus
                maxLength={20}
                placeholder="Username..."
                style={{ flex: 1, fontSize: '13px', padding: '5px 8px' }}
              />
              <button onClick={saveDisplayName} className="btn-orange" style={{ padding: '5px 10px', fontSize: '12px' }}>✓</button>
              <button onClick={() => setEditing(false)} style={{ padding: '5px 8px', fontSize: '12px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--orange-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName || shortWallet}
                </span>
                <button
                  onClick={() => { setTempName(displayName); setEditing(true); }}
                  style={{ padding: '2px 7px', fontSize: '10px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                >
                  ✎
                </button>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace', marginTop: '1px' }}>{shortWallet}</div>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      {account && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          {[
            { label: 'GAMES', value: account.gamesPlayed },
            { label: 'WAGERED', value: `${lamportsToSol(account.totalBet)}◎` },
            { label: 'WON', value: `${lamportsToSol(account.totalWon)}◎` },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: 'rgba(255,107,0,0.06)',
              border: '1px solid rgba(255,107,0,0.12)',
              borderRadius: '8px',
              padding: '8px 6px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
