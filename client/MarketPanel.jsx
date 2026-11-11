import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart,
} from 'lightweight-charts';
import { ArrowDownRight, ArrowUpRight, CandlestickChart, ChevronDown, Clock3, RefreshCw, TriangleAlert } from 'lucide-react';
import { MARKET, MARKETS, RANGE, RANGES } from '../shared/markets.js';
import { dateTime, money, number, percent, shortNumber, time, tone } from './format.js';
import { api } from './terminal.js';

export function Coin({ symbol, small = false }) {
  return <span className={'coin coin-' + symbol.toLowerCase() + (small ? ' coin-small' : '')} aria-hidden="true">
    {symbol === 'SOL' ? <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.1 5h15.1l-3.3 3.5H1.8L5.1 5Zm-3.3 5.2h15.1l3.3 3.5H5.1l-3.3-3.5Zm3.3 5.3h15.1L16.9 19H1.8l3.3-3.5Z" />
    </svg> : symbol === 'BTC' ? <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.5 3h1.7v2.4h1.1V3H15v2.6c2.2.3 3.3 1.4 3.3 3.1 0 1.1-.5 2-1.5 2.6 1.4.4 2.1 1.4 2.1 2.8 0 2.4-1.7 3.7-4.1 3.9v2.6h-1.7v-2.5h-1.2v2.5h-1.7v-2.5H6v-2h1.9V7.5H6V5.4h4.5V3Zm.4 4.4V11h1.7c1.8 0 2.7-.6 2.7-1.8 0-1.2-.9-1.8-2.6-1.8h-1.8Zm0 5.4v3.3h2c1.9 0 2.9-.5 2.9-1.7 0-1.1-1-1.6-2.9-1.6h-2Z"/>
    </svg> : <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 5.9 12l6.1 3.6 6.1-3.6L12 2Zm0 15-6.1-3.6L12 22l6.1-8.6L12 17Z"/>
    </svg>}
  </span>;
}

export function FeedStatus({ mode, quote, connection }) {
  const state = connection !== 'connected' ? 'waiting' : !quote || quote.stale ? 'waiting' : 'online';
  const label = connection === 'reconnecting' ? 'Reconnecting' : connection !== 'connected' ? 'Connecting feed'
    : !quote ? 'Waiting for prices' : quote.stale ? 'Prices delayed'
      : mode === 'live' ? 'Coinbase feed' : 'Practice feed';
  return <span className={'feed-status ' + state}><span className="status-dot" aria-hidden="true" />{label}</span>;
}

function ChartCanvas({ bars, quote, seconds, symbol, onHover, onCurrent }) {
  const mount = useRef(null);
  const chartState = useRef(null);

  useEffect(() => {
    const computed = getComputedStyle(mount.current);
    const token = name => computed.getPropertyValue(name).trim();
    const grid = token('--chart-grid');
    const chart = createChart(mount.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: token('--surface-muted') },
        textColor: token('--text-secondary'), fontFamily: token('--font-family'), fontSize: Number.parseFloat(token('--font-xs')), attributionLogo: false,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.11, bottom: 0.22 }, minimumWidth: 66 },
      timeScale: { timeVisible: seconds < 86_400, secondsVisible: false, borderColor: grid, rightOffset: 4 },
      localization: { locale: 'en-US', priceFormatter: value => money(value) },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: token('--border-control'), width: 1, style: LineStyle.Dashed, labelBackgroundColor: token('--surface-raised') },
        horzLine: { color: token('--border-control'), width: 1, style: LineStyle.Dashed, labelBackgroundColor: token('--surface-raised') },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: token('--text-positive'), downColor: token('--text-negative'),
      wickUpColor: token('--text-positive'), wickDownColor: token('--text-negative'),
      borderVisible: false, priceLineColor: token('--action-fill'), priceLineStyle: LineStyle.Dashed,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    candles.setData(bars);
    volume.setData(bars.map(bar => ({
      time: bar.time, value: bar.volume, color: token(bar.close >= bar.open ? '--chart-volume-up' : '--chart-volume-down'),
    })));
    chart.timeScale().setVisibleLogicalRange({ from: -3, to: bars.length + 3 });
    chartState.current = { candles, last: bars.at(-1) };
    chart.subscribeCrosshairMove(event => onHover(event.seriesData.get(candles) ?? null));
    return () => {
      chartState.current = null;
      chart.remove();
    };
  }, [bars, seconds, onHover]);

  useEffect(() => {
    const state = chartState.current;
    if (!state || !quote || quote.stale) return;
    const stamp = Math.floor(quote.asOf / (seconds * 1000)) * seconds;
    const last = state.last;
    if (stamp < last.time) return;
    const close = quote.price;
    const next = stamp === last.time
      ? { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) }
      : { time: stamp, open: last.close, high: Math.max(last.close, close), low: Math.min(last.close, close), close };
    state.candles.update(next);
    state.last = next;
    onCurrent(next);
  }, [quote, bars, seconds, onCurrent]);

  return <div className="chart-canvas" ref={mount} role="img" aria-label={symbol + ' price candlestick and volume chart. Open Price data for a table.'} />;
}

