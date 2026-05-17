const { Server } = require('socket.io');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const bs58 = require('bs58');
const {
  getOrCreateActiveRound,
  getCurrentRound,
  placeBet,
  spinRound,
  endRound,
  upsertUser,
  changeUsername,
  isUsernameTaken,
  addChatMessage,
  getChatHistory,
  getRecentRounds,
  setAvatar,
  getAvatar,
  getUser,
} = require('./gameStore.js');
const { getLevel, LEVELS } = require('./levels.js');

const SPIN_DURATION_MS = 6000;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';

let houseKeypair = null;
let solanaConnection = null;

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
  } catch (e) {
    console.error('[payout] Failed to load house keypair:', e.message);
  }
}

async function sendPayout(winnerWallet, lamports) {
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
  } catch (e) {
    console.error('[payout] Payout failed:', e.message);
    return null;
  }
}

let countdownTimeout = null;

function broadcastRound(io, round) {
  io.emit('round_update', round);
}

function startCountdown(io) {
  if (countdownTimeout) { clearTimeout(countdownTimeout); countdownTimeout = null; }
  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;
  const msLeft = round.countdownEndsAt - Date.now();
  countdownTimeout = setTimeout(() => triggerSpin(io), Math.max(0, msLeft));
}

async function triggerSpin(io) {
  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;

  const spun = spinRound(round.id);
  if (!spun) return;

  io.emit('spin_started');
  broadcastRound(io, spun);

  setTimeout(async () => {
    // Send payout to winner
    let payoutTx = null;
    if (spun.winnerWallet && spun.winnerShare > 0) {
      payoutTx = await sendPayout(spun.winnerWallet, spun.winnerShare);
    }

    io.emit('winner_announced', {
      winnerWallet: spun.winnerWallet,
      winnerDisplayName: spun.winnerDisplayName,
      winnerShare: spun.winnerShare,
      totalPot: spun.totalPot,
      payoutTx,
    });

    setTimeout(() => {
      endRound(spun.id);
      io.emit('recent_rounds', getRecentRounds());
      const newRound = getOrCreateActiveRound();
      io.emit('new_round');
      broadcastRound(io, newRound);
    }, 5000);
  }, SPIN_DURATION_MS);
}

function initSocketServer(httpServer) {
  initSolana();

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    const round = getOrCreateActiveRound();
    socket.emit('round_update', round);
    socket.emit('chat_history', getChatHistory(50));
    socket.emit('recent_rounds', getRecentRounds());

    socket.on('get_state', () => {
      const r = getOrCreateActiveRound();
      socket.emit('round_update', r);
      socket.emit('chat_history', getChatHistory(50));
      socket.emit('recent_rounds', getRecentRounds());
    });

    socket.on('get_chat_history', () => {
      socket.emit('chat_history', getChatHistory(50));
    });

    socket.on('register_user', ({ wallet, displayName }) => {
      if (!wallet) return;
      upsertUser(wallet, displayName || wallet.slice(0, 8));
    });

    socket.on('check_username', ({ name, wallet }) => {
      const trimmed = (name || '').trim();
      if (!trimmed || trimmed.length < 2) { socket.emit('username_check_result', { available: false, error: 'Too short' }); return; }
      if (trimmed.length > 20) { socket.emit('username_check_result', { available: false, error: 'Too long' }); return; }
      if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) { socket.emit('username_check_result', { available: false, error: 'Invalid characters' }); return; }
      const taken = isUsernameTaken(trimmed, wallet || null);
      socket.emit('username_check_result', { available: !taken, error: taken ? 'Username already taken' : null });
    });

    socket.on('change_username', ({ wallet, newName }) => {
      if (!wallet) { socket.emit('username_change_result', { success: false, error: 'No wallet' }); return; }
      const result = changeUsername(wallet, newName);
      socket.emit('username_change_result', result);
      if (result.success) {
        io.emit('username_changed', { wallet, newName: result.user.displayName });
      }
    });

    socket.on('get_profile', ({ wallet }) => {
      if (!wallet) return;
      const user = getUser(wallet);
      if (!user) return;
      socket.emit('profile_data', user);
    });

    socket.on('set_avatar', ({ wallet, avatarDataUrl }) => {
      if (!wallet) return;
      const result = setAvatar(wallet, avatarDataUrl);
      if (result?.error) { socket.emit('avatar_result', { success: false, error: result.error }); return; }
      socket.emit('avatar_result', { success: true });
      io.emit('avatar_updated', { wallet, avatar: avatarDataUrl });
    });

    socket.on('place_bet', ({ wallet, displayName, amountLamports }) => {
      if (!wallet || !amountLamports) return;
      const result = placeBet(wallet, displayName, amountLamports);
      if (!result.success) { socket.emit('bet_error', { error: result.error }); return; }
      broadcastRound(io, result.round);
      if (result.round.status === 'active' && result.round.players.length === 2) {
        startCountdown(io);
      }
    });

    socket.on('send_chat', ({ wallet, displayName, message }) => {
      if (!wallet || !message?.trim()) return;
      const msg = addChatMessage(wallet, displayName, message.trim());
      if (msg?.error === 'cooldown') {
        socket.emit('chat_cooldown', { msLeft: msg.msLeft });
        return;
      }
      io.emit('chat_message', msg);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

module.exports = { initSocket: initSocketServer };
