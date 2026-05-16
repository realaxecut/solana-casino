import type { AppProps } from 'next/app';
import { useMemo, useState, useEffect } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '../styles/globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function App({ Component, pageProps }: AppProps) {
  const [mounted, setMounted] = useState(false);
  const endpoint = 'https://devnet.helius-rpc.com/?api-key=a67bbeed-b40f-4a5c-b95f-ceebba4323d7';
  const wallets = useMemo(() => [], []);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <Component {...pageProps} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
