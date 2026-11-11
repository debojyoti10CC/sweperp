import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, CircleHelp,
  Database, FlaskConical, Layers3, LogOut, ShieldCheck, SlidersHorizontal, TriangleAlert, Wallet, X,
} from 'lucide-react';
import { MARKET, STARTING_BALANCE } from '../shared/markets.js';
import MarketPanel, { FeedStatus } from './MarketPanel.jsx';
import { AccountOverview, HistoryPanel, OrderPanel, Positions } from './Trading.jsx';
import { direction, money, number, pnl, shortAddress, tone } from './format.js';
import { api, connectWallet, useTerminal } from './terminal.js';

const NAV = [{ id: 'trade', title: 'Trade' }, { id: 'portfolio', title: 'Portfolio' }, { id: 'guide', title: 'Guide' }];
const route = () => NAV.find(item => '#' + item.id === location.hash)?.id ?? 'trade';

function Brand() {
  return <a href="#trade" className="brand" aria-label="PerpLab — Trade">
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M6 17h4v9H6zM14 11h4v10h-4zM22 6h4v11h-4z" />
        <path fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M8 15v13m8-19v14m8-19v15" />
      </svg>
    </span><span>PerpLab</span>
  </a>;
}

function Header({ page, account, ready, onWallet }) {
  return <header className="app-header">
    <div className="header-inner">
      <Brand />
      <nav aria-label="Main navigation" className="main-nav">
        {NAV.map(item => <a key={item.id} href={'#' + item.id} aria-current={page === item.id ? 'page' : undefined}>{item.title}</a>)}
      </nav>
      <div className="header-actions">
        <span className="paper-badge"><FlaskConical size={14} aria-hidden="true" /> Paper trading</span>
        <button type="button" className={'button ' + (account ? 'button-outline wallet-connected' : 'button-primary')}
          onClick={onWallet} disabled={!ready} aria-label={account ? 'Wallet ' + shortAddress(account.address) : 'Connect wallet'}>
          <Wallet size={16} aria-hidden="true" />
          {account ? <>{shortAddress(account.address)} <ChevronDown size={14} aria-hidden="true" /></> : 'Connect wallet'}
        </button>
      </div>
    </div>
  </header>;
}

function PageIntro({ section, title, description, children }) {
  return <div className="page-intro">
    <div><p className="eyebrow"><span aria-hidden="true" />{section}</p><h1>{title}</h1><p className="intro-text">{description}</p></div>
    {children && <div className="intro-actions">{children}</div>}
  </div>;
}

function Modal({ title, description, busy, close, children }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.matches(':disabled')) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div className="dialog-inner">
      <div className="dialog-head">
        <div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>
        <button type="button" className="button icon-button" aria-label="Close dialog" onClick={close} disabled={busy}><X size={18} aria-hidden="true" /></button>
      </div>
      {children}
    </div>
  </dialog>;
}

