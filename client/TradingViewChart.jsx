import { useEffect, useRef, useState } from 'react';

const SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
const tradingViewSymbol = symbol => 'COINBASE:' + symbol + 'USD';

export function tradingViewUrl(symbol) {
  return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(tradingViewSymbol(symbol));
}

export default function TradingViewChart({ symbol, onShowFills }) {
  const host = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const mount = host.current;
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.async = true;
    script.src = SCRIPT;
    const theme = getComputedStyle(mount);
    script.textContent = JSON.stringify({
      symbol: tradingViewSymbol(symbol), interval: '15', timezone: 'Etc/UTC',
      theme: 'dark', style: '1', locale: 'en', autosize: true, allow_symbol_change: false,
      hide_side_toolbar: false, hide_top_toolbar: false, hide_volume: false,
      backgroundColor: theme.getPropertyValue('--surface-muted').trim(),
      gridColor: theme.getPropertyValue('--chart-grid').trim(),
    });

    let frame;
    let timer;
    function finish(result) {
      clearTimeout(timer);
      setStatus(result);
    }
    const ready = () => finish('ready');
    const unavailable = () => finish('unavailable');
    const observer = new MutationObserver(() => {
      const iframe = mount.querySelector('iframe');
      if (!iframe || frame) return;
      frame = iframe;
      frame.title = 'TradingView chart for ' + symbol + ' in USD';
      frame.addEventListener('load', ready, { once: true });
      frame.addEventListener('error', unavailable, { once: true });
    });
    observer.observe(mount, { childList: true, subtree: true });
    script.addEventListener('error', unavailable, { once: true });
    timer = setTimeout(unavailable, 12_000);
    mount.replaceChildren(widget, script);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      script.removeEventListener('error', unavailable);
      frame?.removeEventListener('load', ready);
      frame?.removeEventListener('error', unavailable);
      mount.replaceChildren();
    };
  }, [symbol]);

  return <div className="tradingview-stage" aria-busy={status === 'loading'}>
    <div ref={host} className="tradingview-widget-container" />
    {status === 'loading' && <div className="chart-placeholder tradingview-overlay" role="status">
      <span className="spinner" /> Loading TradingView
    </div>}
    {status === 'unavailable' && <div className="chart-placeholder tradingview-overlay">
      <p role="status">TradingView could not load.</p>
      <button type="button" className="button button-outline" onClick={onShowFills}>Show fill prices</button>
    </div>}
  </div>;
}
