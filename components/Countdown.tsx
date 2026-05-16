import React, { useState, useEffect, useRef } from 'react';

interface CountdownProps {
  endsAt: number | null;
  status: string;
}

export default function Countdown({ endsAt, status }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState(60);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!endsAt) {
      setTimeLeft(60);
      firedRef.current = false;
      return;
    }

    firedRef.current = false;

    const update = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    };

    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [endsAt]);

  const totalSeconds = 60;
  const progress = endsAt ? Math.max(0, timeLeft / totalSeconds) : 1;
  const circumference = 2 * Math.PI * 44;
  const strokeDash = circumference * progress;

  const isUrgent = timeLeft <= 10 && status === 'active';
  const color = isUrgent ? '#FC5C65' : 'var(--orange-bright)';

  if (status === 'waiting') {
    return (
      <div style={{
        background: 'rgba(120,100,60,0.08)',
        border: '1px solid rgba(120,100,60,0.2)',
        borderRadius: '10px',
        padding: '14px 20px',
        textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          WAITING FOR PLAYERS
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Need at least 2 players to start</div>
      </div>
    );
  }

  if (status === 'spinning') {
    return (
      <div style={{
        background: 'rgba(255,159,28,0.08)',
        border: '1px solid rgba(255,159,28,0.3)',
        borderRadius: '10px',
        padding: '14px 20px',
        textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: '#FF9F1C', letterSpacing: '0.08em', animation: 'pulse 0.6s ease-in-out infinite alternate' }}>
          🍊 SPINNING...
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Picking the winner!</div>
      </div>
    );
  }

  if (status === 'ended') {
    return (
      <div style={{
        background: 'rgba(38,222,129,0.08)',
        border: '1px solid rgba(38,222,129,0.2)',
        borderRadius: '10px',
        padding: '14px 20px',
        textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: '#26DE81', letterSpacing: '0.08em' }}>
          ROUND ENDED
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>New round starting...</div>
      </div>
    );
  }

  // Active state — full timer display
  return (
    <div style={{
      background: isUrgent ? 'rgba(252,92,101,0.08)' : 'rgba(255,107,0,0.06)',
      border: `1px solid ${isUrgent ? 'rgba(252,92,101,0.3)' : 'rgba(255,107,0,0.2)'}`,
      borderRadius: '10px',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      transition: 'all 0.3s',
    }}>
      {/* Circular timer */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          {/* Track */}
          <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
          {/* Progress */}
          <circle
            cx="50" cy="50" r="44"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${strokeDash} ${circumference}`}
            strokeDashoffset="0"
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dasharray 0.25s linear, stroke 0.3s', filter: `drop-shadow(0 0 4px ${color})` }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 800,
            fontSize: timeLeft >= 100 ? '20px' : '26px',
            color, lineHeight: 1,
            transition: 'color 0.3s',
          }}>
            {timeLeft}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>SEC</div>
        </div>
      </div>

      {/* Text info */}
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color, letterSpacing: '0.05em', marginBottom: '4px' }}>
          {isUrgent ? '⚡ SPINNING SOON' : 'ROUND IN PROGRESS'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          More players can still join!<br />
          <span style={{ color: 'var(--orange-soft)' }}>Bigger bet = better odds</span>
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: '10px', height: '3px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            background: isUrgent ? '#FC5C65' : 'var(--orange-bright)',
            width: `${progress * 100}%`,
            transition: 'width 0.25s linear, background 0.3s',
            borderRadius: '2px',
          }} />
        </div>
      </div>
    </div>
  );
}
