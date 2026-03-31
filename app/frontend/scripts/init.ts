import { Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

// ---- CONFIG ----
const INIT_BID = 3 * LAMPORTS_PER_SOL;           // 3 SOL initial pot
const TICKET_PRICE = 0.1 * LAMPORTS_PER_SOL;    // 0.1 SOL per ticket
const DURATION_SECONDS = 2 * 24 * 60 * 60;       // 2 days
// ----------------

async function main() {
  // Load wallet from default Solana CLI keypair
  const keypairPath = process.env.KEYPAIR_PATH
    || `${process.env.HOME}/.config/solana/id.json`;
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log("Payer:", payer.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Setup provider
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // Load IDL
  const idlPath = path.join(__dirname, "../src/idl/count_down.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // Generate a new keypair for the countdown account
  const countDown = Keypair.generate();
  console.log("\n=== COUNTDOWN ACCOUNT ===");
  console.log("Pubkey:", countDown.publicKey.toBase58());

  // Derive vault PDA
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), countDown.publicKey.toBuffer()],
    program.programId
  );
  console.log("Vault PDA:", vault.toBase58());

  // Calculate end_time
  const now = Math.floor(Date.now() / 1000);
  const endTime = now + DURATION_SECONDS;
  console.log("\nInit bid:", INIT_BID / LAMPORTS_PER_SOL, "SOL");
  console.log("Ticket price:", TICKET_PRICE / LAMPORTS_PER_SOL, "SOL");
  console.log("Duration:", DURATION_SECONDS, "seconds");
  console.log("End time:", new Date(endTime * 1000).toLocaleString());

  // Send tx
  console.log("\nSending initialize tx...");
  const tx = await program.methods
    .initialize(
      new BN(INIT_BID),
      new BN(TICKET_PRICE),
      new BN(endTime),
    )
    .accountsPartial({
      signer: payer.publicKey,
      countDown: countDown.publicKey,
      vault: vault,
      systemProgram: SystemProgram.programId,
    })
    .signers([countDown])
    .rpc();

  console.log("\nTx signature:", tx);
  console.log("\n========================================");
  console.log("COUNTDOWN PUBKEY (paste in frontend):");
  console.log(countDown.publicKey.toBase58());
  console.log("========================================");

  // Save keypair for later use
  const keypairOutPath = path.join(__dirname, "countdown-keypair.json");
  fs.writeFileSync(keypairOutPath, JSON.stringify(Array.from(countDown.secretKey)));
  console.log("\nKeypair saved to:", keypairOutPath);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
