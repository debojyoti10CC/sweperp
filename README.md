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

## Hosted practice on Vercel

Vercel builds the static dashboard with `npm run build:hosted`. Select **Start practice** to use the same order, margin, and exit rules in the browser. The balance, price overrides, and history are scoped to the current tab and survive a reload.

**TradingView** opens the advanced chart for the selected Coinbase spot pair with indicators and drawing tools. **Fill prices** shows the prices used by PerpLab. Applying a price in **Demo tools** switches to that view so you can see how the position responds.

## Run on a test network

Run `npm.cmd ci` and then `npm.cmd run devnet`. Open the URL printed in the terminal. This starts a fresh local Ethereum devnet, deploys the contract, and opens the same trading dashboard. Connect the demo wallet and place or close a trade. The transaction hash in **Transaction history** opens the mined receipt. The local chain resets each time the server restarts.

For public Ethereum Sepolia, run `npm.cmd run sepolia`. The first run creates a disposable operator and prints its public address when it needs Sepolia ETH. Fund that address with test ETH and rerun the command. PerpLab deploys the contract on the first funded run and reuses it afterward. The wallet button uses MetaMask when it is available, and trade history opens Sepolia Etherscan. [Sepolia faucets](https://ethereum.org/developers/docs/networks/#sepolia)

The server's test operator pays the gas and submits settlement transactions. Each trader gets virtual collateral in the contract. The app still uses the practice price feed, including **Demo tools** for demonstrating automatic exits. The Sepolia operator key and deployment record are saved under the ignored `.data/chain/sepolia` directory. You can configure a dedicated Sepolia operator through `.env.example`.

## Three-minute classroom demo

1. Open **Trade → Connect wallet** to start the demo wallet with **$10,000** in virtual funds. If the price was moved in an earlier demo, open **Demo tools → Use baseline → Apply practice price** with no open positions.
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

The demo wallet signs a short-lived, single-use challenge automatically. In Sepolia mode, MetaMask can sign the same challenge. The wallet key stays in the browser. [Sign-In with Ethereum format](https://eips.ethereum.org/EIPS/eip-4361)

### Public price mode

Stop the practice server. Run `npm.cmd run build` and `npm.cmd run start:live`. The backend reads [Coinbase Exchange spot quotes](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker) and [historical candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles) as reference prices for paper orders. Prices refresh about every five seconds. If the feed goes stale, PerpLab labels it and waits for current prices before filling orders or triggering exits. The live-price mode has separate virtual accounts from practice mode.

## Check or present the project

- `npm.cmd test` checks sign-in, replay protection, market and account updates, margin validation, stop-loss, liquidation, concurrent orders, and persistence through a database restart.
- `GET /api/health` checks the local server and database.
- [DESIGN.md](DESIGN.md) records the design tokens, component states, and UI checks.

The proof of concept uses isolated margin with a simplified 0.5% maintenance threshold. The server supplies prices and validates order terms. Test network modes settle the resulting positions and balances in the contract, while practice mode uses MongoDB for trades.
