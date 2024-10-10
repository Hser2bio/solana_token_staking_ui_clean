import {
    PublicKey,
    LAMPORTS_PER_SOL,
    Connection,
    TransactionSignature,
} from "@solana/web3.js";
import * as anchor from "@project-serum/anchor";
import { SplTokenStaking } from "../type";

import { Buffer } from "buffer";

export const shortenAddress = (address: string) => {
    try {
        return address.slice(0, 4) + "..." + address.slice(-4);
    } catch (error) {
        console.error("shortenAddress => ", error);
        return "---";
    }
};

export const validateAddress = (address: string) => {
    window.Buffer = Buffer;
    try {
        let pubkey = new PublicKey(address);
        let isSolana = PublicKey.isOnCurve(pubkey.toBytes());
        return isSolana;
    } catch (error) {
        console.error("validateAddress => ", error);
        return false;
    }
};

const sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

export async function isBlockhashExpired(
    connection: Connection,
    initialBlockHeight: number
) {
    let currentBlockHeight = await connection.getBlockHeight();

    return currentBlockHeight > initialBlockHeight;
}

export const checkTransactionConfirmation = async (
    connection: Connection,
    signature: TransactionSignature
) => {
    const statusCheckInterval = 300;
    const timeout = 90000;
    let isBlockhashValid = true;

    const initialBlock = (await connection.getSignatureStatus(signature))
        .context.slot;

    let done = false;

    setTimeout(() => {
        if (done) {
            return;
        }
        done = true;
        console.log("Timed out for signature ", signature);
        console.log(
            `${
                isBlockhashValid
                    ? "Blockhash not yet expired."
                    : "Blockhash has expired."
            }`
        );
    }, timeout);

    while (!done && isBlockhashValid) {
        const confirmation = await connection.getSignatureStatus(signature);

        if (
            confirmation.value &&
            (confirmation.value.confirmationStatus === "confirmed" ||
                confirmation.value.confirmationStatus === "finalized")
        ) {
            console.log(
                `Confirmation Status: ${confirmation.value.confirmationStatus} `,
                signature
            );
            done = true;
        } else {
            console.log(
                `Confirmation Status: ${
                    confirmation.value?.confirmationStatus || "not yet found."
                }`
            );
        }
        isBlockhashValid = !(await isBlockhashExpired(
            connection,
            initialBlock
        ));
        await sleep(statusCheckInterval);
    }

    return done;
};

export const getNextUnusedStakeReceiptNonce = async (
    connection: anchor.web3.Connection,
    programId: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    stakePoolKey: anchor.web3.PublicKey
) => {
    const pageSize = 10;
    const maxIndex = 4_294_967_295;
    const maxPage = Math.ceil(maxIndex / pageSize);
    for (let page = 0; page <= maxPage; page++) {
        const startIndex = page * pageSize;
        const stakeReceiptKeys: anchor.web3.PublicKey[] = [];
        // derive keys for batch
        for (let i = startIndex; i < startIndex + pageSize; i++) {
            const [stakeReceiptKey] =
                anchor.web3.PublicKey.findProgramAddressSync(
                    [
                        owner.toBuffer(),
                        stakePoolKey.toBuffer(),
                        new anchor.BN(i).toArrayLike(Buffer, "le", 4),
                        Buffer.from("stakeDepositReceipt", "utf-8"),
                    ],
                    programId
                );
            stakeReceiptKeys.push(stakeReceiptKey);
        }
        // fetch page of AccountInfo for stake receipts
        const accounts = await connection.getMultipleAccountsInfo(
            stakeReceiptKeys
        );
        const indexWithinPage = accounts.findIndex((a) => !a);
        if (indexWithinPage > -1) {
            return startIndex + indexWithinPage;
        }
    }
    throw new Error("No more nonces available");
};

export const batchRequestStakeReceipts = async (
    program: anchor.Program,
    owner: anchor.web3.PublicKey,
    stakePoolKey: anchor.web3.PublicKey,
    pageSize = 50
) => {
    let decodedAccountBuffer: any[] = [];
    const maxIndex = 4_294_967_295; // U32 MAX
    const maxPage = Math.ceil(maxIndex / pageSize);
    for (let page = 0; page <= maxPage; page++) {
        const startIndex = page * pageSize;
        const stakeReceiptKeys: anchor.web3.PublicKey[] = [];
        // derive keys for batch
        for (let i = startIndex; i < startIndex + pageSize; i++) {
            const [stakeReceiptKey] =
                anchor.web3.PublicKey.findProgramAddressSync(
                    [
                        owner.toBuffer(),
                        stakePoolKey.toBuffer(),
                        new anchor.BN(i).toArrayLike(Buffer, "le", 4),
                        Buffer.from("stakeDepositReceipt", "utf-8"),
                    ],
                    program.programId
                );
            stakeReceiptKeys.push(stakeReceiptKey);
        }
        // fetch page of AccountInfo for stake receipts
        const accountInfos =
            await program.provider.connection.getMultipleAccountsInfo(
                stakeReceiptKeys
            );
        const validAccounts = accountInfos
            .map((a, index) =>
                a
                    ? {
                          address: stakeReceiptKeys[index],
                          ...a,
                      }
                    : null
            )
            .filter((a) => !!a) as (anchor.web3.AccountInfo<Buffer> & {
            address: anchor.web3.PublicKey;
        })[];
        const decodedAccounts = validAccounts.map((a) => ({
            address: a.address,
            ...program.coder.accounts.decode("StakeDepositReceipt", a.data),
        }));
        decodedAccountBuffer = [...decodedAccountBuffer, ...decodedAccounts];
        if (validAccounts.length === 0) {
            // if there is a full page of empty accounts, we can assume we've reached the last page of StakeDepositReceipts.
            return decodedAccountBuffer;
        }
    }
    return decodedAccountBuffer;
};

export const constants = {
    stakeToken: "C3R65zAxLrR3B1jJ1A5x4rA3vPCHPQj2KSQ6x9wcPkW",
    nonce: 1,
    rewardPoolIndex: 0,
    admin: "B4L4uRG8ocJfhSxby4UqEHgCTaNyjuUyDHuQCjeD4f4f",
};
