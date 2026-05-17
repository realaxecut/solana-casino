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
const RPC_URL = process.env.SERVER_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function verifyBetTransaction(txSignature, expectedSender, expectedReceiver, expectedLamports) {
  if (!solanaConnection) {
    console.error('[verify] No solana connection — cannot verify tx');
    return false;
  }
  // Retry up to 5 times with 2s delay — devnet can be slow to propagate
  let tx = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      tx = await solanaConnection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (tx) break;
      console.log(`[verify] Attempt ${attempt}: tx not found yet, retrying in 2s...`);
      await sleep(2000);
    } catch (e) {
      console.error(`[verify] Attempt ${attempt} error:`, e.message);
      await sleep(2000);
    }
  }
  if (!tx) {
    console.warn('[verify] Transaction never found on-chain:', txSignature);
    return false;
  }
  if (tx.meta?.err) {
    console.warn('[verify] Transaction failed on-chain:', txSignature, tx.meta.err);
    return false;
  }
  // Check sender and receiver
  const accounts = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
  if (!accounts || accounts.length < 2) {
    console.warn('[verify] Unexpected account layout in tx:', txSignature);
    return false;
  }
  const senderKey = accounts[0].toBase58();
  const receiverKey = accounts[1].toBase58();
  if (senderKey !== expectedSender) {
    console.warn('[verify] Sender mismatch:', senderKey, '!==', expectedSender);
    return false;
  }
  if (receiverKey !== expectedReceiver) {
    console.warn('[verify] Receiver mismatch:', receiverKey, '!==', expectedReceiver);
    return false;
  }
  // Verify receiver balance actually increased by at least the claimed amount
  const receiverDelta = tx.meta.postBalances[1] - tx.meta.preBalances[1];
  if (receiverDelta < expectedLamports) {
    console.warn('[verify] Amount mismatch: expected', expectedLamports, 'got delta', receiverDelta);
    return false;
  }
  console.log(`[verify] ✓ Verified ${expectedLamports} lamports from ${expectedSender} — tx: ${txSignature}`);
  return true;
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

function broadcastPlayerCount(io) {
  io.emit('player_count', io.engine.clientsCount);
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
    broadcastPlayerCount(io);

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

    socket.on('place_bet', async ({ wallet, displayName, amountLamports, txSignature }) => {
      if (!wallet || !amountLamports) return;

      // Hard reject if no tx signature provided
      if (!txSignature) {
        console.warn('[bet] Rejected bet with no txSignature from', wallet);
        socket.emit('bet_error', { error: 'No transaction signature provided' });
        return;
      }

      // Hard reject if house wallet not configured
      const HOUSE = process.env.NEXT_PUBLIC_HOUSE_WALLET;
      if (!HOUSE) {
        console.error('[bet] NEXT_PUBLIC_HOUSE_WALLET not set — rejecting all bets');
        socket.emit('bet_error', { error: 'Casino not configured correctly' });
        return;
      }

      // Verify on-chain before crediting anything
      const valid = await verifyBetTransaction(txSignature, wallet, HOUSE, amountLamports);
      if (!valid) {
        console.warn('[bet] Rejected unverified bet from', wallet, 'tx:', txSignature);
        socket.emit('bet_error', { error: 'Transaction could not be verified on-chain — your SOL was not added to the pot. If it confirmed, please contact support with your tx signature.' });
        return;
      }

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
      broadcastPlayerCount(io);
    });
  });

  return io;
}

module.exports = { initSocket: initSocketServer };
