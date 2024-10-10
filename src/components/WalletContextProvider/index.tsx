import React, { useMemo } from "react";
import {
    ConnectionProvider,
    WalletProvider,
} from "@solana/wallet-adapter-react";
import {
    PhantomWalletAdapter,
    SolflareWalletAdapter,
    SolletExtensionWalletAdapter,
    SolletWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { SolanaNetworkType } from "../../App";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function WalletContextProvider({
    children,
    solanaNetwork,
}: {
    children: React.ReactNode;
    solanaNetwork: SolanaNetworkType;
}) {
    // const endpoint = useMemo(
    //     () => clusterApiUrl(solanaNetwork),
    //     [solanaNetwork]
    // );
    const endpoint =
        "https://young-capable-energy.solana-mainnet.quiknode.pro/cfa2d247b256f715b686dd61c92248b784dbdfc3";

    const wallets = useMemo(
        () => [
            new PhantomWalletAdapter(),
            new SolflareWalletAdapter(),
            new SolletExtensionWalletAdapter(),
            new SolletWalletAdapter(),
        ],
        [solanaNetwork]
    );

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