function Chart({ symbol, range, quote }) {
  const [resource, setResource] = useState({ loading: true, bars: null, error: '', cached: false });
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState(null);
  const [liveBar, setLiveBar] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api('/markets/' + symbol + '/candles?range=' + range, { signal: controller.signal }).then(data => {
      setResource({ loading: false, bars: data.candles, error: '', cached: data.cached });
    }).catch(error => {
      if (!controller.signal.aborted) setResource({ loading: false, bars: null, error: error.message, cached: false });
    });
    return () => controller.abort();
  }, [symbol, range, retry]);

  const last = resource.bars?.at(-1);
  const current = hover ?? liveBar ?? last;
  const recent = liveBar && last
    ? (liveBar.time === last.time ? [...resource.bars.slice(-12, -1), liveBar] : [...resource.bars.slice(-11), liveBar])
    : resource.bars?.slice(-12) ?? [];
  return <>
    <div className="chart-stage" aria-busy={resource.loading}>
      {resource.loading ? <div className="chart-placeholder" role="status"><span className="spinner" />Loading price history</div>
        : resource.error ? <div className="chart-placeholder" role="alert">
          <TriangleAlert size={20} aria-hidden="true" />
          <span>{resource.error}</span>
          <button className="button button-outline" type="button" onClick={() => {
            setResource({ loading: true, bars: null, error: '', cached: false });
            setRetry(value => value + 1);
          }}><RefreshCw size={14} aria-hidden="true" /> Retry chart</button>
        </div> : resource.bars?.length ? <>
          <div className="chart-legend" aria-hidden="true">
            <span className="chart-symbol">{symbol}-PERP</span>
            <span>O <b>{number(current.open)}</b></span>
            <span>H <b>{number(current.high)}</b></span>
            <span>L <b>{number(current.low)}</b></span>
            <span>C <b className={tone(current.close - current.open)}>{number(current.close)}</b></span>
          </div>
          <ChartCanvas bars={resource.bars} quote={quote} seconds={RANGE[range].seconds} symbol={symbol} onHover={setHover} onCurrent={setLiveBar} />
        </> : <div className="chart-placeholder">No price history for this range.</div>}
    </div>
    {resource.cached && <p className="inline-note chart-note">Showing cached candles while Coinbase reconnects.</p>}
    {resource.bars?.length > 0 && <details className="price-data">
      <summary>Price data <ChevronDown size={14} aria-hidden="true" /></summary>
      <div className="table-scroll" role="region" aria-label="Recent price candles" tabIndex={0}>
        <table>
          <caption className="sr-only">Latest {recent.length} candles for {symbol}, in UTC</caption>
          <thead><tr>{['Time (UTC)', 'Open', 'High', 'Low', 'Close', 'Volume'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{recent.reverse().map(bar => <tr key={bar.time}>
            <td>{dateTime(bar.time * 1000)}</td><td>{money(bar.open)}</td><td>{money(bar.high)}</td>
            <td>{money(bar.low)}</td><td>{money(bar.close)}</td><td>{number(bar.volume)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>}
  </>;
}

export default function MarketPanel({ symbol, setSymbol, quote, mode, connection }) {
  const [range, setRange] = useState('1D');
  const ChangeIcon = quote?.change < 0 ? ArrowDownRight : ArrowUpRight;
  return <section className="panel market-panel" aria-label="Market">
    <div className="market-summary">
      <div className="market-picker">
        <Coin symbol={symbol} />
        <div className="market-picker-text">
          <label className="market-select-label">
            <span className="sr-only">Trading pair</span>
            <select value={symbol} onChange={event => setSymbol(event.target.value)}>
              {MARKETS.map(item => <option value={item.symbol} key={item.symbol}>{item.symbol}-PERP</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
          <span className="market-subtitle">{MARKET[symbol].name} / USD</span>
        </div>
      </div>
      <dl className="market-stats">
        <div className="stat-mark"><dt>Mark price</dt><dd>{money(quote?.price)}</dd></div>
        <div><dt>24h change</dt><dd className={tone(quote?.change)}>
          {quote && <ChangeIcon size={14} aria-hidden="true" />}{percent(quote?.change)}
        </dd></div>
        <div><dt>24h high</dt><dd>{money(quote?.high)}</dd></div>
        <div><dt>24h low</dt><dd>{money(quote?.low)}</dd></div>
        <div><dt>24h volume</dt><dd>{quote ? shortNumber(quote.volume) + ' ' + symbol : '—'}</dd></div>
      </dl>
    </div>
    <div className="chart-toolbar">
      <div className="chart-title"><CandlestickChart size={16} aria-hidden="true" /><span>Price chart</span></div>
      <div className="range-options" role="group" aria-label="Chart time range">
        {RANGES.map(item => <button key={item.id} type="button" aria-pressed={item.id === range} aria-label={item.id + ' (' + item.label + ')'}
          onClick={() => setRange(item.id)}>{item.id}</button>)}
      </div>
    </div>
    <Chart key={symbol + range} symbol={symbol} range={range} quote={quote} />
    <div className="chart-footer">
      <span className="chart-source"><FeedStatus mode={mode} quote={quote} connection={connection} /></span>
      <span className="chart-clock"><Clock3 size={13} aria-hidden="true" />{quote ? time(quote.asOf) + ' UTC' : 'Awaiting update'}</span>
      <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="attribution">Powered by TradingView</a>
    </div>
  </section>;
}
