import { Contract, getAddress } from 'ethers';
import { MARKETS, STARTING_BALANCE } from '../shared/markets.js';
import { QUANTITY_SCALE } from '../shared/risk.js';
import { AppError } from './errors.js';

const EXIT_TYPE = { 1: 'closed', 2: 'stopped', 3: 'liquidated' };
const logOrder = (a, b) => a.blockNumber - b.blockNumber || a.index - b.index;
const timeString = seconds => new Date(Number(seconds) * 1000).toISOString();

export async function openLedger({ provider, signer, deployment, abi, network }) {
  const contract = new Contract(deployment.address, abi, signer);
  if (await contract.operator() !== await signer.getAddress()) {
    throw new Error('The configured signer is not the operator of this contract.');
  }
  if (Number(await contract.STARTING_CENTS()) !== STARTING_BALANCE * 100) {
    throw new Error('The contract starting balance does not match PerpLab.');
  }
  const accounts = new Map();
  const observed = new Set();
  let lastBlock = deployment.blockNumber - 1;
  let syncing;
  let pendingHash;
  let queue = Promise.resolve();

  function getAccount(id) {
    const key = id.toLowerCase();
    if (!accounts.has(key)) {
      accounts.set(key, { _id: key, address: getAddress(id), availableCents: STARTING_BALANCE * 100, version: 0, positions: [], events: [] });
    }
    return accounts.get(key);
  }

  function applyLog(log) {
    if (log.address.toLowerCase() !== deployment.address.toLowerCase()) return;
    const key = log.transactionHash + ':' + log.index;
    if (observed.has(key)) return;
    const parsed = contract.interface.parseLog(log);
    if (!parsed) return;
    const { trader, id, availableCents, time } = parsed.args;
    const previous = getAccount(trader);
    const date = timeString(time);
    let event;
    let positions;

    if (parsed.name === 'PositionOpened') {
      const { terms, orderId } = parsed.args;
      const position = {
        id, symbol: MARKETS[Number(terms.market)].symbol, side: terms.isShort ? 'short' : 'long',
        units: Number(terms.units), leverage: Number(terms.leverage), entryCents: Number(terms.entry),
        marginCents: Number(terms.margin), stopCents: terms.stop === 0n ? null : Number(terms.stop),
        liquidationCents: Number(terms.liquidation), openedAt: date,
      };
      positions = [...previous.positions, position];
      event = {
        type: 'opened', clientOrderId: orderId, symbol: position.symbol, side: position.side,
        quantity: position.units / QUANTITY_SCALE, price: position.entryCents / 100, realizedPnl: null,
      };
    } else if (parsed.name === 'PositionExited') {
      const position = previous.positions.find(item => item.id === id);
      if (!position) throw new Error('Chain history is missing the opening transaction for a position.');
      positions = previous.positions.filter(item => item.id !== id);
      event = {
        type: EXIT_TYPE[Number(parsed.args.reason)], symbol: position.symbol, side: position.side,
        quantity: position.units / QUANTITY_SCALE, price: Number(parsed.args.price) / 100,
        realizedPnl: Number(parsed.args.pnl) / 100,
      };
    } else return;

    accounts.set(previous._id, {
      ...previous, availableCents: Number(availableCents), version: previous.version + 1, positions,
      events: [{ ...event, id: key, positionId: id, time: date, txHash: log.transactionHash }, ...previous.events].slice(0, 200),
    });
    observed.add(key);
  }

  async function scan() {
    const tip = Number(await provider.send('eth_blockNumber', []));
    while (lastBlock < tip) {
      const end = Math.min(lastBlock + 1500, tip);
      const logs = await provider.getLogs({ address: deployment.address, fromBlock: lastBlock + 1, toBlock: end });
      logs.sort(logOrder).forEach(applyLog);
      lastBlock = end;
    }
  }

  function sync() {
    if (!syncing) syncing = scan().finally(() => { syncing = null; });
    return syncing;
  }

  function recordReceipt(receipt) {
    receipt.logs.forEach(applyLog);
    pendingHash = null;
  }

  async function record(send) {
    let transaction;
    try {
      transaction = await send();
      pendingHash = transaction.hash;
      recordReceipt(await transaction.wait(1, 75_000));
    } catch (error) {
      if (error.receipt) recordReceipt(error.receipt);
      if (pendingHash) throw new AppError(503, 'The transaction is still confirming. Check history before retrying.');
      if (error.code === 'INSUFFICIENT_FUNDS') {
        throw new AppError(503, 'The testnet operator needs test ETH for gas.');
      }
      if (error.code === 'CALL_EXCEPTION') throw new AppError(409, error.reason || 'The contract rejected this order.');
      throw new AppError(503, 'The chain did not accept the transaction. Try again.');
    }
  }

  function changeAccount(id, change) {
    const result = queue.then(async () => {
      await sync();
      if (pendingHash) {
        const receipt = await provider.getTransactionReceipt(pendingHash);
        if (!receipt) throw new AppError(503, 'The previous transaction is still confirming.');
        recordReceipt(receipt);
      }
      const before = getAccount(id);
      const next = change(before);
      if (before === next) return before;

      const known = new Set(before.events.map(event => event.id));
      const additions = next.events.filter(event => !known.has(event.id)).reverse();
      for (const event of additions) {
        if (event.type === 'opened') {
          const position = next.positions.find(item => item.id === event.positionId);
          await record(() => contract.open(before.address, event.clientOrderId, {
            market: MARKETS.findIndex(item => item.symbol === position.symbol), isShort: position.side === 'short',
            leverage: position.leverage, units: position.units, entry: position.entryCents, margin: position.marginCents,
            stop: position.stopCents ?? 0, liquidation: position.liquidationCents,
          }));
        } else {
          await record(() => contract.exit(before.address, event.positionId, Math.round(event.price * 100)));
        }
      }
      return getAccount(id);
    });
    queue = result.catch(() => {});
    return result;
  }

  await sync();
  const refresh = setInterval(() => { if (pendingHash) void sync().catch(() => {}); }, 5000);
  refresh.unref();
  return {
    network: { ...network, contract: deployment.address },
    ensureAccount: getAccount,
    getAccount,
    getAccounts: ids => ids.map(getAccount),
    activeAccounts: () => [...accounts.values()].filter(account => account.positions.length),
    changeAccount,
    async receipt(hash) {
      const receipt = await provider.getTransactionReceipt(hash);
      if (!receipt || receipt.to?.toLowerCase() !== deployment.address.toLowerCase()) return null;
      return {
        chainId: network.chainId, hash: receipt.hash, blockNumber: receipt.blockNumber,
        status: receipt.status === 1 ? 'confirmed' : 'reverted', contract: receipt.to,
      };
    },
    async stop() {
      clearInterval(refresh);
      await queue;
      await syncing;
    },
  };
}
