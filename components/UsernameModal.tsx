import React, { useState, useEffect } from 'react';

interface UsernameModalProps {
  wallet: string;
  onConfirm: (username: string) => void;
}

export default function UsernameModal({ wallet, onConfirm }: UsernameModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Slight delay so modal feels intentional
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a username');
      return;
    }
    if (trimmed.length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }
    onConfirm(trimmed);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
  };

  const shortWallet = wallet.slice(0, 4) + '…' + wallet.slice(-4);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        backdropFilter: 'blur(12px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(145deg, #13082a, #0d0520)',
          border: '1px solid rgba(139, 92, 246, 0.4)',
          borderRadius: '20px',
          padding: '44px 48px',
          textAlign: 'center',
          boxShadow: '0 0 80px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(255,107,0,0.15)',
          width: '100%',
          maxWidth: '420px',
          margin: '0 20px',
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(12px)',
          transition: 'transform 0.25s ease',
        }}
      >
        {/* Logo / Icon */}
        <div style={{ fontSize: '48px', marginBottom: '6px', lineHeight: 1 }}>🎯</div>

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '22px',
            color: '#fff',
            marginBottom: '8px',
            letterSpacing: '-0.01em',
          }}
        >
          Choose your username
        </div>

        <div
          style={{
            fontSize: '12px',
            color: 'rgba(255,255,255,0.4)',
            marginBottom: '28px',
            lineHeight: 1.6,
          }}
        >
          Wallet connected: <span style={{ color: 'rgba(255,107,0,0.9)', fontFamily: 'Space Mono, monospace' }}>{shortWallet}</span>
          <br />
          Your username will appear in chat and on the leaderboard.
        </div>

        {/* Input */}
        <div style={{ marginBottom: '8px' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value.slice(0, 20));
              setError('');
            }}
            onKeyDown={handleKey}
            placeholder="Enter username..."
            autoFocus
            maxLength={20}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${error ? 'rgba(252,92,101,0.5)' : 'rgba(255,107,0,0.3)'}`,
              borderRadius: '10px',
              color: '#fff',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: '16px',
              padding: '14px 16px',
              textAlign: 'center',
              outline: 'none',
              boxShadow: error ? '0 0 0 3px rgba(252,92,101,0.1)' : '0 0 0 3px rgba(255,107,0,0.08)',
              transition: 'all 0.2s',
            }}
          />
        </div>

        {error && (
          <div
            style={{
              fontSize: '12px',
              color: '#FC5C65',
              marginBottom: '12px',
              textAlign: 'left',
              paddingLeft: '4px',
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.25)',
            marginBottom: '20px',
            textAlign: 'right',
          }}
        >
          {name.length}/20
        </div>

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          style={{
            width: '100%',
            padding: '14px',
            fontSize: '15px',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            border: 'none',
            borderRadius: '12px',
            cursor: name.trim() ? 'pointer' : 'not-allowed',
            letterSpacing: '0.03em',
            background: name.trim()
              ? 'linear-gradient(135deg, #cc5500, #ff8c00)'
              : 'rgba(255,255,255,0.08)',
            color: name.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
            boxShadow: name.trim() ? '0 4px 24px rgba(204,85,0, 0.4)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          Enter Casino →
        </button>

        <div
          style={{
            marginTop: '16px',
            fontSize: '10px',
            color: 'rgba(255,255,255,0.2)',
            lineHeight: 1.6,
          }}
        >
          You can change your username anytime in account settings.
        </div>
      </div>
    </div>
  );
}
