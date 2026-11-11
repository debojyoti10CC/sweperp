import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(path, { body, signal, timeout = 9000 } = {}) {
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(timeout),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'PerpLab could not reach the server. Try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function newestAccount(current, next) {
  if (next && current?.address === next.address) {
    if (current.version > next.version) return current;
    return { ...current, ...next };
  }
  return next;
}

export function useTerminal() {
  const [markets, setMarkets] = useState({ mode: null, quotes: {} });
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState('connecting');
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [bootError, setBootError] = useState('');
  const epoch = useRef(0);
  const streamed = useRef(false);
  const tradeTimeout = markets.settlement ? 90_000 : 9000;

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      api('/markets', { signal: controller.signal }),
      api('/account', { signal: controller.signal }),
    ]).then(([marketResult, accountResult]) => {
      if (controller.signal.aborted || epoch.current !== 0 || streamed.current) return;
      if (marketResult.status === 'fulfilled') setMarkets(marketResult.value);
      if (accountResult.status === 'fulfilled') setAccount(accountResult.value.account);
      if (marketResult.status === 'rejected' || accountResult.status === 'rejected') {
        setBootError('The local server is taking longer to respond. PerpLab will keep trying.');
      }
      setReady(true);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let socket, retry, watchdog;
    let done = false;
    const current = () => !done && epoch.current === sessionEpoch;
    function connect() {
      if (!current()) return;
      const url = new URL('/ws', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      let lastMessage = Date.now();
      socket.onmessage = event => {
        if (!current()) return;
        try {
          const { account: next, ...market } = JSON.parse(event.data);
          lastMessage = Date.now();
          streamed.current = true;
          setMarkets(market);
          setAccount(previous => newestAccount(previous, next));
          setReady(true);
          setConnection('connected');
          setBootError('');
        } catch { /* wait for the next valid frame */ }
      };
      watchdog = setInterval(() => {
        if (Date.now() - lastMessage > 6000) socket.close();
      }, 3000);
      socket.onclose = event => {
        clearInterval(watchdog);
        if (!current()) return;
        if (event.code === 4001) setAccount(null);
        setConnection('reconnecting');
        retry = setTimeout(connect, 1200);
      };
    }
    connect();
    return () => {
      done = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      socket?.close();
    };
  }, [sessionEpoch]);

  const changeSession = useCallback(next => {
    epoch.current++;
    setSessionEpoch(epoch.current);
    setAccount(next);
    setReady(true);
  }, []);

  const mutate = useCallback(async (path, body) => {
    const generation = epoch.current;
    try {
      const result = await api(path, { body, timeout: tradeTimeout });
      if (generation === epoch.current) setAccount(previous => newestAccount(previous, result.account));
      return result.account;
    } catch (error) {
      if (error.status === 401 && generation === epoch.current) changeSession(null);
      throw error;
    }
  }, [changeSession, tradeTimeout]);

  return { markets, setMarkets, account, ready, connection, bootError, changeSession, mutate };
}

async function browserWallet(provider, settlement) {
  const [address] = await provider.request({ method: 'eth_requestAccounts' });
  if (!address) throw new Error('Choose a wallet account to connect.');
  const chainId = '0x' + settlement.chainId.toString(16);
  if (await provider.request({ method: 'eth_chainId' }) !== chainId) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId, chainName: settlement.label, rpcUrls: [settlement.rpcUrl], blockExplorerUrls: [settlement.explorer],
          nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
        }],
      });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    }
  }
  const { hexlify, toUtf8Bytes } = await import('ethers');
  return { address, sign: message => provider.request({ method: 'personal_sign', params: [hexlify(toUtf8Bytes(message)), address] }) };
}

async function demoWallet() {
  const { Wallet } = await import('ethers');
  const savedKey = localStorage.getItem('perplab.practice.wallet');
  const key = savedKey ?? localStorage.getItem('kimia.practice.wallet');
  const wallet = key ? new Wallet(key) : Wallet.createRandom();
  if (!savedKey) localStorage.setItem('perplab.practice.wallet', wallet.privateKey);
  return { address: wallet.address, sign: message => wallet.signMessage(message) };
}

export async function connectWallet(settlement) {
  const injected = settlement?.explorer ? window.ethereum : null;
  const provider = injected?.providers?.find(wallet => wallet.isMetaMask) ?? injected;
  const { address, sign } = typeof provider?.request === 'function'
    ? await browserWallet(provider, settlement) : await demoWallet();
  const chainId = settlement?.chainId ?? 1;
  const { nonce, message } = await api('/auth/challenge', { body: { address, chainId } });
  const signature = await sign(message);
  return api('/auth/verify', { body: { nonce, signature } });
}
