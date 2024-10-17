import { useEffect, useState } from "react";
import {
    Transaction,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import { Program, AnchorProvider } from "@project-serum/anchor";
import { Idl } from "@project-serum/anchor/dist/cjs/idl";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { successToast, errorToast, loadingToast } from "../Notification";
import { SolanaNetworkType } from "../../App";
import * as anchor from "@project-serum/anchor";
import {
    checkTransactionConfirmation,
    constants,
    getNextUnusedStakeReceiptNonce,
    batchRequestStakeReceipts,
} from "../../utils/general";
import idl from "../../utils/idl.json";
import tokenLockIdl from "../../utils/token_lock_idl.json";
import { token } from "@project-serum/anchor/dist/cjs/utils";

interface MainProps {
    solanaNetwork: SolanaNetworkType;
}

interface StakeData {
    totalStakedAmount: number;
    totalRewardAmount: number;
    // reward_rate: number;
    lockPeriod: number;
    // total_amount: number;
    // lock_amount: number;
    // admin: PublicKey;
}

const programID = new PublicKey(idl.metadata.address);
const tokenLockProgramId = new PublicKey(tokenLockIdl.metadata.address);
const stakeToken = new PublicKey(constants.stakeToken);
const { nonce, rewardPoolIndex, admin } = constants;
const formatter = new Intl.DateTimeFormat("en-US", {
    year: "2-digit",
    month: "2-digit",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    // second: "2-digit",
});

export default function MainApp({ solanaNetwork }: MainProps) {
    const { connection } = useConnection();
    const { publicKey, wallet, signTransaction, signAllTransactions } =
        useWallet();

    const [isBusy, setIsBusy] = useState(false);
    const [currentTokenAmount, setCurrentTokenAmount] = useState(0);
    const [userData, setUserData] = useState<any[]>([]);
    const [stakeData, setStakeData] = useState<StakeData>({
        lockPeriod: 0,
        totalStakedAmount: 0,
        totalRewardAmount: 0,
    });
    const [refreshCount, setRefreshCount] = useState<number>(0);
    const [stakingAmount, setStakingAmount] = useState<number | string>("");
    const [transactionSignature, setTransactionSignature] = useState<{
        message: string;
        link: string;
    } | null>(null);
    const [selectedStakeReceiptAddress, setSelectedStakeReceiptAddress] =
        useState<PublicKey>(PublicKey.default);

    const getProvider = () => {
        if (!wallet || !publicKey || !signTransaction || !signAllTransactions) {
            return;
        }
        const signerWallet = {
            publicKey: publicKey,
            signTransaction: signTransaction,
            signAllTransactions: signAllTransactions,
        };

        const provider = new AnchorProvider(connection, signerWallet, {
            preflightCommitment: "recent",
        });

        return provider;
    };

    const fetchStakeData = async () => {
        const provider = getProvider();
        if (!provider) return;
        const program = new Program(idl as Idl, programID, provider);
        const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
                stakeToken.toBuffer(),
                new PublicKey(admin).toBuffer(),
                Buffer.from("stakePool", "utf-8"),
            ],
            program.programId
        );
        const [rewardVaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                stakePoolKey.toBuffer(),
                stakeToken.toBuffer(), // reward token is the same as stake token
                Buffer.from("rewardVault", "utf-8"),
            ],
            program.programId
        );

        const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
            [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
            program.programId
        );
        console.log(rewardVaultKey.toString(), vaultKey.toString());
        try {
            const stakeTokenInfo =
                await provider.connection.getTokenAccountBalance(vaultKey);

            const rewardTokenInfo =
                await provider.connection.getTokenAccountBalance(
                    rewardVaultKey
                );
            console.log({ stakeTokenInfo, rewardTokenInfo });
            const data = await program.account.stakePool.fetch(stakePoolKey);
            console.log(Number(data.minDuration));

            const adminDepositTokenAccount = await getAssociatedTokenAddress(
                stakeToken,
                new PublicKey(admin),
                true,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );
            const lockWalletBalance = await connection.getTokenAccountBalance(
                adminDepositTokenAccount
            );

            console.log(lockWalletBalance.value.uiAmount);
            if (data) {
                setStakeData({
                    lockPeriod: Number(data.minDuration),
                    totalStakedAmount: Number(stakeTokenInfo.value.uiAmount),
                    totalRewardAmount: Number(rewardTokenInfo.value.uiAmount),
                });
            }
        } catch (err) {
            console.log(err);
        }
    };

    const fetchUserData = async () => {
        const provider = getProvider();
        if (!publicKey || !provider) return;
        const stakerDepositTokenAccount = await getAssociatedTokenAddress(
            stakeToken,
            publicKey,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const program = new Program(idl as Idl, programID, provider);

        const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
                stakeToken.toBuffer(),
                new PublicKey(admin).toBuffer(),
                Buffer.from("stakePool", "utf-8"),
            ],
            program.programId
        );

        try {
            const stakeInfo = await batchRequestStakeReceipts(
                program,
                publicKey,
                stakePoolKey,
                10
            );
            console.log(stakeInfo);
            setUserData(stakeInfo);
        } catch (err) {
            console.log(err);
        }

        try {
            const tokenInfo = await provider.connection.getTokenAccountBalance(
                stakerDepositTokenAccount
            );

            setCurrentTokenAmount(tokenInfo.value.uiAmount || 0);
        } catch (err) {
            console.log("err occurred", err);
        }
    };

    useEffect(() => {
        fetchStakeData();
        fetchUserData();
    }, [publicKey]);

    useEffect(() => {
        if (transactionSignature) {
            setTimeout(() => {
                setTransactionSignature(null);
            }, 15000);
        }
    }, [transactionSignature]);

    const resetInputs = () => {
        setStakingAmount("");
    };

    const handleRefresh = () => {
        resetInputs();
        setRefreshCount((prevState) => prevState + 1);
    };

    // function to handle button click
    const stakeTokenHandler = async () => {
        try {
            if (!publicKey) {
                errorToast("No wallet connected!");
                return;
            }

            if (!stakingAmount) {
                errorToast("No staking amount entered!");
                return;
            }

            if (Number(stakingAmount) <= 0) {
                errorToast("Invalid amount! Should be greater than 0");
                return;
            }
            setIsBusy(true);
            const provider = getProvider(); //checks & verify the dapp it can able to connect solana network
            if (!provider || !publicKey || !signTransaction) return;

            const program = new Program(idl as Idl, programID, provider);

            const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
                [
                    new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
                    stakeToken.toBuffer(),
                    new PublicKey(admin).toBuffer(),
                    Buffer.from("stakePool", "utf-8"),
                ],
                program.programId
            );
            const [rewardVaultKey] =
                anchor.web3.PublicKey.findProgramAddressSync(
                    [
                        stakePoolKey.toBuffer(),
                        stakeToken.toBuffer(), // reward token is the same as stake token
                        Buffer.from("rewardVault", "utf-8"),
                    ],
                    program.programId
                );
            const nextNonce = await getNextUnusedStakeReceiptNonce(
                program.provider.connection,
                program.programId,
                publicKey,
                stakePoolKey
            );

            console.log({ nextNonce });

            const [stakeReceiptKey] =
                anchor.web3.PublicKey.findProgramAddressSync(
                    [
                        provider.publicKey.toBuffer(),
                        stakePoolKey.toBuffer(),
                        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
                        Buffer.from("stakeDepositReceipt", "utf-8"),
                    ],
                    program.programId
                );

            const mintToBeStakedAccount = getAssociatedTokenAddressSync(
                stakeToken,
                provider.publicKey,
                false,
                TOKEN_PROGRAM_ID
            );

            const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
                [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
                program.programId
            );

            const [stakeMint] = anchor.web3.PublicKey.findProgramAddressSync(
                [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
                program.programId
            );

            const stakeMintAccountKey = getAssociatedTokenAddressSync(
                stakeMint,
                provider.publicKey,
                false,
                TOKEN_PROGRAM_ID
            );

            let transaction = new Transaction();

            try {
                await provider.connection.getTokenAccountBalance(
                    stakeMintAccountKey
                );
            } catch (err) {
                console.log("here");
                const createStakeMintAccountIx =
                    createAssociatedTokenAccountInstruction(
                        provider.publicKey,
                        stakeMintAccountKey,
                        provider.publicKey,
                        stakeMint,
                        TOKEN_PROGRAM_ID
                    );
                transaction.add(createStakeMintAccountIx);
            }

            loadingToast(`Staking ${stakingAmount} Tokens`);

            const tokenLockProgram = new Program(
                tokenLockIdl as Idl,
                tokenLockProgramId,
                provider
            );

            const adminKey = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("state"), Buffer.from("admin")],
                tokenLockProgramId
            )[0];

            const vault = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("vault"), stakeToken.toBuffer()],
                tokenLockProgramId
            )[0];

            const tokenSendTx = tokenLockProgram.transaction.sendToken({
                accounts: {
                    user: publicKey,
                    adminState: adminKey,
                    tokenMint: stakeToken,
                    tokenRecipient: rewardVaultKey,
                    vault,
                    tokenProgram: TOKEN_PROGRAM_ID,
                },
            });

            const tx = program.transaction.deposit(
                new anchor.BN(Number(nextNonce)),
                new anchor.BN(Number(stakingAmount) * 100000000),
                new anchor.BN(Number(stakeData.lockPeriod)),
                {
                    accounts: {
                        payer: publicKey,
                        owner: publicKey,
                        from: mintToBeStakedAccount,
                        stakePool: stakePoolKey,
                        vault: vaultKey,
                        stakeMint,
                        destination: stakeMintAccountKey,
                        stakeDepositReceipt: stakeReceiptKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                        systemProgram: anchor.web3.SystemProgram.programId,
                    },
                    remainingAccounts: [
                        {
                            pubkey: rewardVaultKey,
                            isWritable: false,
                            isSigner: false,
                        },
                    ],
                }
            );

            transaction.add(tokenSendTx);
            transaction.add(tx);
            transaction.feePayer = provider.wallet.publicKey;
            transaction.recentBlockhash = (
                await connection.getLatestBlockhash("confirmed")
            ).blockhash;
            const signedTx = await provider.wallet.signTransaction(transaction);
            const txId = await connection.sendRawTransaction(
                signedTx.serialize()
            );
            // const isConfirmed = await checkTransactionConfirmation(
            //     connection,
            //     txId
            // );
            const isConfirmed = true;

            if (isConfirmed) {
                successToast(`Staked ${stakingAmount} Token successfully!`);
            } else {
                errorToast(
                    `Couldn't confirm transaction! Please check on Solana Explorer`
                );
            }

            console.log(txId);
            // setTransactionSignature({
            //     link: `https://explorer.solana.com/tx/${txId}?cluster=${solanaNetwork}`,
            //     message: `You can view your transaction on the Solana Explorer at:\n`,
            // });
            fetchUserData();
            fetchStakeData();
            setIsBusy(false);
            handleRefresh();
        } catch (error) {
            setIsBusy(false);
            handleRefresh();
            errorToast("Something went wrong while sending Tokens!");
            console.error("solSendHandler => ", error);
        }
    };

    const getRewardHandler = async () => {
        try {
            if (!publicKey) {
                errorToast("No wallet connected!");
                return;
            }
            if (selectedStakeReceiptAddress === PublicKey.default) {
                errorToast("No stakePool selected!");
                return;
            }
            setIsBusy(true);
            const provider = getProvider(); //checks & verify the dapp it can able to connect solana network
            if (!provider || !publicKey || !signTransaction) return;
            const program = new Program(idl as Idl, programID, provider);

            const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
                [
                    new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
                    stakeToken.toBuffer(),
                    new PublicKey(admin).toBuffer(),
                    Buffer.from("stakePool", "utf-8"),
                ],
                program.programId
            );

            const stakeReceiptKey = selectedStakeReceiptAddress;

            // const [stakeReceiptKey] =
            //     anchor.web3.PublicKey.findProgramAddressSync(
            //         [
            //             publicKey.toBuffer(),
            //             stakePoolKey.toBuffer(),
            //             new anchor.BN(0).toArrayLike(Buffer, "le", 4),
            //             Buffer.from("stakeDepositReceipt", "utf-8"),
            //         ],
            //         program.programId
            //     );
            // console.log("stakeReceiptKey", stakeReceiptKey.toBase58());

            const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
                [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
                program.programId
            );
            const [stakeMint] = anchor.web3.PublicKey.findProgramAddressSync(
                [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
                program.programId
            );
            const [rewardVaultKey] =
                anchor.web3.PublicKey.findProgramAddressSync(
                    [
                        stakePoolKey.toBuffer(),
                        stakeToken.toBuffer(),
                        Buffer.from("rewardVault", "utf-8"),
                    ],
                    program.programId
                );

            const depositorReward1AccountKey = getAssociatedTokenAddressSync(
                stakeToken,
                publicKey
            );

            const tokenLockProgram = new Program(
                tokenLockIdl as Idl,
                tokenLockProgramId,
                provider
            );

            const adminKey = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("state"), Buffer.from("admin")],
                tokenLockProgramId
            )[0];

            const vault = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("vault"), stakeToken.toBuffer()],
                tokenLockProgramId
            )[0];

            const tokenSendTx = tokenLockProgram.transaction.sendToken({
                accounts: {
                    user: publicKey,
                    adminState: adminKey,
                    tokenMint: stakeToken,
                    tokenRecipient: rewardVaultKey,
                    vault,
                    tokenProgram: TOKEN_PROGRAM_ID,
                },
            });
            loadingToast(`Getting Rewards`);
            const tx = program.transaction.claimAll({
                accounts: {
                    claimBase: {
                        owner: publicKey,
                        stakePool: stakePoolKey,
                        stakeDepositReceipt: stakeReceiptKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    },
                },
                remainingAccounts: [
                    {
                        pubkey: rewardVaultKey,
                        isWritable: true,
                        isSigner: false,
                    },
                    {
                        pubkey: depositorReward1AccountKey,
                        isWritable: true,
                        isSigner: false,
                    },
                ],
            });

            const transaction = new Transaction();
            transaction.add(tokenSendTx);
            transaction.add(tx);
            transaction.feePayer = provider.wallet.publicKey;
            transaction.recentBlockhash = (
                await connection.getLatestBlockhash("confirmed")
            ).blockhash;
            const signedTx = await provider.wallet.signTransaction(transaction);
            const txId = await connection.sendRawTransaction(
                signedTx.serialize()
            );
            // const isConfirmed = await checkTransactionConfirmation(
            //     connection,
            //     txId
            // );
            const isConfirmed = true;
            if (isConfirmed) {
                successToast(`Get Reward Tokens successfully!`);
            } else {
                errorToast(
                    `Couldn't confirm transaction! Please check on Solana Explorer`
                );
            }
            // setTransactionSignature({
            //     link: `https://explorer.solana.com/tx/${txId}?cluster=${solanaNetwork}`,
            //     message: `You can view your transaction on the Solana Explorer at:\n`,
            // });
            console.log(txId);
            fetchUserData();
            fetchStakeData();
            setIsBusy(false);
            handleRefresh();
        } catch (error) {
            setIsBusy(false);
            handleRefresh();
            errorToast("Something went wrong while sending Tokens!");
            console.error("solSendHandler => ", error);
        }
    };

    const unStakeHandler = async () => {
        try {
            if (!publicKey) {
                errorToast("No wallet connected!");
                return;
            }
            if (selectedStakeReceiptAddress === PublicKey.default) {
                errorToast("No stakePool selected!");
                return;
            }
            setIsBusy(true);
            const provider = getProvider(); //checks & verify the dapp it can able to connect solana network
            if (!provider || !publicKey || !signTransaction) return;
            const program = new Program(idl as Idl, programID, provider);

            const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
                [
                    new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
                    stakeToken.toBuffer(),
                    new PublicKey(admin).toBuffer(),
                    Buffer.from("stakePool", "utf-8"),
                ],
                program.programId
            );

            const stakeReceiptKey = selectedStakeReceiptAddress;

            // const [stakeReceiptKey] =
            //     anchor.web3.PublicKey.findProgramAddressSync(
            //         [
            //             publicKey.toBuffer(),
            //             stakePoolKey.toBuffer(),
            //             // need to update this - hard coded - nonce
            //             new anchor.BN(0).toArrayLike(Buffer, "le", 4),
            //             Buffer.from("stakeDepositReceipt", "utf-8"),
            //         ],
            //         program.programId
            //     );

            const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
                [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
                program.programId
            );
            const [stakeMint] = anchor.web3.PublicKey.findProgramAddressSync(
                [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
                program.programId
            );
            const [rewardVaultKey] =
                anchor.web3.PublicKey.findProgramAddressSync(
                    [
                        stakePoolKey.toBuffer(),
                        stakeToken.toBuffer(),
                        Buffer.from("rewardVault", "utf-8"),
                    ],
                    program.programId
                );

            const mintToBeStakedAccountKey = getAssociatedTokenAddressSync(
                stakeToken,
                publicKey
            );
            const stakeMintAccountKey = getAssociatedTokenAddressSync(
                stakeMint,
                publicKey
            );
            const depositorReward1AccountKey = getAssociatedTokenAddressSync(
                stakeToken,
                publicKey
            );

            const tokenLockProgram = new Program(
                tokenLockIdl as Idl,
                tokenLockProgramId,
                provider
            );

            const adminKey = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("state"), Buffer.from("admin")],
                tokenLockProgramId
            )[0];

            const vault = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("vault"), stakeToken.toBuffer()],
                tokenLockProgramId
            )[0];

            const tokenSendTx = tokenLockProgram.transaction.sendToken({
                accounts: {
                    user: publicKey,
                    adminState: adminKey,
                    tokenMint: stakeToken,
                    tokenRecipient: rewardVaultKey,
                    vault,
                    tokenProgram: TOKEN_PROGRAM_ID,
                },
            });

            loadingToast(`Getting Rewards`);
            const tx = program.transaction.withdraw({
                accounts: {
                    claimBase: {
                        owner: publicKey,
                        stakePool: stakePoolKey,
                        stakeDepositReceipt: stakeReceiptKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    },
                    vault: vaultKey,
                    stakeMint,
                    from: stakeMintAccountKey,
                    destination: mintToBeStakedAccountKey,
                },
                remainingAccounts: [
                    {
                        pubkey: rewardVaultKey,
                        isWritable: true,
                        isSigner: false,
                    },
                    {
                        pubkey: depositorReward1AccountKey,
                        isWritable: true,
                        isSigner: false,
                    },
                ],
            });

            const transaction = new Transaction();
            transaction.add(tokenSendTx);
            transaction.add(tx);
            transaction.feePayer = provider.wallet.publicKey;
            transaction.recentBlockhash = (
                await connection.getLatestBlockhash("confirmed")
            ).blockhash;
            const signedTx = await provider.wallet.signTransaction(transaction);
            const txId = await connection.sendRawTransaction(
                signedTx.serialize()
            );
            // const isConfirmed = await checkTransactionConfirmation(
            //     connection,
            //     txId
            // );
            const isConfirmed = true;

            if (isConfirmed) {
                successToast(`Get Reward Tokens successfully!`);
            } else {
                errorToast(
                    `Couldn't confirm transaction! Please check on Solana Explorer`
                );
            }

            console.log(txId);
            fetchUserData();
            fetchStakeData();
            setIsBusy(false);
            handleRefresh();
        } catch (error) {
            setIsBusy(false);
            handleRefresh();
            errorToast("Something went wrong while unstaking Tokens!");
            console.error("solSendHandler => ", error);
        }
    };

    useEffect(() => {
        console.log(stakeData.lockPeriod);
    });

    return (
        <main className="main flex justify-center">
            <div className="2xl:w-[80vw] w-[96vw]">
                <h1 className="heading-1 my-4 sm:px-4 text-4xl text-center">
                    Welcome to Sammy Stake Platform!
                </h1>
                <h2 className="heading-1 my-4 sm:px-3 text-xl text-center">
                    Our Plataform will give one billion as rewards to stakers in one year.
                    <br /> Let's enjoy and get passive Income.
                </h2>
                {publicKey ? (
                    <div className="mt-4">
                        <div className="grid 2xl:grid-cols-2 grid-cols-1 2xl:h-[35vh] justify-items-center">
                            <div className="cursor-pointer text-white px-8 py-8 bg-[#1f2937] text-lg rounded-3xl border-[1px] border-[#ffffff66] text-[24px] flex flex-col justify-evenly w-[400px] md:w-[600px] md:h-[300px] h-[240px]">
                                <div className="flex justify-between">
                                    <span>Total Staked Amount: </span>
                                    <span>
                                        {parseFloat(
                                            (stakeData?.totalStakedAmount).toFixed(
                                                3
                                            )
                                        )}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Reward (for all users): </span>
                                    <span>
                                        {
                                            // parseFloat(
                                            //     (stakeData?.totalRewardAmount).toFixed(
                                            //         3
                                            //     )
                                            // )
                                        }
                                        31/s
                                        {
                                            // calculated by 100000 / 365 / 24 / 3600
                                        }
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Lock Period: </span>
                                    <span>180 days</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-semibold">
                                        Stakable Amounts:
                                    </span>
                                    <span>
                                        {parseFloat(
                                            currentTokenAmount.toFixed(3)
                                        )}
                                    </span>
                                </div>
                            </div>
                            <div className="2xl:mt-0 mt-4 grid md:grid-cols-2 p-2 gap-0 font-semibold overflow-auto items-center justify-items-center border-[1px] border-[#ffffff66] rounded-3xl w-[400px] md:w-[600px] 2xl:h-[300px]">
                                {userData?.length &&
                                    userData?.map((stakeDetail, idx) => {
                                        return (
                                            <div
                                                key={idx}
                                                style={
                                                    selectedStakeReceiptAddress
                                                        .toString()
                                                        .toLocaleLowerCase() ==
                                                    stakeDetail.address
                                                        .toString()
                                                        .toLocaleLowerCase()
                                                        ? {
                                                              background:
                                                                  "#1f2937ff",
                                                          }
                                                        : {
                                                              background:
                                                                  "#1f293766",
                                                          }
                                                }
                                                className="cursor-pointer text-white mb-4 px-4 py-4 rounded-3xl border-[1px] border-[#ffffff66] h-32 md:w-[280px] w-[380px] text-[14px] flex flex-col justify-center"
                                                onClick={() => {
                                                    setSelectedStakeReceiptAddress(
                                                        stakeDetail.address
                                                    );
                                                }}
                                            >
                                                <div className="flex justify-between">
                                                    <span className="font-semibold text-green-400">
                                                        Staked Amounts:
                                                    </span>{" "}
                                                    {Number(
                                                        stakeDetail?.depositAmount
                                                    ) / 1e8}
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-green-400">
                                                        Staked Date:
                                                    </span>
                                                    {stakeDetail?.depositTimestamp &&
                                                        formatter.format(
                                                            new Date(
                                                                stakeDetail?.depositTimestamp *
                                                                    1000
                                                            )
                                                        )}
                                                    <br />
                                                </div>
                                                {/* Current Reward:{" "} */}
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                        <div className="flex flex-col flex-wrap my-8 gap-4 w-[420px] mx-auto">
                            <div className="flex items-center justify-between w-[420px]">
                                <input
                                    className="w-[100px] h-10 px-4 rounded-md"
                                    type="number"
                                    placeholder="Enter amount to be stake"
                                    value={Number(stakingAmount)}
                                    onChange={(event) => {
                                        setStakingAmount(
                                            Number(event.target.value)
                                        );
                                    }}
                                    min={0}
                                />
                                <button
                                    type="button"
                                    className="button w-40 bg-gradient-to-r from-[#1ddaff] to-[#ea1af7] rounded-md text-lg px-4 py-2"
                                    onClick={stakeTokenHandler}
                                    disabled={isBusy}
                                >
                                    Stake
                                </button>
                            </div>
                            <div className="w-[420px] flex justify-between mt-4">
                                <button
                                    type="button"
                                    className="button w-40 bg-gradient-to-r from-[#1ddaff] to-[#ea1af7] rounded-md text-lg px-4 py-2"
                                    onClick={getRewardHandler}
                                    disabled={isBusy}
                                >
                                    Get Reward
                                </button>
                                <button
                                    type="button"
                                    className="button w-40 bg-gradient-to-r from-[#1ddaff] to-[#ea1af7] rounded-md text-lg px-4 py-2"
                                    onClick={unStakeHandler}
                                    disabled={isBusy}
                                >
                                    Unstake
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-secondary text-xl text-center mt-20">
                        Please connect wallet to use the app.
                    </p>
                )}
            </div>
        </main>
    );
}
