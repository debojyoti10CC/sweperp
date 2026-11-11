import { useRef, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, CandlestickChart, ChevronDown, Clock3,
  History, Layers3, ShieldCheck, Wallet, X,
} from 'lucide-react';
import { LEVERAGES, MARKET } from '../shared/markets.js';
import { positionTerms, QUANTITY_SCALE } from '../shared/risk.js';
import { dateTime, direction, money, number, percent, pnl, tone } from './format.js';
import { Coin } from './MarketPanel.jsx';

function PanelTitle({ icon: Icon, title, children, titleId }) {
  return <div className="panel-title">
    <div className="title-label"><Icon size={17} aria-hidden="true" /><h2 id={titleId}>{title}</h2></div>
    {children}
  </div>;
}

function Empty({ icon: Icon, title, children }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={18} aria-hidden="true" /></span>
    <div><p>{title}</p><span>{children}</span></div>
  </div>;
}

export function OrderPanel({ symbol, quote, account, ready, connection, onConnect, mutate, notify }) {
  const [side, setSide] = useState('long');
  const [quantity, setQuantity] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [stop, setStop] = useState('');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const lastRequest = useRef(null);
  const qtyInput = useRef(null);
  const stopInput = useRef(null);
  const market = MARKET[symbol];
  const units = Math.round(Number(quantity) * QUANTITY_SCALE);
  const quoteReady = connection === 'connected' && quote && !quote.stale;
  const terms = quote && units > 0 && Number(quantity) <= market.maxQty
    ? positionTerms(Math.round(quote.price * 100), units, leverage, side) : null;
  const showFunds = account ? money(account.available) : '—';
  const action = side === 'long' ? 'Open long' : 'Open short';

  function fieldError(field, message) {
    setProblem({ field, message });
    (field === 'quantity' ? qtyInput : stopInput).current?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    if (!account || !quoteReady || inFlight.current) return;
    setProblem(null);
    if (!quantity || Number(quantity) < market.minQty || Number(quantity) > market.maxQty ||
        Math.abs(Number(quantity) * QUANTITY_SCALE - units) > 1e-6 ||
        units % Math.round(market.qtyStep * QUANTITY_SCALE) !== 0) {
      return fieldError('quantity', 'Enter ' + market.minQty + '–' + market.maxQty + ' ' + symbol + ' in steps of ' + market.qtyStep + '.');
    }
    if (stop && (!Number.isFinite(Number(stop)) || Number(stop) <= 0 ||
        Math.abs(Number(stop) * 100 - Math.round(Number(stop) * 100)) > 1e-6)) {
      return fieldError('stop', 'Enter a positive stop-loss with up to two decimals.');
    }
    inFlight.current = true;
    setBusy(true);
    const payload = { symbol, side, quantity: Number(quantity), leverage, stopLoss: stop ? Number(stop) : null };
    const formKey = JSON.stringify(payload);
    const clientOrderId = lastRequest.current?.formKey === formKey ? lastRequest.current.id : crypto.randomUUID();
    lastRequest.current = { formKey, id: clientOrderId };
    try {
      await mutate('/orders', { ...payload, clientOrderId });
      lastRequest.current = null;
      setQuantity('');
      setStop('');
      notify(direction(side) + ' opened · ' + number(Number(quantity)) + ' ' + symbol);
    } catch (error) {
      if (error.status >= 400 && error.status < 500) lastRequest.current = null;
      setProblem({ message: error.message });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="panel order-panel" aria-labelledby="order-title">
    <PanelTitle icon={CandlestickChart} title="Place order" titleId="order-title"><span className="micro-badge">Market</span></PanelTitle>
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <fieldset className="order-fields" disabled={busy}>
        <legend className="sr-only">Paper market order</legend>
        <fieldset className="side-options">
          <legend className="sr-only">Direction</legend>
          {['long', 'short'].map(value => {
            const Icon = value === 'long' ? ArrowUpRight : ArrowDownRight;
            return <label key={value} className={'side-choice ' + value}>
              <input type="radio" name="side" value={value} checked={side === value} onChange={() => { setSide(value); setProblem(null); }} />
              <Icon size={16} aria-hidden="true" /> {direction(value)}
            </label>;
          })}
        </fieldset>
        <div className="field">
          <label htmlFor="order-quantity">Quantity <span className="sr-only">in {symbol}</span></label>
          <div className="input-wrap">
            <input id="order-quantity" ref={qtyInput} type="number" inputMode="decimal" min={market.minQty}
              max={market.maxQty} step={market.qtyStep} placeholder="0.00" value={quantity}
              aria-invalid={problem?.field === 'quantity'} aria-describedby={problem?.field === 'quantity' ? 'order-error' : undefined}
              onChange={event => { setQuantity(event.target.value); setProblem(null); }} />
            <span className="input-unit" aria-hidden="true">{symbol}</span>
          </div>
        </div>
        <fieldset className="leverage-group">
          <legend>Leverage</legend>
          <div className="leverage-options">
            {LEVERAGES.map(value => <label key={value}>
              <input type="radio" name="leverage" value={value} checked={leverage === value} onChange={() => { setLeverage(value); setProblem(null); }} />
              <span>{value}×</span>
            </label>)}
          </div>
        </fieldset>
        <div className="field">
          <div className="field-label"><label htmlFor="order-stop">Stop-loss price</label><span>Optional</span></div>
          <div className="input-wrap">
            <input id="order-stop" ref={stopInput} type="number" inputMode="decimal" min="0.01" step="0.01"
              value={stop} placeholder="0.00" aria-invalid={problem?.field === 'stop'}
              aria-describedby={problem?.field === 'stop' ? 'order-error' : undefined}
              onChange={event => { setStop(event.target.value); setProblem(null); }} />
            <span className="input-unit" aria-hidden="true">USD</span>
          </div>
        </div>
      </fieldset>
      <dl className="order-summary">
        <div><dt>Order value</dt><dd>{money(terms && terms.notionalCents / 100)}</dd></div>
        <div><dt>Margin required</dt><dd>{money(terms && terms.marginCents / 100)}</dd></div>
        <div><dt>Est. liquidation</dt><dd>{money(terms && terms.liquidationCents / 100)}</dd></div>
        <div className="available-line"><dt>Available to trade</dt><dd>{showFunds}</dd></div>
      </dl>
      {problem && <p className="inline-error" id="order-error" role="alert">{problem.message}</p>}
      {account && !quoteReady && <p className="inline-note">Orders resume when a current price is available.</p>}
      {account ? <button className={'button button-primary order-action action-' + side} type="submit" disabled={busy || !quoteReady}>
        {busy ? <><span className="spinner" /> Placing order…</> : <>{action} <ArrowUpRight size={16} aria-hidden="true" /></>}
      </button> : <button className="button button-primary order-action" type="button" onClick={onConnect} disabled={!ready}>
        <Wallet size={16} aria-hidden="true" /> {ready ? 'Connect wallet to trade' : 'Checking wallet…'}
      </button>}
      <p className="order-disclaimer"><ShieldCheck size={14} aria-hidden="true" /> Orders use virtual funds.</p>
    </form>
  </section>;
}

function PositionCard({ position, onClose }) {
  const item = position;
  return <article className="position-card" aria-label={item.symbol + ' ' + direction(item.side) + ' position'}>
    <div className="position-head">
      <div><Coin symbol={item.symbol} small /><strong>{item.symbol}-PERP</strong><span className={'side-tag ' + item.side}>{direction(item.side)} {item.leverage}×</span></div>
      <button type="button" className="button button-outline close-position" aria-label={'Close ' + item.symbol + ' ' + direction(item.side).toLowerCase() + ' position'}
        disabled={item.priceDelayed} onClick={() => onClose(item.id)}><X size={13} aria-hidden="true" /> Close</button>
    </div>
    <dl className="position-details">
      <div><dt>Size</dt><dd>{number(item.quantity)} {item.symbol}</dd></div>
      <div><dt>Margin</dt><dd>{money(item.margin)}</dd></div>
      <div><dt>Entry price</dt><dd>{money(item.entryPrice)}</dd></div>
      <div><dt>Mark price</dt><dd>{money(item.markPrice)}</dd></div>
      <div><dt>Stop-loss</dt><dd>{money(item.stopLoss)}</dd></div>
      <div><dt>Liquidation</dt><dd>{money(item.liquidationPrice)}</dd></div>
    </dl>
    <div className="position-result">
      <span>Unrealized P&L{item.priceDelayed ? ' (delayed)' : ''}</span>
      <strong className={tone(item.pnl)}>{pnl(item.pnl)} {item.roi != null && <small>({percent(item.roi)})</small>}</strong>
    </div>
  </article>;
}

export function Positions({ account, onClose, wide = false }) {
  const positions = account?.positions ?? [];
  const scrollable = !wide && positions.length > 1;
  return <section className="panel positions-panel" aria-labelledby="positions-title">
    <PanelTitle icon={Layers3} title="Open positions" titleId="positions-title"><span className="count-badge">{positions.length}</span></PanelTitle>
    {positions.length ? <div className={'position-cards' + (wide ? ' wide' : '') + (scrollable ? ' scrollable' : '')}
      role={scrollable ? 'region' : undefined} aria-label={scrollable ? 'Open position cards' : undefined} tabIndex={scrollable ? 0 : undefined}>
      {positions.map(item => <PositionCard key={item.id} position={item} onClose={onClose} />)}
    </div> : <Empty icon={Layers3} title="No open positions">
      {account ? 'Place an order to see it here.' : 'Connect a wallet to start trading.'}
    </Empty>}
  </section>;
}

export function AccountOverview({ account }) {
  const cards = [
    { label: 'Account equity', value: money(account?.equity), icon: Wallet, foot: 'Virtual account value' },
    { label: 'Available margin', value: money(account?.available), icon: Layers3, foot: account ? money(account.margin) + ' in use' : 'Funds available to trade' },
    { label: 'Unrealized P&L', value: pnl(account?.unrealizedPnl), icon: Activity, tone: tone(account?.unrealizedPnl), foot: 'Open positions' },
  ];
  return <section className="account-strip" aria-label="Account overview">
    {cards.map(({ label, value, icon: Icon, foot, tone: color }) => <article className="panel account-metric" key={label}>
      <div className="account-metric-label"><Icon size={15} aria-hidden="true" />{label}</div>
      <p className={color}>{value}</p><span>{foot}</span>
    </article>)}
  </section>;
}

const labels = { opened: 'Opened', closed: 'Closed', stopped: 'Stop-loss', liquidated: 'Liquidated' };

export function HistoryPanel({ account }) {
  const [filter, setFilter] = useState('all');
  const events = account?.events ?? [];
  const rows = events.filter(event => filter === 'all' || (filter === 'opened' ? event.type === 'opened' : event.type !== 'opened'));
  return <section className="panel history-panel" aria-labelledby="history-title">
    <PanelTitle icon={History} title="Transaction history" titleId="history-title">
      <label className="compact-select">
        <span className="sr-only">Filter transaction history</span>
        <select disabled={!events.length} value={events.length ? filter : 'all'} onChange={event => setFilter(event.target.value)}>
          <option value="all">All activity</option><option value="opened">Open orders</option><option value="closed">Position exits</option>
        </select><ChevronDown size={13} aria-hidden="true" />
      </label>
    </PanelTitle>
    {rows.length ? <div className="table-scroll history-scroll" role="region" aria-label="Transaction history table" tabIndex={0}>
      <table>
        <caption className="sr-only">Paper orders and position exits, newest first</caption>
        <thead><tr>{['Event', 'Market', 'Side', 'Size', 'Fill price', 'Realized P&L', 'Time (UTC)'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(event => <tr key={event.id}>
          <td><span className={'event-tag ' + event.type}>{labels[event.type]}</span></td>
          <td className="table-market"><Coin symbol={event.symbol} small />{event.symbol}-PERP</td>
          <td><span className={'side-tag ' + event.side}>{direction(event.side)}</span></td>
          <td>{number(event.quantity)} {event.symbol}</td><td>{money(event.price)}</td>
          <td className={tone(event.realizedPnl)}>{pnl(event.realizedPnl)}</td>
          <td><time dateTime={event.time}>{dateTime(event.time)}</time></td>
        </tr>)}</tbody>
      </table>
    </div> : <Empty icon={Clock3} title={events.length ? 'No matching transactions' : 'No transactions yet'}>
      {events.length ? 'Choose another activity filter.' : 'Orders and position exits will appear here.'}
    </Empty>}
  </section>;
}
