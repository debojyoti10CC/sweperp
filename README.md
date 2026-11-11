# PerpLab

PerpLab is a college MERN proof of concept for perpetual futures. Connect a wallet, place a paper trade, and watch the server update your margin and profit or loss. All balances are virtual.

## Run on Windows

Use Node.js 22.12 or newer. In PowerShell, open this project folder and run:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:4173**. The first install downloads a local MongoDB binary, so it needs internet access. Practice mode works offline after setup. The app starts MongoDB for you and stores data in `.data/mongo`. You do not need Docker, an API key, or a wallet extension. To use an existing MongoDB, copy `.env.example` to `.env` and set `MONGODB_URI`.

For a built copy, run `npm.cmd run build` once, then `npm.cmd start`. Stop the running server with **Ctrl+C**. Reopen the same URL in the same browser to keep the demo wallet and its history.

## Three-minute classroom demo

1. Open **Trade → Connect wallet → Use demo wallet**. Point out the **$10,000** in virtual funds. If the price was moved in an earlier demo, open **Demo tools → Use baseline → Apply practice price** with no open positions.
2. Select **SOL-PERP → Long**, enter **2 SOL**, choose **5×**, and set the stop-loss to **160**. At the baseline price near $164.82, the preview reserves about $66 in margin. Click **Open long**.
3. Open **Demo tools**, set the price to **168**, and apply it. The open position shows a profit. Apply **159** next. The position disappears from **Open positions** and history records **Stop-loss** and the realized loss.
4. Optional: with SOL near $159, open another long with **10×** leverage and no stop. Apply **140** to demonstrate liquidation. Review the exits in **Portfolio**.

Use **Guide** for the formulas and a short explanation of each step. The demo tools change the shared practice market for this server, so use one browser for the main presentation.

## Data flow

| Layer | What it does |
| --- | --- |
| React | Shows prices, the order preview, positions, and transaction history. TradingView Lightweight Charts plots the same feed the server uses to fill orders. |
| Express / Node.js | Verifies a signed wallet challenge, checks size and available margin, fills paper orders at the server's quote, and monitors stops and liquidation. |
| MongoDB | Stores virtual balances, open positions, up to 200 recent events per account, sessions, and practice price overrides. An order updates the balance, position, and event together. |
| WebSocket | Pushes market prices and signed-in account changes roughly every 800 ms on a local server. A guest receives prices only. |

The demo wallet's practice key stays in the browser. MetaMask is also supported via an injected extension. Both sign a short-lived, single-use [SIWE-style challenge](https://eips.ethereum.org/EIPS/eip-4361). The server only receives the address and signature.

### Public price mode

Stop the practice server. Run `npm.cmd run build` and `npm.cmd run start:live`. The backend reads [Coinbase Exchange spot quotes](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker) and [historical candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles) as reference prices for paper orders. Prices refresh about every five seconds. If the feed goes stale, PerpLab labels it and waits for current prices before filling orders or triggering exits. The live-price mode has separate virtual accounts from practice mode.

## Check or present the project

- `npm.cmd test` checks sign-in, replay protection, market and account updates, margin validation, stop-loss, liquidation, concurrent orders, and persistence through a database restart.
- `GET /api/health` checks the local server and database.
- [DESIGN.md](DESIGN.md) records the design tokens, component states, and UI checks.

The proof of concept substitutes a server-side paper trading engine for contract settlement. It uses isolated margin with a simplified 0.5% maintenance threshold and omits fees and funding payments. It runs on loopback and does not claim production security, uptime, or load targets.
