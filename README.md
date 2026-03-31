# Countdown Auction

Solana countdown auction game on devnet. Last ticket buyer wins the vault.

## How it works

- Admin initializes an auction with an initial bid, ticket price, and end time
- Players buy tickets — each ticket adds 60s to the timer and splits the price 50/50 (authority / vault)
- When the timer expires, the last buyer claims the entire vault

## Program

- **Program ID:** `9x4LbUPs1aKmLFdHbmop1vHyqqyvg8ngnZkjTmT8XNB7`
- **Framework:** Anchor 0.32.1
- **Cluster:** Devnet

## Frontend

```bash
cd app/frontend
npm install
npm run dev
```

## Init a new auction

```bash
cd app/frontend
npx tsx scripts/init.ts
```