function WalletModal({ account, close, changeSession, notify }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const metaMask = Boolean(window.ethereum?.isMetaMask || window.ethereum?.providers?.some(item => item.isMetaMask));
  async function run(kind) {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    setError('');
    try {
      const result = kind === 'logout' ? await api('/auth/logout', { body: {} }) : await connectWallet(kind);
      changeSession(result.account);
      notify(result.account ? 'Wallet connected' : 'Wallet signed out');
      close();
    } catch (problem) {
      setError(problem.code === 4001 || problem.code === 'ACTION_REJECTED'
        ? 'The signature was cancelled. Choose a wallet to try again.' : problem.message);
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  return <Modal title={account ? 'Connected wallet' : 'Connect wallet'}
    description={account ? 'Your practice account is saved to this address.' : 'Sign a message to unlock your paper trading account.'}
    busy={Boolean(busy)} close={close}>
    {account ? <>
      <div className="wallet-address"><Wallet size={18} aria-hidden="true" /><code>{account.address}</code></div>
      <button type="button" className="button button-outline modal-full" disabled={Boolean(busy)} onClick={() => run('logout')}>
        {busy ? <span className="spinner" /> : <LogOut size={16} aria-hidden="true" />} {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </> : <>
      <div className="wallet-choices">
        <button type="button" className="wallet-option featured" disabled={Boolean(busy)} onClick={() => run('demo')}>
          <span className="option-icon"><FlaskConical size={20} aria-hidden="true" /></span>
          <span><strong>{busy === 'demo' ? 'Connecting demo wallet…' : 'Use demo wallet'}</strong><small>Start with {money(STARTING_BALANCE)} in virtual funds.</small></span>
          {busy === 'demo' ? <span className="spinner" /> : <ArrowRight size={17} aria-hidden="true" />}
        </button>
        <button type="button" className="wallet-option" disabled={Boolean(busy) || !metaMask} onClick={() => run('metamask')}>
          <span className="option-icon"><Wallet size={20} aria-hidden="true" /></span>
          <span><strong>{busy === 'metamask' ? 'Waiting for MetaMask…' : 'MetaMask'}</strong>
            <small>{metaMask ? 'Sign with your browser extension.' : 'Extension not detected in this browser.'}</small></span>
          {busy === 'metamask' ? <span className="spinner" /> : <ArrowRight size={17} aria-hidden="true" />}
        </button>
      </div>
      <p className="modal-note"><ShieldCheck size={15} aria-hidden="true" /> Sign-in does not move funds or require gas.</p>
    </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </Modal>;
}

function PriceModal({ symbol, quote, account, close, openWallet, setMarkets, notify }) {
  const [input, setInput] = useState(() => quote?.price?.toFixed(2) ?? MARKET[symbol].practicePrice.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function apply(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api('/practice/price', { body: { symbol, price: Number(input) } });
      setMarkets(result);
      notify(symbol + ' practice price moved to ' + money(Number(input)));
      close();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  const current = quote?.price ?? MARKET[symbol].practicePrice;
  return <Modal title="Demo tools" description={'Move the ' + symbol + ' practice price to demonstrate profit, stop-loss, or liquidation.'} busy={busy} close={close}>
    {account ? <form onSubmit={apply} aria-busy={busy}>
      <div className="price-presets" role="group" aria-label="Practice price presets">
        <button className="button button-outline" type="button" disabled={busy} onClick={() => setInput((current * 0.95).toFixed(2))}>−5%</button>
        <button className="button button-outline" type="button" disabled={busy} onClick={() => setInput((current * 1.05).toFixed(2))}>+5%</button>
        <button className="button button-outline" type="button" disabled={busy} onClick={() => setInput(MARKET[symbol].practicePrice.toFixed(2))}>Use baseline</button>
      </div>
      <div className="field">
        <label htmlFor="practice-price">New {symbol} price</label>
        <div className="input-wrap">
          <input id="practice-price" type="number" inputMode="decimal" min="0.01" max="2000000" step="0.01" required disabled={busy}
            value={input} onChange={event => setInput(event.target.value)} />
          <span className="input-unit" aria-hidden="true">USD</span>
        </div>
      </div>
      <p className="modal-note"><TriangleAlert size={15} aria-hidden="true" /> This changes the shared practice market and can close open positions.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary modal-full" disabled={busy}>{busy ? <><span className="spinner" /> Applying price…</> : 'Apply practice price'}</button>
    </form> : <button type="button" className="button button-primary modal-full" onClick={openWallet}><Wallet size={16} aria-hidden="true" /> Connect wallet</button>}
  </Modal>;
}

function CloseModal({ position, close, mutate, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (!position || busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate('/positions/' + position.id + '/close', {});
      close();
      notify(position.symbol + ' ' + direction(position.side).toLowerCase() + ' position closed');
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Close position" description={position
    ? 'Close your ' + number(position.quantity) + ' ' + position.symbol + ' ' + direction(position.side).toLowerCase() + ' at the next available quote.'
    : 'This position has already closed. See transaction history for the fill.'} busy={busy} close={close}>
    {position && <>
      <dl className="modal-summary">
        <div><dt>Current price</dt><dd>{money(position.markPrice)}</dd></div>
        <div><dt>Estimated realized P&L</dt><dd className={tone(position.pnl)}>{pnl(position.pnl)}</dd></div>
      </dl>
      {position.priceDelayed && <p className="inline-note">Wait for a current quote before closing.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button type="button" className="button button-primary modal-full" disabled={busy || position.priceDelayed} onClick={confirm}>
        {busy ? <><span className="spinner" /> Closing position…</> : 'Confirm close'}
      </button>
    </>}
  </Modal>;
}

function Guide({ mode }) {
  return <>
    <PageIntro section="PerpLab guide" title="How paper trading works"
      description="Open a position, watch the numbers move, and see what happens when it closes." />
    <div className="guide-grid">
      <section className="panel guide-card">
        <div className="guide-icon"><BookOpen size={20} aria-hidden="true" /></div>
        <h2>Try a trade in three steps</h2>
        <ol className="guide-steps">
          <li><strong>Connect a wallet.</strong><p>Choose the demo wallet for a practice account with {money(STARTING_BALANCE)}.</p></li>
          <li><strong>Place a market order.</strong><p>Pick SOL, BTC, or ETH, choose Long or Short, then enter a quantity and leverage.</p></li>
          <li><strong>Review the result.</strong><p>Check the open position and close it. The fill and realized profit or loss appear in history.</p></li>
        </ol>
        <a className="button button-primary" href="#trade">Go to trade <ArrowRight size={16} aria-hidden="true" /></a>
      </section>
      <section className="panel guide-card">
        <div className="guide-icon"><Layers3 size={20} aria-hidden="true" /></div>
        <h2>Read the order preview</h2>
        <dl className="guide-terms">
          <div><dt>Order value</dt><dd>Entry price × quantity. A long gains when the price rises; a short gains when it falls.</dd></div>
          <div><dt>Margin</dt><dd>Order value ÷ leverage. A $500 position at 5× reserves about $100.</dd></div>
          <div><dt>Unrealized P&L</dt><dd>(Current price − entry price) × quantity for a long. A short reverses the sign.</dd></div>
          <div><dt>Automatic exit</dt><dd>A stop-loss closes at the next observed price once triggered. Liquidation closes when the position's remaining margin reaches its maintenance threshold.</dd></div>
        </dl>
      </section>
      <section className="panel guide-card guide-data">
        <div className="guide-icon"><Database size={20} aria-hidden="true" /></div>
        <div><h2>Where the data comes from</h2>
          <p>{mode === 'live' ? 'Coinbase Exchange supplies spot prices and candles. PerpLab uses them as reference prices for paper positions.'
            : 'The practice feed supplies simulated prices and candles, so the classroom demo can run offline after setup. Demo tools let you test a stop-loss or liquidation without waiting.'}</p>
          <p>The server validates orders, updates margin, and stores positions and history in MongoDB. Browser updates arrive through one WebSocket connection. All orders are simulated.</p>
          <p className="chart-credit">TradingView Lightweight Charts™. Copyright © 2025 <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView, Inc.</a></p>
        </div>
      </section>
    </div>
  </>;
}

export default function App() {
  const { markets, setMarkets, account, ready, connection, bootError, changeSession, mutate } = useTerminal();
  const [page, setPage] = useState(route);
  const [symbol, setSymbol] = useState('SOL');
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const latest = useRef(null);
  const quote = markets.quotes[symbol];

  function notify(message) {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 4800);
  }

  useEffect(() => {
    const navigate = () => setPage(route());
    addEventListener('hashchange', navigate);
    return () => { removeEventListener('hashchange', navigate); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    const event = account?.events?.[0];
    const previous = latest.current;
    if (previous?.address === account?.address && event && previous?.id !== event.id &&
      ['stopped', 'liquidated'].includes(event.type)) {
      notify(event.symbol + ' position ' + (event.type === 'stopped' ? 'closed by stop-loss' : 'liquidated'));
    }
    latest.current = account && { address: account.address, id: event?.id };
  }, [account]);

  const openWallet = () => setDialog({ kind: 'wallet' });
  const onClosePosition = id => setDialog({ kind: 'close', id });
  const close = () => setDialog(null);

  return <>
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault(); document.getElementById('main-content').focus();
    }}>Skip to content</a>
    <Header page={page} account={account} ready={ready} onWallet={openWallet} />
    <main className="page-shell" id="main-content" tabIndex={-1}>
      {bootError && <p className="inline-error" role="alert">{bootError}</p>}
      {page === 'trade' && <>
        <PageIntro section="Trading terminal" title="Perpetuals" description="Practice leveraged trades with virtual funds.">
          <FeedStatus mode={markets.mode} quote={quote} connection={connection} />
          {markets.mode === 'practice' && <button className="button button-outline" type="button" onClick={() => setDialog({ kind: 'price' })}>
            <SlidersHorizontal size={15} aria-hidden="true" /> Demo tools
          </button>}
        </PageIntro>
        <div className="terminal-grid">
          <div className="market-column">
            <MarketPanel symbol={symbol} setSymbol={setSymbol} quote={quote} mode={markets.mode} connection={connection} />
            <AccountOverview account={account} />
          </div>
          <aside className="order-column" aria-label="Orders and positions">
            <OrderPanel key={symbol} symbol={symbol} quote={quote} account={account} ready={ready} connection={connection}
              onConnect={openWallet} mutate={mutate} notify={notify} />
            <Positions account={account} onClose={onClosePosition} />
          </aside>
        </div>
        <HistoryPanel account={account} />
      </>}
      {page === 'portfolio' && <>
        <PageIntro section="Account" title="Portfolio" description="Track your virtual balance, positions, and fills.">
          <a href="#trade" className="button button-outline">Trade <ArrowUpRight size={15} aria-hidden="true" /></a>
        </PageIntro>
        {!account && <section className="panel portfolio-empty">
          <span className="empty-icon"><Wallet size={20} aria-hidden="true" /></span>
          <div><h2>View your practice account</h2><p>Connect a wallet to load your balance and trading history.</p></div>
          <button type="button" className="button button-primary" disabled={!ready} onClick={openWallet}>Connect wallet</button>
        </section>}
        <div className="portfolio-content"><AccountOverview account={account} /><Positions account={account} onClose={onClosePosition} wide />
          <HistoryPanel account={account} /></div>
      </>}
      {page === 'guide' && <Guide mode={markets.mode} />}
      <footer className="app-footer">
        <div><span className="footer-mark" aria-hidden="true" /> PerpLab <span className="footer-divider" /> College project · Virtual funds only</div>
        <a href="#guide"><CircleHelp size={14} aria-hidden="true" /> How it works</a>
      </footer>
    </main>
    {dialog?.kind === 'wallet' && <WalletModal account={account} close={close} changeSession={changeSession} notify={notify} />}
    {dialog?.kind === 'price' && <PriceModal symbol={symbol} quote={quote} account={account} close={close}
      openWallet={openWallet} setMarkets={setMarkets} notify={notify} />}
    {dialog?.kind === 'close' && <CloseModal position={account?.positions.find(position => position.id === dialog.id)}
      close={close} mutate={mutate} notify={notify} />}
    <div className="toast-region" role="status" aria-live="polite">
      {toast && <div className="toast"><Check size={17} aria-hidden="true" /><span>{toast}</span></div>}
    </div>
  </>;
}
