"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import idl from "../idl/count_down.json";

const PROGRAM_ID = new PublicKey(idl.address);
const VAULT_SEED = "vault";

interface CountDownAccount {
  authority: PublicKey;
  initBid: BN;
  ticketPrice: BN;
  startTime: BN;
  endTime: BN;
  ticketCounter: BN;
  lastTicketBuyer: PublicKey;
  vaultBump: number;
  status: { active: Record<string, never> } | { claimed: Record<string, never> };
}

interface AuctionListItem {
  pubkey: PublicKey;
  data: CountDownAccount;
  vaultBalance: number;
  timeLeft: number;
}

function formatTime(seconds: number): { d: string; h: string; m: string; s: string } {
  if (seconds <= 0) return { d: "0", h: "00", m: "00", s: "00" };
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return {
    d: d.toString(),
    h: h.toString().padStart(2, "0"),
    m: m.toString().padStart(2, "0"),
    s: s.toString().padStart(2, "0"),
  };
}

function formatTimeShort(seconds: number): string {
  if (seconds <= 0) return "ENDED";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function shortenAddress(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

function getReadProgram(connection: import("@solana/web3.js").Connection) {
  const dummyWallet = {
    publicKey: PublicKey.default,
    signTransaction: async <T,>(t: T) => t,
    signAllTransactions: async <T,>(t: T) => t,
  };
  const readProvider = new AnchorProvider(connection, dummyWallet as never, { commitment: "confirmed" });
  return new Program(idl as never, readProvider);
}

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [auctions, setAuctions] = useState<AuctionListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [countdownData, setCountdownData] = useState<CountDownAccount | null>(null);
  const [countdownPubkey, setCountdownPubkey] = useState<PublicKey | null>(null);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("");

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    return new AnchorProvider(connection, wallet as never, {
      commitment: "confirmed",
    });
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(idl as never, provider);
  }, [provider]);

  // Fetch all countdown accounts
  const fetchAllAuctions = useCallback(async () => {
    try {
      const readProgram = getReadProgram(connection);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allAccounts = await (readProgram.account as any).countDown.all();
      const now = Math.floor(Date.now() / 1000);

      const items: AuctionListItem[] = await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allAccounts.map(async (acc: any) => {
          const [vaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(VAULT_SEED), acc.publicKey.toBuffer()],
            PROGRAM_ID
          );
          const bal = await connection.getBalance(vaultPda);
          const endTime = acc.account.endTime.toNumber();
          return {
            pubkey: acc.publicKey,
            data: acc.account as CountDownAccount,
            vaultBalance: bal / LAMPORTS_PER_SOL,
            timeLeft: Math.max(0, endTime - now),
          };
        })
      );

      // Active first, then by time left desc
      items.sort((a, b) => {
        const aActive = "active" in a.data.status;
        const bActive = "active" in b.data.status;
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return b.timeLeft - a.timeLeft;
      });

      setAuctions(items);
    } catch (err) {
      console.error("Failed to fetch auctions:", err);
    } finally {
      setLoadingList(false);
    }
  }, [connection]);

  // Fetch on mount
  useEffect(() => {
    fetchAllAuctions();
    const interval = setInterval(fetchAllAuctions, 15000);
    return () => clearInterval(interval);
  }, [fetchAllAuctions]);

  // Update time left for list items every second
  useEffect(() => {
    if (countdownPubkey) return; // don't update when viewing detail
    const interval = setInterval(() => {
      setAuctions((prev) =>
        prev.map((item) => {
          const now = Math.floor(Date.now() / 1000);
          const endTime = item.data.endTime.toNumber();
          return { ...item, timeLeft: Math.max(0, endTime - now) };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownPubkey]);

  // Fetch single countdown detail
  const fetchCountdown = useCallback(async () => {
    if (!countdownPubkey) return;
    try {
      const readProgram = getReadProgram(connection);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await (readProgram.account as any).countDown.fetch(countdownPubkey) as CountDownAccount;
      setCountdownData(data);

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(VAULT_SEED), countdownPubkey.toBuffer()],
        PROGRAM_ID
      );
      const bal = await connection.getBalance(vaultPda);
      setVaultBalance(bal / LAMPORTS_PER_SOL);
    } catch (err) {
      console.error("Failed to fetch countdown:", err);
    }
  }, [connection, countdownPubkey]);

  useEffect(() => {
    if (!countdownPubkey) return;
    fetchCountdown();
    const interval = setInterval(fetchCountdown, 5000);
    return () => clearInterval(interval);
  }, [countdownPubkey, fetchCountdown]);

  useEffect(() => {
    if (!countdownData) return;
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const end = countdownData.endTime.toNumber();
      setTimeLeft(Math.max(0, end - now));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [countdownData]);

  const buyTicket = useCallback(async () => {
    if (!program || !wallet.publicKey || !countdownPubkey || !countdownData) return;
    setLoading(true);
    setTxStatus("");
    try {
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(VAULT_SEED), countdownPubkey.toBuffer()],
        PROGRAM_ID
      );
      const tx = await program.methods
        .buyTicket()
        .accountsPartial({
          signer: wallet.publicKey,
          countDown: countdownPubkey,
          authority: countdownData.authority,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setTxStatus("TICKET SECURED // " + tx.slice(0, 8) + "...");
      await fetchCountdown();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTxStatus("FAILED // " + msg.slice(0, 60));
    } finally {
      setLoading(false);
    }
  }, [program, wallet.publicKey, countdownPubkey, countdownData, fetchCountdown]);

  const claimAuction = useCallback(async () => {
    if (!program || !wallet.publicKey || !countdownPubkey) return;
    setLoading(true);
    setTxStatus("");
    try {
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(VAULT_SEED), countdownPubkey.toBuffer()],
        PROGRAM_ID
      );
      const tx = await program.methods
        .claimAuction()
        .accountsPartial({
          signer: wallet.publicKey,
          countDown: countdownPubkey,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setTxStatus("CLAIMED // " + tx.slice(0, 8) + "...");
      await fetchCountdown();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTxStatus("FAILED // " + msg.slice(0, 60));
    } finally {
      setLoading(false);
    }
  }, [program, wallet.publicKey, countdownPubkey, fetchCountdown]);

  const selectAuction = (pubkey: PublicKey) => {
    setCountdownPubkey(pubkey);
    setCountdownData(null);
    setTxStatus("");
  };

  const goBack = () => {
    setCountdownPubkey(null);
    setCountdownData(null);
    setTxStatus("");
    fetchAllAuctions();
  };

  const time = formatTime(timeLeft);
  const isActive = countdownData && "active" in countdownData.status;
  const isExpired = timeLeft === 0 && countdownData !== null;
  const isUrgent = timeLeft > 0 && timeLeft <= 60;
  const isWinner =
    wallet.publicKey &&
    countdownData &&
    countdownData.lastTicketBuyer.toBase58() === wallet.publicKey.toBase58();

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-6 md:py-12 max-w-2xl mx-auto w-full">
      {/* Header */}
      <header className="w-full flex items-center justify-between mb-8 md:mb-12">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "var(--neon-green)", boxShadow: "0 0 8px var(--neon-green)" }}
          />
          <span className="text-[10px] md:text-xs tracking-[0.2em] uppercase" style={{ color: "var(--text-mid)" }}>
            Devnet
          </span>
        </div>
        <WalletMultiButton />
      </header>

      {/* Title */}
      <div className="text-center mb-8 md:mb-12">
        <h1
          className="glitch-text text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter neon-green-glow"
          data-text="COUNTDOWN"
        >
          COUNTDOWN
        </h1>
        <p className="text-[10px] md:text-xs tracking-[0.3em] uppercase mt-2" style={{ color: "var(--text-dim)" }}>
          Last ticket wins everything
        </p>
      </div>

      {/* ============ AUCTION LIST VIEW ============ */}
      {!countdownPubkey && (
        <>
          {loadingList ? (
            <div className="card-degen p-8 w-full text-center" style={{ borderRadius: 0 }}>
              <div
                className="text-xs tracking-[0.2em] uppercase"
                style={{ color: "var(--text-dim)", animation: "flicker 1.5s infinite" }}
              >
                Fetching auctions...
              </div>
            </div>
          ) : auctions.length === 0 ? (
            <div className="card-degen p-8 w-full text-center" style={{ borderRadius: 0 }}>
              <div className="text-xs tracking-[0.2em] uppercase" style={{ color: "var(--text-dim)" }}>
                No auctions found
              </div>
            </div>
          ) : (
            <div className="w-full space-y-3 md:space-y-4">
              {auctions.map((auction) => {
                const active = "active" in auction.data.status;
                const ended = auction.timeLeft === 0;
                const statusColor = !active
                  ? "var(--text-dim)"
                  : ended
                  ? "var(--neon-pink)"
                  : "var(--neon-green)";

                return (
                  <button
                    key={auction.pubkey.toBase58()}
                    onClick={() => selectAuction(auction.pubkey)}
                    className="w-full text-left cursor-pointer transition-all group relative overflow-hidden"
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-dim)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = statusColor;
                      e.currentTarget.style.boxShadow = `0 0 20px ${statusColor}22, inset 0 0 30px ${statusColor}08`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-dim)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    {/* Top glow bar */}
                    <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${statusColor}, transparent)`, opacity: active ? 1 : 0.3 }} />

                    <div className="p-5 md:p-6">
                      {/* Top row: vault amount + status badge */}
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-baseline gap-2">
                          <span
                            className="text-2xl md:text-3xl font-bold"
                            style={{
                              color: active ? "var(--neon-green)" : "var(--text-dim)",
                              textShadow: active ? "0 0 20px rgba(57,255,20,0.3)" : "none",
                              lineHeight: 1,
                            }}
                          >
                            {auction.vaultBalance.toFixed(2)}
                          </span>
                          <span className="text-sm font-bold" style={{ color: "var(--text-mid)" }}>SOL</span>
                        </div>

                        {/* Status badge */}
                        <div
                          className="px-3 py-1 text-[10px] md:text-xs font-bold tracking-[0.15em] uppercase flex-shrink-0"
                          style={{
                            border: `1px solid ${statusColor}`,
                            color: statusColor,
                            background: `${statusColor}0a`,
                            textShadow: active && !ended ? `0 0 8px ${statusColor}` : "none",
                          }}
                        >
                          {!active ? "CLAIMED" : ended ? "ENDED" : formatTimeShort(auction.timeLeft)}
                        </div>
                      </div>

                      {/* Bottom row: meta info */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 text-[9px] md:text-[10px] tracking-[0.2em] uppercase" style={{ color: "var(--text-dim)" }}>
                          <span style={{ color: "var(--neon-purple)", textShadow: "0 0 6px rgba(191,0,255,0.3)" }}>
                            {auction.data.ticketCounter.toString()} tickets
                          </span>
                          <span>
                            {(auction.data.ticketPrice.toNumber() / LAMPORTS_PER_SOL).toFixed(2)} SOL/ticket
                          </span>
                        </div>
                        <div className="text-[9px] md:text-[10px] tracking-[0.15em] uppercase" style={{ color: "var(--text-dim)" }}>
                          {shortenAddress(auction.pubkey.toBase58())}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ============ AUCTION DETAIL VIEW ============ */}
      {countdownPubkey && countdownData && (
        <>
          {/* Back button */}
          <button
            onClick={goBack}
            className="w-full text-left mb-4 text-xs tracking-[0.15em] uppercase cursor-pointer hover:underline"
            style={{ color: "var(--neon-green)" }}
          >
            {"<"} ALL AUCTIONS
          </button>

          {/* Timer */}
          <div className="card-degen p-6 md:p-10 w-full mb-4 text-center" style={{ borderRadius: 0 }}>
            {isActive && !isExpired ? (
              <>
                <div
                  className="text-[10px] tracking-[0.3em] uppercase mb-4"
                  style={{ color: isUrgent ? "var(--neon-pink)" : "var(--text-dim)" }}
                >
                  {isUrgent ? "// HURRY UP ANON //" : "// TIME REMAINING //"}
                </div>
                <div className={`flex items-center justify-center gap-2 md:gap-4 ${isUrgent ? "urgent-timer" : ""}`}>
                  {Number(time.d) > 0 && (
                    <>
                      <TimeBlock value={time.d} label="DAYS" urgent={isUrgent} />
                      <Separator />
                    </>
                  )}
                  <TimeBlock value={time.h} label="HRS" urgent={isUrgent} />
                  <Separator />
                  <TimeBlock value={time.m} label="MIN" urgent={isUrgent} />
                  <Separator />
                  <TimeBlock value={time.s} label="SEC" urgent={isUrgent} />
                </div>
              </>
            ) : isExpired && isActive ? (
              <>
                <div
                  className="text-3xl md:text-5xl font-bold mb-2"
                  style={{ color: "var(--neon-pink)", textShadow: "0 0 20px var(--neon-pink)" }}
                >
                  GAME OVER
                </div>
                <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-dim)" }}>
                  Waiting for claim...
                </div>
              </>
            ) : (
              <>
                <div
                  className="text-3xl md:text-5xl font-bold mb-2"
                  style={{ color: "var(--neon-purple)", textShadow: "0 0 20px var(--neon-purple)" }}
                >
                  CLAIMED
                </div>
                <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-dim)" }}>
                  Auction is over. GG.
                </div>
              </>
            )}
          </div>

          {/* Vault hero */}
          <div className="w-full mb-3 relative overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-dim)" }}>
            <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, transparent, var(--neon-green), transparent)", animation: "border-flow 3s linear infinite", backgroundSize: "200% 100%" }} />
            <div className="p-6 md:p-8">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[9px] tracking-[0.4em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
                    Total Vault
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="text-5xl md:text-6xl lg:text-7xl font-bold"
                      style={{
                        color: "var(--neon-green)",
                        textShadow: "0 0 30px rgba(57,255,20,0.4), 0 0 60px rgba(57,255,20,0.15)",
                        lineHeight: 1,
                      }}
                    >
                      {vaultBalance.toFixed(2)}
                    </span>
                    <span className="text-lg md:text-xl font-bold" style={{ color: "var(--text-mid)" }}>SOL</span>
                  </div>
                </div>
                <div className="text-right pb-1">
                  <div
                    className="text-3xl md:text-4xl font-bold"
                    style={{ color: "var(--neon-purple)", textShadow: "0 0 15px rgba(191,0,255,0.4)", lineHeight: 1 }}
                  >
                    {countdownData.ticketCounter.toString()}
                  </div>
                  <div className="text-[9px] tracking-[0.3em] uppercase mt-1" style={{ color: "var(--text-dim)" }}>
                    tickets
                  </div>
                </div>
              </div>
            </div>
            <div
              className="flex items-center justify-between px-6 md:px-8 py-3"
              style={{ borderTop: "1px solid var(--border-dim)", background: "rgba(255,255,255,0.01)" }}
            >
              <div className="flex items-center gap-2">
                <div className="w-[6px] h-[6px] rounded-full" style={{ background: isWinner ? "var(--neon-green)" : "var(--neon-pink)", boxShadow: isWinner ? "0 0 6px var(--neon-green)" : "0 0 6px var(--neon-pink)" }} />
                <span className="text-[10px] md:text-xs tracking-[0.15em] uppercase" style={{ color: isWinner ? "var(--neon-green)" : "var(--neon-pink)" }}>
                  {isWinner ? "YOU ARE LAST BUYER" : shortenAddress(countdownData.lastTicketBuyer.toBase58())}
                </span>
              </div>
              <span className="text-[10px] md:text-xs tracking-[0.15em]" style={{ color: "var(--neon-cyan)", textShadow: "0 0 6px rgba(0,255,247,0.3)" }}>
                {(countdownData.ticketPrice.toNumber() / LAMPORTS_PER_SOL).toFixed(2)} SOL/ticket
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="w-full space-y-3 mb-6">
            {isActive && !isExpired && (
              <div>
                <button
                  onClick={buyTicket}
                  disabled={loading || !wallet.publicKey}
                  className="btn-degen w-full py-4 md:py-5 text-sm md:text-base tracking-[0.15em]"
                >
                  {loading
                    ? "SENDING TX..."
                    : !wallet.publicKey
                    ? "CONNECT WALLET"
                    : `BUY TICKET — ${(countdownData.ticketPrice.toNumber() / LAMPORTS_PER_SOL).toFixed(2)} SOL`}
                </button>
                <div className="text-center mt-2 text-[9px] md:text-[10px] tracking-[0.2em] uppercase" style={{ color: "var(--text-dim)" }}>
                  Each ticket adds <span style={{ color: "var(--neon-cyan)", textShadow: "0 0 4px rgba(0,255,247,0.3)" }}>+60s</span> to the timer
                </div>
              </div>
            )}

            {isActive && isExpired && isWinner && (
              <button
                onClick={claimAuction}
                disabled={loading || !wallet.publicKey}
                className="btn-degen btn-claim w-full py-4 md:py-5 text-sm md:text-base tracking-[0.15em]"
              >
                {loading ? "CLAIMING..." : "CLAIM YOUR BAG"}
              </button>
            )}

            {isActive && isExpired && !isWinner && wallet.publicKey && (
              <div className="card-degen p-4 text-center" style={{ borderRadius: 0 }}>
                <span className="text-xs tracking-[0.15em] uppercase" style={{ color: "var(--text-dim)" }}>
                  You are not the winner. NGMI.
                </span>
              </div>
            )}
          </div>

          {/* TX Status */}
          {txStatus && (
            <div className="w-full card-degen p-3 mb-4" style={{ borderRadius: 0 }}>
              <p
                className="text-[10px] md:text-xs tracking-wider break-all"
                style={{ color: txStatus.startsWith("FAILED") ? "var(--neon-pink)" : "var(--neon-green)" }}
              >
                {`> ${txStatus}`}
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="w-full pt-4 mt-auto" style={{ borderTop: "1px solid var(--border-dim)" }}>
            <div className="flex flex-col sm:flex-row justify-between gap-2 text-[9px] md:text-[10px] tracking-[0.15em] uppercase" style={{ color: "var(--text-dim)" }}>
              <span>Program: {shortenAddress(PROGRAM_ID.toBase58())}</span>
              <span>Account: {shortenAddress(countdownPubkey.toBase58())}</span>
            </div>
          </div>
        </>
      )}

      {countdownPubkey && !countdownData && (
        <div className="card-degen p-8 w-full text-center" style={{ borderRadius: 0 }}>
          <div
            className="text-xs tracking-[0.2em] uppercase"
            style={{ color: "var(--text-dim)", animation: "flicker 1.5s infinite" }}
          >
            Loading auction data...
          </div>
        </div>
      )}
    </main>
  );
}

function TimeBlock({ value, label, urgent }: { value: string; label: string; urgent: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="text-4xl md:text-6xl lg:text-7xl font-bold"
        style={{
          fontVariantNumeric: "tabular-nums",
          color: urgent ? "var(--neon-pink)" : "#ffffff",
          textShadow: urgent
            ? "0 0 20px var(--neon-pink), 0 0 40px var(--neon-pink)"
            : "0 0 10px rgba(255,255,255,0.3)",
          animation: urgent ? "countdown-tick 1s ease-in-out infinite" : undefined,
        }}
      >
        {value}
      </div>
      <span className="text-[9px] md:text-[10px] tracking-[0.3em] uppercase mt-1" style={{ color: "var(--text-dim)" }}>
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <span
      className="text-3xl md:text-5xl"
      style={{ color: "var(--text-dim)", animation: "flicker 2s infinite" }}
    >
      :
    </span>
  );
}

