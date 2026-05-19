# 🍊 Orange Jackpot — Solana Casino

A provably fair, fruit-themed jackpot casino on Solana. Players buy slices of an orange with SOL — bigger bet = bigger slice = more chance to win. The jackpot spins when 2+ players have joined, picking a winner weighted by their slice size.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Phantom wallet browser extension

### Install & Run

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ Configuration (REQUIRED before launch)

### 1. Set your house wallet

Open `components/BetPanel.tsx` and replace:
```ts
const HOUSE_WALLET = 'YOUR_HOUSE_WALLET_ADDRESS_HERE';
```
With your actual Solana wallet address that will receive bets and pay out winners.

### 2. Switch from Devnet to Mainnet

In `pages/_app.tsx`, change:
```ts
const network = WalletAdapterNetwork.Devnet;
```
To:
```ts
const network = WalletAdapterNetwork.Mainnet;
```

And update the endpoint:
```ts
const endpoint = useMemo(() => clusterApiUrl(network), [network]);
// Or use a dedicated RPC: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

### 3. Implement proper escrow (PRODUCTION)

For production, you should implement a Solana program (smart contract) that:
1. Holds bets in escrow until the round ends
2. Verifies the VRF (Verifiable Random Function) randomness
3. Automatically pays out the winner on-chain

Currently the app uses a simplified model where SOL goes to the house wallet and payouts are done manually or via your backend logic.

### 4. Environment variables (optional)

Create a `.env.local` file:
```env
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
PORT=3000
```

---

## 🏗️ Architecture

```
solana-casino/
├── pages/
│   ├── _app.tsx          # Wallet provider setup
│   ├── _document.tsx     # HTML document
│   ├── index.tsx         # Main game page
│   └── api/
│       ├── socket.ts     # Socket.io initialization
│       ├── game-state.ts # REST: current game state
│       ├── user.ts       # REST: user accounts
│       └── chat.ts       # REST: chat history
├── components/
│   ├── OrangeWheel.tsx   # SVG pie chart jackpot wheel
│   ├── Chat.tsx          # Live chat sidebar
│   ├── PlayerList.tsx    # Active player slices list
│   ├── BetPanel.tsx      # Wallet + bet placement UI
│   ├── AccountPanel.tsx  # User profile + stats
│   ├── Countdown.tsx     # Round timer
│   └── WinnerOverlay.tsx # Winner announcement modal
├── lib/
│   ├── gameStore.ts      # In-memory game state engine
│   └── socketServer.ts   # Socket.io server + game logic
└── styles/
    └── globals.css       # Theme variables + animations
```

---

## 🎮 How the Game Works

1. **Join**: Player connects Phantom wallet
2. **Bet**: Player enters SOL amount and clicks "Buy Slice"
3. **Orange**: Their slice appears on the orange wheel proportional to their bet
4. **Countdown**: Once 2+ players have joined, a 30-second countdown starts
5. **More joins**: Anyone can add more SOL or new players can join during countdown
6. **Spin**: After countdown, the wheel spins for 5 seconds
7. **Winner**: A random number is drawn, weighted by each player's percentage
8. **Payout**: Winner receives 95% of the total pot (5% house fee)
9. **New round**: A fresh round starts automatically

---

## 💰 Economics

- **Minimum bet**: 0.01 SOL
- **House fee**: 5% of total pot
- **Unlimited players**: No cap on participants
- **Unlimited re-bets**: Players can add to their slice anytime before spin

---

## 🔒 Account System

- Accounts are wallet-based (no password needed)
- Display name can be set (up to 24 characters)
- Stats tracked: games played, total wagered, total won
- Persistent per wallet address

---

## 💬 Chat

- Real-time global chat via Socket.io
- Messages visible to all connected users
- 280 character limit per message
- History of last 200 messages

---

## 🛠️ Production Deployment

### Option 1: Vercel (Frontend) + Railway/Render (Backend)

Vercel doesn't support long-lived WebSocket connections well. Recommend deploying to:
- **Railway**: `railway up` — supports Node.js with WebSockets
- **Render**: Free tier supports WebSockets
- **DigitalOcean App Platform**: Full WebSocket support
- **VPS**: Deploy with PM2

### Option 2: Single VPS

```bash
# Build
npm run build

# Start with PM2
npm install -g pm2
pm2 start npm --name "orange-casino" -- start
pm2 save
pm2 startup
```

### Custom server for WebSockets

When deploying with `npm start`, Next.js uses its built-in server which supports WebSockets via Socket.io through the API route `/api/socket`.

---

## 📝 Legal Notes

- This is built for a licensed gambling operator
- Ensure compliance with your jurisdiction's online gambling laws
- Implement KYC/AML as required by your license
- Add responsible gambling tools (deposit limits, self-exclusion)
- The devnet configuration means NO REAL SOL is used by default

---

## 🔧 Customization

### Change countdown duration
In `lib/gameStore.ts`:
```ts
const COUNTDOWN_SECONDS = 30; // change this
```

### Change house fee
```ts
const HOUSE_FEE = 0.05; // 5% — change to desired rate
```

### Change minimum bet
```ts
const MIN_BET_LAMPORTS = 10_000_000; // 0.01 SOL
```

### Add more wallets (beyond Phantom)
In `pages/_app.tsx`, add wallet adapters from `@solana/wallet-adapter-wallets`.
