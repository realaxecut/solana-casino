import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { Socket } from 'socket.io-client';

// ─── HOUSE WALLET ───────────────────────────────────────────────────────────
// Replace this with your actual Solana mainnet house wallet address.
// All bets are sent here; the backend tracks them and pays out winners.
const HOUSE_WALLET = process.env.NEXT_PUBLIC_HOUSE_WALLET || '';
// ────────────────────────────────────────────────────────────────────────────

interface BetPanelProps {
  socket: Socket | null;
  displayName: string;
  roundStatus: string;
  myBet: number;
  isConnected: boolean;
}

const QUICK_BETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1];

export default function BetPanel({ socket, displayName, roundStatus, myBet, isConnected }: BetPanelProps) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [betAmount, setBetAmount] = useState('0.1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [txSig, setTxSig] = useState('');

  const wallet = publicKey?.toBase58() || null;

  const handleBet = async () => {
    if (!wallet || !publicKey || !socket) return;
    setError('');
    setTxSig('');

    if (!HOUSE_WALLET) {
      setError('House wallet not configured — contact support.');
      return;
    }

    const solAmount = parseFloat(betAmount);
    if (isNaN(solAmount) || solAmount < 0.0001) {
      setError('Minimum bet is 0.0001 SOL');
      return;
    }
    if (roundStatus === 'spinning' || roundStatus === 'ended') {
      setError('Round is closed — wait for next round');
      return;
    }

    setLoading(true);
    try {
      const balance = await connection.getBalance(publicKey);
      const fee = 5000;
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
      if (lamports + fee > balance) { setError('Insufficient balance to cover bet + network fee'); setLoading(false); return; }
      const houseWalletPk = new PublicKey(HOUSE_WALLET);

      const transaction = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: houseWalletPk, lamports })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');

      setTxSig(signature);

      socket.emit('place_bet', {
        wallet,
        displayName: displayName || wallet.slice(0, 8),
        amountLamports: lamports,
        txSignature: signature,
      });

    } catch (e: any) {
      if (e.message?.includes('rejected') || e.message?.includes('cancelled')) {
        setError('Transaction cancelled');
      } else {
        setError(e.message || 'Transaction failed');
      }
    }
    setLoading(false);
  };

  const isAcceptingBets = roundStatus === 'waiting' || roundStatus === 'active';
  const myBetSol = (myBet / LAMPORTS_PER_SOL).toFixed(4);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '18px',
      position: 'relative',
      overflow: 'visible',
      boxSizing: 'border-box',
      minWidth: 0,
    }}>
      {/* Top accent */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: 'linear-gradient(90deg,#9f67fa,#22d3ee)',
        borderRadius: '12px 12px 0 0',
      }} />

      <div style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '13px',
        color: 'var(--text-secondary)',
        letterSpacing: '0.1em',
        marginBottom: '14px',
      }}>
        ENTER JACKPOT
      </div>

      {!wallet ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.6 }}>
            Connect your Phantom wallet<br />to place a bet
          </p>
          <WalletMultiButton />
        </div>
      ) : (
        <>
          {myBet > 0 && (
            <div style={{
              background: 'rgba(139,92,246,0.08)',
              border: '1px solid rgba(139,92,246,0.2)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '14px',
              fontSize: '12px',
              color: 'var(--purple-soft)',
            }}>
              Your current bet: <strong>{myBetSol} SOL</strong>
              <br />
              <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Add more to increase your slice!</span>
            </div>
          )}

          {/* Amount input */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '5px', letterSpacing: '0.06em' }}>
              AMOUNT (SOL)
            </label>
            <input
              type="number"
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              min="0.0001"
              step="0.0001"
              style={{ width: '100%', fontSize: '16px', padding: '10px 14px', fontFamily: 'var(--font-display)', fontWeight: 700 }}
            />
          </div>

          {/* Quick bets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px', marginBottom: '14px', minWidth: 0 }}>
            {QUICK_BETS.map(amt => (
              <button
                key={amt}
                onClick={() => setBetAmount(String(amt))}
                style={{
                  padding: '7px 4px',
                  fontSize: '11px',
                  background: betAmount === String(amt) ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${betAmount === String(amt) ? 'rgba(139,92,246,0.5)' : 'var(--border-color)'}`,
                  borderRadius: '7px',
                  color: betAmount === String(amt) ? 'var(--purple-soft)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'Space Mono, monospace',
                  fontWeight: betAmount === String(amt) ? 700 : 400,
                }}
              >
                {amt}◎
              </button>
            ))}
          </div>

          {/* Place bet button */}
          <button
            onClick={handleBet}
            disabled={loading || !isAcceptingBets || !isConnected}
            className="btn-primary"
            style={{ width: '100%', padding: '14px', fontSize: '13px', letterSpacing: '0.02em', whiteSpace: 'normal', wordBreak: 'break-word', minHeight: '48px', lineHeight: 1.3 }}
          >
            {loading
              ? '⏳ CONFIRMING...'
              : !isAcceptingBets
              ? '🔒 ROUND CLOSED'
              : `🎯 BUY TICKET — ${betAmount || '0'} SOL`}
          </button>

          {error && (
            <div style={{ marginTop: '10px', padding: '9px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', fontSize: '12px', color: '#f87171' }}>
              {error}
            </div>
          )}
          {txSig && (
            <div style={{ marginTop: '10px', padding: '9px 12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', fontSize: '11px', color: '#10b981' }}>
              ✓ Bet placed!{' '}
              <a href={`https://explorer.solana.com/tx/${txSig}`} target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'underline' }}>
                View tx ↗
              </a>
            </div>
          )}

          <div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.6, textAlign: 'center' }}>
            5% house fee · Min 0.0001 SOL · Mainnet
          </div>
        </>
      )}
    </div>
  );
}
