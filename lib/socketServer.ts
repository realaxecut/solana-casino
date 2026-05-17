import { Server as HTTPServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  getCurrentRound,
  getOrCreateActiveRound,
  placeBet,
  spinRound,
  endRound,
  addChatMessage,
  getChatHistory,
  getUser,
  upsertUser,
  COUNTDOWN_SECONDS,
} from './gameStore';

const RPC_URL = process.env.SERVER_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
let houseKeypair: Keypair | null = null;
let solanaConnection: Connection | null = null;

function initSolana() {
  const privKey = process.env.HOUSE_WALLET_PRIVATE_KEY;
  if (!privKey) {
    console.warn('[payout] HOUSE_WALLET_PRIVATE_KEY not set — payouts disabled');
    return;
  }
  try {
    const decoded = bs58.decode(privKey);
    houseKeypair = Keypair.fromSecretKey(decoded);
    solanaConnection = new Connection(RPC_URL, 'confirmed');
    console.log('[payout] House wallet loaded:', houseKeypair.publicKey.toBase58());
  } catch (e: any) {
    console.error('[payout] Failed to load house keypair:', e.message);
  }
}

async function sendPayout(winnerWallet: string, lamports: number): Promise<string | null> {
  if (!houseKeypair || !solanaConnection) {
    console.warn('[payout] Skipping payout — not configured');
    return null;
  }
  try {
    const toPubkey = new PublicKey(winnerWallet);
    const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash('confirmed');
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: houseKeypair.publicKey,
        toPubkey,
        lamports,
      })
    );
    tx.recentBlockhash = blockhash;
    tx.feePayer = houseKeypair.publicKey;
    tx.sign(houseKeypair);
    const sig = await solanaConnection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await solanaConnection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[payout] Sent ${lamports / LAMPORTS_PER_SOL} SOL to ${winnerWallet} — tx: ${sig}`);
    return sig;
  } catch (e: any) {
    console.error('[payout] Payout failed:', e.message);
    return null;
  }
}

let io: IOServer | null = null;
let spinTimer: NodeJS.Timeout | null = null;
let countdownTimer: NodeJS.Timeout | null = null;

export function getIO(): IOServer | null {
  return io;
}

export function initSocket(server: HTTPServer) {
  if (io) return io;
  initSolana();

  io = new IOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Ensure initial round exists
  getOrCreateActiveRound();

  io.on('connection', (socket: Socket) => {
    // Send current state
    const round = getCurrentRound() || getOrCreateActiveRound();
    socket.emit('round_update', round);
    socket.emit('chat_history', getChatHistory(50));

    socket.on('get_state', () => {
      const r = getCurrentRound() || getOrCreateActiveRound();
      socket.emit('round_update', r);
    });

    socket.on('place_bet', (data: { wallet: string; displayName: string; amountLamports: number }) => {
      const { wallet, displayName, amountLamports } = data;
      if (!wallet || !amountLamports) return;

      const result = placeBet(wallet, displayName, amountLamports);
      if (!result.success) {
        socket.emit('bet_error', result.error);
        return;
      }

      const round = result.round!;
      io!.emit('round_update', round);

      // If round just became active (2 players), start countdown
      if (round.status === 'active' && round.players.length === 2) {
        startCountdown(round.id);
      }
    });

    socket.on('send_chat', (data: { wallet: string; displayName: string; message: string }) => {
      const { wallet, displayName, message } = data;
      if (!wallet || !message?.trim()) return;
      const msg = addChatMessage(wallet, displayName, message.trim());
      io!.emit('chat_message', msg);
    });

    socket.on('register_user', (data: { wallet: string; displayName: string }) => {
      const { wallet, displayName } = data;
      if (!wallet) return;
      const user = upsertUser(wallet, displayName || shortenWallet(wallet));
      socket.emit('user_registered', user);
    });

    socket.on('get_user', (wallet: string) => {
      const user = getUser(wallet);
      socket.emit('user_data', user);
    });
  });

  return io;
}

function startCountdown(roundId: string) {
  if (countdownTimer) clearTimeout(countdownTimer);
  if (spinTimer) clearTimeout(spinTimer);

  countdownTimer = setTimeout(() => {
    triggerSpin(roundId);
  }, COUNTDOWN_SECONDS * 1000);
}

function triggerSpin(roundId: string) {
  const round = spinRound(roundId);
  if (!round) return;

  io!.emit('round_update', round);
  io!.emit('spin_started', { roundId });

  // After 5s of spin animation, pay out winner and announce
  spinTimer = setTimeout(async () => {
    let payoutTx: string | null = null;
    if (round.winnerWallet && round.winnerShare > 0) {
      payoutTx = await sendPayout(round.winnerWallet, round.winnerShare);
      if (!payoutTx) {
        console.error('[payout] Payout failed for winner', round.winnerWallet, '— win was already recorded in spinRound');
      }
    }

    io!.emit('winner_announced', {
      roundId: round.id,
      winnerWallet: round.winnerWallet,
      winnerDisplayName: round.winnerDisplayName,
      winnerShare: round.winnerShare,
      totalPot: round.totalPot,
      payoutTx,
    });

    // End round after 8s
    setTimeout(() => {
      endRound(roundId);
      const newRound = getCurrentRound() || getOrCreateActiveRound();
      io!.emit('round_update', newRound);
      io!.emit('new_round', { roundId: newRound.id });
    }, 8000);
  }, 5000);
}

function shortenWallet(wallet: string): string {
  return wallet.slice(0, 4) + '...' + wallet.slice(-4);
}
