import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(path, { body, signal } = {}) {
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(9000),
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
      const result = await api(path, { body });
      if (generation === epoch.current) setAccount(previous => newestAccount(previous, result.account));
      return result.account;
    } catch (error) {
      if (error.status === 401 && generation === epoch.current) changeSession(null);
      throw error;
    }
  }, [changeSession]);

  return { markets, setMarkets, account, ready, connection, bootError, changeSession, mutate };
}

export async function connectWallet(kind) {
  const { Wallet, hexlify, toUtf8Bytes } = await import('ethers');
  let address, chainId, sign;
  if (kind === 'demo') {
    const key = localStorage.getItem('perplab.practice.wallet') ?? localStorage.getItem('kimia.practice.wallet');
    const wallet = key ? new Wallet(key) : Wallet.createRandom();
    if (!localStorage.getItem('perplab.practice.wallet')) localStorage.setItem('perplab.practice.wallet', wallet.privateKey);
    address = wallet.address;
    chainId = 1;
    sign = message => wallet.signMessage(message);
  } else {
    const injected = window.ethereum;
    const provider = injected?.providers?.find(item => item.isMetaMask) ?? injected;
    if (!provider?.isMetaMask) throw new Error('MetaMask is unavailable in this browser. Use the demo wallet or open PerpLab in a browser with MetaMask.');
    const [selected] = await provider.request({ method: 'eth_requestAccounts' });
    if (!selected) throw new Error('No wallet address was selected.');
    address = selected;
    chainId = Number(await provider.request({ method: 'eth_chainId' }));
    sign = message => provider.request({ method: 'personal_sign', params: [hexlify(toUtf8Bytes(message)), address] });
  }
  const { nonce, message } = await api('/auth/challenge', { body: { address, chainId } });
  const signature = await sign(message);
  return api('/auth/verify', { body: { nonce, signature } });
}
