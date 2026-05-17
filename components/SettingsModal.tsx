import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';

interface SettingsModalProps {
  wallet: string;
  currentDisplayName: string;
  socket: Socket | null;
  onClose: () => void;
  onUsernameChanged: (newName: string) => void;
}

export default function SettingsModal({ wallet, currentDisplayName, socket, onClose, onUsernameChanged }: SettingsModalProps) {
  const [newName, setNewName] = useState(currentDisplayName);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  // Listen for check result from server
  useEffect(() => {
    if (!socket) return;
    const onCheckResult = (res: { available: boolean; error: string | null }) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setChecking(false);
      setAvailable(res.available);
      if (!res.available && res.error) setError(res.error);
      else setError('');
    };
    socket.on('username_check_result', onCheckResult);
    return () => { socket.off('username_check_result', onCheckResult); };
  }, [socket]);

  // Listen for save result
  useEffect(() => {
    if (!socket) return;
    const onChangeResult = (res: { success: boolean; error?: string; user?: { displayName: string } }) => {
      setSaving(false);
      if (res.success && res.user) {
        setSuccess('Username updated!');
        setAvailable(null);
        onUsernameChanged(res.user.displayName);
        localStorage.setItem(`username_${wallet}`, res.user.displayName);
      } else {
        setError(res.error || 'Failed to update username');
      }
    };
    socket.on('username_change_result', onChangeResult);
    return () => { socket.off('username_change_result', onChangeResult); };
  }, [socket, wallet, onUsernameChanged]);

  // Debounced availability check — with 3s timeout fallback
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const trimmed = newName.trim();
    setSuccess('');
    if (!trimmed || trimmed === currentDisplayName || trimmed.length < 2) {
      setAvailable(null); setChecking(false); return;
    }

    // If socket not connected yet, assume available
    if (!socket || !socket.connected) {
      setAvailable(true); setChecking(false); return;
    }

    setChecking(true); setAvailable(null);

    // Safety timeout: if server doesn't reply in 3s, assume available
    timeoutRef.current = setTimeout(() => {
      setChecking(false);
      setAvailable(true);
    }, 3000);

    debounceRef.current = setTimeout(() => {
      if (!socket || !socket.connected) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setChecking(false);
        setAvailable(true);
        return;
      }
      socket.emit('check_username', { name: trimmed, wallet });
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [newName, socket, wallet, currentDisplayName]);

  const handleSave = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length < 2) { setError('Username must be at least 2 characters'); return; }
    if (trimmed === currentDisplayName) { setError('That is already your username'); return; }
    if (available === false) { setError('Username already taken'); return; }
    if (!socket) { setError('Not connected to server'); return; }
    setSaving(true);
    setError('');
    socket.emit('change_username', { wallet, newName: trimmed });
  };

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSave(); };
  const shortWallet = wallet.slice(0, 6) + '...' + wallet.slice(-6);
  const trimmed = newName.trim();
  const isChanged = trimmed !== currentDisplayName && trimmed.length >= 2;
  const canSave = isChanged && available !== false && !checking && !saving;
  const borderColor = error ? 'rgba(252,92,101,0.5)' : (available === true || success) ? 'rgba(16,185,129,0.6)' : 'rgba(255,107,0,0.3)';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, backdropFilter: 'blur(8px)',
        opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease',
      }}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)', borderRadius: '20px',
        width: '100%', maxWidth: '460px', margin: '0 20px',
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(10px)',
        transition: 'transform 0.22s ease', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid var(--border-color)',
          background: 'rgba(255,107,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚙️</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px', color: 'var(--text-primary)' }}>Settings</span>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)',
            borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '18px', width: '32px', height: '32px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          {/* Wallet info */}
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)',
            borderRadius: '12px', padding: '14px 16px', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '6px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              CONNECTED WALLET
            </div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: '13px', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              {shortWallet}
            </div>
          </div>

          {/* Username section */}
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '14px' }}>
            Change Username
          </div>

          <div style={{ position: 'relative', marginBottom: '10px' }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => { setNewName(e.target.value.slice(0, 20)); setError(''); setSuccess(''); setAvailable(null); }}
              onKeyDown={handleKey}
              maxLength={20}
              placeholder="New username..."
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-primary)', border: `1px solid ${borderColor}`,
                borderRadius: '10px', color: 'var(--text-primary)',
                fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '15px',
                padding: '12px 44px 12px 14px', outline: 'none', transition: 'border-color 0.2s',
                boxShadow: error ? '0 0 0 3px rgba(252,92,101,0.1)' : (available === true || success) ? '0 0 0 3px rgba(16,185,129,0.1)' : 'none',
              }}
            />
            <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px' }}>
              {checking ? '⏳' : available === true ? '✅' : available === false ? '❌' : success ? '✅' : ''}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', minHeight: '18px' }}>
            <div style={{ fontSize: '12px' }}>
              {error && <span style={{ color: '#f87171' }}>{error}</span>}
              {!error && success && <span style={{ color: '#10b981' }}>✓ {success}</span>}
              {!error && !success && available === true && <span style={{ color: '#10b981' }}>✓ Username available</span>}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{newName.length}/20</div>
          </div>

          <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '16px' }}>
            Letters, numbers, spaces, _ - . allowed · 2–20 characters
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              width: '100%', padding: '12px',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px',
              border: 'none', borderRadius: '10px', letterSpacing: '0.03em',
              cursor: canSave ? 'pointer' : 'not-allowed',
              background: canSave ? 'linear-gradient(135deg,#cc5500,#ff8c00)' : 'rgba(255,255,255,0.06)',
              color: canSave ? '#fff' : 'var(--text-muted)',
              boxShadow: canSave ? '0 4px 20px rgba(204,85,0,0.35)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {saving ? 'Saving...' : checking ? 'Checking...' : 'Save Username'}
          </button>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--border-color)',
          background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'center',
        }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7 }}>
            FruitBowl.fun · 5% house edge · Solana Devnet
          </div>
        </div>
      </div>
    </div>
  );
}
