# Countdown Auction

Solana countdown auction game. Last ticket buyer wins the vault.

## How it works

- Admin initializes an auction with an initial bid, ticket price, and end time
- Players buy tickets — each ticket adds 60s to the timer and splits the price 50/50 (authority / vault)
- When the timer expires, the last buyer claims the entire vault
- Admin can close the auction account after claim to recover rent

## Program

- **Program ID:** `9x4LbUPs1aKmLFdHbmop1vHyqqyvg8ngnZkjTmT8XNB7`
- **Framework:** Anchor 0.32.1
- **Cluster:** Mainnet

### Instructions

| Instruction | Description |
|---|---|
| `initialize` | Create a new auction (admin only) |
| `buy_ticket` | Buy a ticket, adds +60s to timer |
| `claim_auction` | Winner claims the vault |
| `close_auction` | Admin closes the account, recovers rent |

## Frontend

```bash
cd app/frontend
npm install
npm run dev
```

Requires `.env` in `app/frontend/`:
```
NEXT_PUBLIC_HELIUS_API_KEY=<your-helius-key>
NEXT_PUBLIC_HELIUS_TURBO_KEY=<your-helius-turbo-key>
```

## Init a new auction

Edit config in `app/frontend/scripts/init.ts` then:

```bash
cd app/frontend
npx tsx scripts/init.ts
```

## Links

- **X:** [@TimeGoesDowm](https://x.com/TimeGoesDowm)
