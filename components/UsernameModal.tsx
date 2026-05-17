import React, { useState, useEffect, useRef } from 'react';

interface UsernameModalProps {
  wallet: string;
  socket: any; // kept for API compatibility but no longer used for checking
  onConfirm: (username: string) => void;
}

export default function UsernameModal({ wallet, onConfirm }: UsernameModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  const validate = (trimmed: string): string | null => {
    if (!trimmed) return 'Please enter a username';
    if (trimmed.length < 2) return 'Username must be at least 2 characters';
    if (trimmed.length > 20) return 'Username must be 20 characters or less';
    if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) return 'Only letters, numbers, spaces, _ - . allowed';
    return null;
  };

  const handleConfirm = () => {
    const trimmed = name.trim();
    const validationError = validate(trimmed);
    if (validationError) { setError(validationError); return; }
    onConfirm(trimmed);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
  };

  const shortWallet = wallet.slice(0, 4) + '…' + wallet.slice(-4);
  const trimmed = name.trim();
  const localValid = trimmed.length >= 2 && !validate(trimmed);
  const borderColor = error
    ? 'rgba(252,92,101,0.5)'
    : localValid
    ? 'rgba(16,185,129,0.6)'
    : 'rgba(255,107,0,0.3)';
  const canSubmit = localValid;

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
            onChange={(e) => { setName(e.target.value.slice(0, 20)); setError(''); }}
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
              transition: 'all 0.2s',
            }}
          />
          <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px' }}>
            {trimmed.length >= 2 ? (localValid ? '✅' : '❌') : ''}
          </div>
        </div>

        {error && (
          <div style={{ fontSize: '12px', color: '#FC5C65', marginBottom: '12px', textAlign: 'left', paddingLeft: '4px' }}>
            {error}
          </div>
        )}
        {!error && localValid && (
          <div style={{ fontSize: '12px', color: '#10b981', marginBottom: '12px', textAlign: 'left', paddingLeft: '4px' }}>
            ✓ Username looks good
          </div>
        )}
        {!error && !localValid && <div style={{ marginBottom: '12px', height: '18px' }} />}

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
          Enter Casino →
        </button>

        <div style={{ marginTop: '16px', fontSize: '10px', color: 'rgba(255,255,255,0.2)', lineHeight: 1.6 }}>
          You can change your username anytime in Settings.
        </div>
      </div>
    </div>
  );
}
