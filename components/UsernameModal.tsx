import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';

interface UsernameModalProps {
  wallet: string;
  socket: Socket | null;
  onConfirm: (username: string) => void;
}

export default function UsernameModal({ wallet, socket, onConfirm }: UsernameModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  // Listen for check result from server
  useEffect(() => {
    if (!socket) return;
    const onResult = (res: { available: boolean; error: string | null }) => {
      setChecking(false);
      setAvailable(res.available);
      if (!res.available && res.error) setError(res.error);
      else setError('');
    };
    socket.on('username_check_result', onResult);
    return () => { socket.off('username_check_result', onResult); };
  }, [socket]);

  // Debounced availability check
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) { setAvailable(null); setChecking(false); return; }
    setChecking(true);
    setAvailable(null);
    debounceRef.current = setTimeout(() => {
      if (!socket) { setChecking(false); return; }
      socket.emit('check_username', { name: trimmed, wallet });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [name, socket, wallet]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Please enter a username'); return; }
    if (trimmed.length < 2) { setError('Username must be at least 2 characters'); return; }
    if (available === false) { setError('Username already taken'); return; }
    onConfirm(trimmed);
  };

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleConfirm(); };
  const shortWallet = wallet.slice(0, 4) + '…' + wallet.slice(-4);
  const borderColor = error ? 'rgba(252,92,101,0.5)' : available ? 'rgba(16,185,129,0.6)' : 'rgba(255,107,0,0.3)';
  const canSubmit = name.trim().length >= 2 && available !== false && !checking;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, backdropFilter: 'blur(12px)',
      opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease',
    }}>
      <div style={{
        background: 'linear-gradient(145deg, #13082a, #0d0520)',
        border: '1px solid rgba(139,92,246,0.4)', borderRadius: '20px',
        padding: '44px 48px', textAlign: 'center',
        boxShadow: '0 0 80px rgba(139,92,246,0.2), 0 0 0 1px rgba(255,107,0,0.15)',
        width: '100%', maxWidth: '420px', margin: '0 20px',
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(12px)',
        transition: 'transform 0.25s ease',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '6px', lineHeight: 1 }}>🎯</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '22px', color: '#fff', marginBottom: '8px', letterSpacing: '-0.01em' }}>
          Choose your username
        </div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '28px', lineHeight: 1.6 }}>
          Wallet: <span style={{ color: 'rgba(255,107,0,0.9)', fontFamily: 'Space Mono, monospace' }}>{shortWallet}</span>
          <br />Your username will appear in chat and on the leaderboard.
        </div>

        <div style={{ marginBottom: '8px', position: 'relative' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value.slice(0, 20)); setError(''); setAvailable(null); }}
            onKeyDown={handleKey}
            placeholder="Enter username..."
            autoFocus
            maxLength={20}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${borderColor}`, borderRadius: '10px',
              color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 600,
              fontSize: '16px', padding: '14px 44px 14px 16px',
              textAlign: 'center', outline: 'none', boxSizing: 'border-box',
              boxShadow: error ? '0 0 0 3px rgba(252,92,101,0.1)' : available ? '0 0 0 3px rgba(16,185,129,0.1)' : '0 0 0 3px rgba(255,107,0,0.08)',
              transition: 'all 0.2s',
            }}
          />
          <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px' }}>
            {checking ? '⏳' : available === true ? '✅' : available === false ? '❌' : ''}
          </div>
        </div>

        {error && <div style={{ fontSize: '12px', color: '#FC5C65', marginBottom: '12px', textAlign: 'left', paddingLeft: '4px' }}>{error}</div>}
        {!error && available === true && <div style={{ fontSize: '12px', color: '#10b981', marginBottom: '12px', textAlign: 'left', paddingLeft: '4px' }}>✓ Username available</div>}
        {!error && available !== true && <div style={{ marginBottom: '12px', height: '18px' }} />}

        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginBottom: '20px', textAlign: 'right' }}>
          {name.length}/20
        </div>

        <button
          onClick={handleConfirm}
          disabled={!canSubmit}
          style={{
            width: '100%', padding: '14px', fontSize: '15px',
            fontFamily: 'var(--font-display)', fontWeight: 700,
            border: 'none', borderRadius: '12px',
            cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.03em',
            background: canSubmit ? 'linear-gradient(135deg,#cc5500,#ff8c00)' : 'rgba(255,255,255,0.08)',
            color: canSubmit ? '#fff' : 'rgba(255,255,255,0.3)',
            boxShadow: canSubmit ? '0 4px 24px rgba(204,85,0,0.4)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {checking ? 'Checking...' : 'Enter Casino →'}
        </button>

        <div style={{ marginTop: '16px', fontSize: '10px', color: 'rgba(255,255,255,0.2)', lineHeight: 1.6 }}>
          You can change your username anytime in Settings.
        </div>
      </div>
    </div>
  );
}
