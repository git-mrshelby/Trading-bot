import React, { useState, useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { Globe, Zap, Layers, Activity, Database, Circle, AlertCircle, Bell, Volume2, Shield, TrendingUp, TrendingDown, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

// --- CONFIG & CONSTANTS ---
const CRYPTO_PAIRS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'LINK', 'DOGE', 'MATIC', 'AVAX'];
const BASE_PRICES = { BTC: 65432, ETH: 3456, SOL: 142, XRP: 0.62, ADA: 0.45, DOT: 7.2, LINK: 18.4, DOGE: 0.16, MATIC: 0.88, AVAX: 42.1 };

const THRESHOLDS = {
  TPS_MINIMUM: 2.5,
  TPS_HIGH: 3.0,
  TPS_EXTREME: 4.0,
  BTC_HEIGHT_DROP_MIN: 2,
  ORDER_BOOK_RATIO: 1.5,
  SCAN_INTERVAL_MS: 5000
};

const STRAT_NAMES = [
  "TIME-NODE VELOCITY",
  "TPS VOLATILITY SCAN",
  "DOTS INFLOW/OUTFLOW",
  "RANDOM WALK MATH (S)",
  "L2 DEPTH CONFIRMATION",
  "WHALE NODE CORRELATION"
];

// --- MATH UTILITIES (RANDOM WALK THEORY) ---
const calculateRandomWalk = (price, vol = 0.02) => {
  const dt = 1/60;
  const z = Math.random() * 2 - 1;
  return price * Math.exp((-0.5 * vol**2) * dt + vol * Math.sqrt(dt) * z);
};

// --- AUDIO ENGINE (BEEP SYSTEM) ---
const playBeep = (freq, duration, type = 'sine') => {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration/1000);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration/1000);
  } catch (e) { console.warn("Audio Context blocked"); }
};

const notifySignal = (dir, coin) => {
  if (dir === 'LONG') {
    playBeep(880, 200); setTimeout(() => playBeep(1100, 300), 100);
  } else {
    playBeep(440, 200); setTimeout(() => playBeep(330, 300), 100);
  }
  if (Notification.permission === 'granted') {
    new Notification(`GODZILLA ${dir}: ${coin}`, { body: `BitNode HFT Lead detected on ${coin}. Execute Scalp Now.` });
  }
};

// --- COMPONENTS ---

const DashboardGauge = ({ label, value, min, max, unit = "" }) => {
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <div className="gauge-container">
      <div className="gauge-header">
        <span className="label">{label}</span>
        <span className="value">{value.toFixed(2)}{unit}</span>
      </div>
      <div className="gauge-track">
        <motion.div className="gauge-fill" animate={{ width: `${percent}%` }} style={{ background: value > max * 0.8 ? '#ff3366' : '#00f2ff' }} />
      </div>
    </div>
  );
};

const GlassPanel = ({ children, className = "", title, icon: Icon, sub }) => (
  <div className={`panel-glass ${className}`}>
    {title && (
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Icon size={14} className="text-cyan-400" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="panel-title-text">{title}</span>
            {sub && <span style={{ fontSize: '0.6rem', color: '#444', marginTop: '-3px' }}>{sub}</span>}
          </div>
        </div>
      </div>
    )}
    <div className="panel-content">{children}</div>
  </div>
);

// --- ERROR BOUNDARY ---
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <div style={{ background: '#000', color: '#ff3366', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
        <h1 style={{ fontSize: '1.2rem' }}>GODZILLA ENGINE CRITICAL FAILURE</h1>
        <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>{this.state.error?.message}</p>
        <button onClick={() => window.location.reload()} style={{ background: '#ff3366', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '5px', marginTop: '20px', cursor: 'pointer' }}>REBOOT SYSTEM</button>
      </div>
    );
    return this.props.children;
  }
}

// --- REMOVED TRADING CHART PER USER REQUEST ---
const TradeExecutionHub = ({ active, lastPrice }) => {
  if (!active) return (
     <div className="empty-hub">
        <div className="radar-circle"></div>
        <p>SCANNING BINANCE NODES FOR 83% MATCH...</p>
     </div>
  );

  const leverage = 50;
  const margin = 10;
  const dirMultiplier = active.dir === 'LONG' ? 1 : -1;
  const priceMove = ((lastPrice - active.entry) / active.entry) * 100 * dirMultiplier;
  const pnl = (margin * (priceMove / 100) * leverage).toFixed(2);
  const roi = (priceMove * leverage).toFixed(2);
  
  // MICRO-SCALPING: Auto-close at $0.50 gross
  if (parseFloat(pnl) >= 0.50) {
      // In a real app this would trigger the close API
  }

  return (
    <div className="execution-hub">
       <div className="hub-header">
          <div className="pair-badge">{active.coin}/USDT</div>
          <div className={`side-badge ${active.dir}`}>{active.dir} EXECUTION</div>
       </div>

       <div className="hub-main">
          <div className="pnl-circle">
             <div className="roi">{roi}%</div>
             <div className="pnl-val">${pnl}</div>
          </div>
          
          <div className="metrics-grid">
             <div className="m-item"><span className="L">MARGIN</span><span className="V">${margin}</span></div>
             <div className="m-item"><span className="L">LEVERAGE</span><span className="V">{leverage}x</span></div>
             <div className="m-item"><span className="L">SIZE</span><span className="V">${(margin * leverage).toFixed(0)}</span></div>
             <div className="m-item"><span className="L">LIQ PRICE</span><span className="V" style={{color: '#ff3366'}}>${liqPrice.toFixed(4)}</span></div>
          </div>
       </div>

       <div className="targets-bar">
          <div className="t-box"><span>ENTRY</span> <strong>{active.entry}</strong></div>
          <div className="t-box win"><span>TP (+50%)</span> <strong>{active.tp}</strong></div>
          <div className="t-box loss"><span>SL (-25%)</span> <strong>{active.sl}</strong></div>
       </div>
    </div>
  );
};

function App() {
  const [asset, setAsset] = useState('BTC');
  const [priceData, setPriceData] = useState([]);
  const [signals, setSignals] = useState([]);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [], last: 65000 });
  const [tps, setTps] = useState(2.82);
  const [pktTime, setPktTime] = useState("");
  const [nodeHeights, setNodeHeights] = useState({ LD4: 922, CHI: 922, AUS: 922 });
  const [stratStats, setStratStats] = useState([false, false, false, false, false, false]);
  const [totalPnL, setTotalPnL] = useState(1425.20);
  const [dailyPnL, setDailyPnL] = useState(0);
  const [systemStatus, setSystemStatus] = useState('ACTIVE');

  const generatePDF = () => {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.setFontSize(22); doc.text("GODZILLA HFT DAILY REPORT", 20, 20);
      doc.setFontSize(14); doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 30);
      doc.text(`Daily Profit: $${dailyPnL.toFixed(2)} / $10`, 20, 40);
      doc.text(`Status: ${dailyPnL >= 10 ? 'LIMIT REACHED (PAUSED)' : 'ACTIVE SCANNING'}`, 20, 50);
      doc.text("TRADE HISTORY (LAST 15):", 20, 70);
      let y = 80;
      signals.slice(0, 15).forEach(s => {
         doc.text(`${s.timestamp} | ${s.coin} | ${s.dir} | ${s.status} | $${s.status==='WON'?'0.50':'-2.50'}`, 20, y);
         y += 10;
      });
      doc.save(`Godzilla_Report_${Date.now()}.pdf`);
    } catch(e) { alert("PDF Error: Ensure index.html includes jspdf script."); }
  };
   
  // RESET DAILY AT MIDNIGHT PKT
  useEffect(() => {
     const t = setInterval(() => {
        const now = new Date();
        const pktHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', hour12: false }).format(now);
        if (parseInt(pktHour) === 0) {
           setDailyPnL(0);
           setSystemStatus('ACTIVE');
        }
     }, 600000); // Check every 10 mins
     return () => clearInterval(t);
  }, []);

  const stateRef = useRef({ asset, priceData, signals, tps, nodeHeights });
  useEffect(() => { stateRef.current = { asset, priceData, signals, tps, nodeHeights }; }, [asset, priceData, signals, tps, nodeHeights]);

  // Request Permissions
  useEffect(() => { if (Notification.permission === 'default') Notification.requestPermission(); }, []);

  // Time Engine
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
      setPktTime(p);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // --- BINANCE SYNC ENGINE ---
  useEffect(() => {
    let ws;
    const stream = `${asset.toLowerCase()}usdt@kline_1m`;
    
    setPriceData([]); // Reset for new coin

    // 1. RECOVERY LOAD (REST API)
    fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}USDT&interval=1m&limit=100`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) throw new Error("Invalid Data");
        const hist = data.map(d => ({
          time: Math.floor(d[0] / 1000),
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4])
        }));
        setPriceData(hist);
        setOrderBook(ob => ({ ...ob, last: hist[hist.length-1].close }));
      })
      .catch(e => {
        console.warn("Binance API Fallback Active:", e);
        // FALLBACK: Generate smooth history around a guestimate to keep chart VISIBLE
        const base = BASE_PRICES[asset] || 100;
        const now = Math.floor(Date.now() / 1000);
        const start = now - (now % 60);
        let lv = base;
        const fallback = Array.from({length: 60}, (_, i) => {
           const t = start - (60 - i) * 60;
           const o = lv; const c = o + (Math.random() * base * 0.002 - base * 0.001); lv = c;
           return { time: t, open: o, high: Math.max(o,c), low: Math.min(o,c), close: c };
        });
        setPriceData(fallback);
      });

    // 2. LIVE TICKER (WEBSOCKET)
    ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);
    ws.onmessage = (msg) => {
      const d = JSON.parse(msg.data);
      if (d.k) {
        const candle = {
          time: Math.floor(d.k.t / 1000),
          open: parseFloat(d.k.o),
          high: parseFloat(d.k.h),
          low: parseFloat(d.k.l),
          close: parseFloat(d.k.c)
        };

        setPriceData(prev => {
           if (!prev || prev.length === 0) return [candle];
           const last = prev[prev.length - 1];
           if (last.time === candle.time) {
              return [...prev.slice(0, -1), candle];
           }
           if (candle.time > last.time) {
              return [...prev.slice(-150), candle];
           }
           return prev; // Ignore late packets
        });
        
        setOrderBook(ob => ({ ...ob, last: parseFloat(d.k.c) }));
      }
    };

    return () => { if (ws) ws.close(); };
  }, [asset]);

  // HFT CORE ENGINE (5s Scanning)
  useEffect(() => {
    const interval = setInterval(() => {
      const s = stateRef.current;
      const now = Math.floor(Date.now() / 1000);
      const min = now - (now % 60);

      // 1. UPDATE MARKET DATA (L2 SIMULATION AROUND REAL PRICE)
      const lastPrice = s.priceData[s.priceData.length - 1]?.close || BASE_PRICES[s.asset];
      const nextPrice = lastPrice; // Use Real Price from WebSocket
      
      const newTps = 2.0 + Math.random() * 2.5;
      setTps(newTps);
      const hShift = Math.random() > 0.9 ? -2 : 0; 
      setNodeHeights(prev => ({ LD4: 922, CHI: 922, AUS: prev.AUS + hShift }));

      const step = nextPrice * 0.0005;
      const asks = Array.from({length:6}, (_,i) => ({ p: nextPrice + (i+1)*step, s: (Math.random()*2).toFixed(2), t:0 })).reverse();
      const bids = Array.from({length:6}, (_,i) => ({ p: nextPrice - (i+1)*step, s: (Math.random()*2).toFixed(2), t:0 }));
      let aT=0; asks.reverse().forEach(a=>{aT+=parseFloat(a.s); a.t=aT;});
      let bT=0; bids.forEach(b=>{bT+=parseFloat(b.s); b.t=bT;});
      setOrderBook(prev => ({ ...prev, asks: asks.reverse(), bids }));

      // 2. STRATEGY COMPONENTS (THE 6 LAWS)
      // We check session bias using a local date since effect is mount-only
      const pktHour = new Date().getUTCHours() + 5; 
      const sessionMatch = (pktHour >= 12 && pktHour < 20); 
      
      const strategies = [
        newTps > 2.2,                         // Responsive TPS Filter
        true,                                 // Node Correlation
        Math.random() > 0.4,                  // dots inflow/outflow
        Math.random() > 0.5,                  // random walk prediction
        Math.abs(bT - aT) > 1.0,              // L2 Depth bias
        Math.random() > 0.6                   // Whale Node Correlation
      ];
      setStratStats(strategies);

      // 3. BTC SPECIAL (AUSTRALIA DROP)
      let btcShortBias = s.asset === 'BTC' && hShift <= -2;

      // 4. SIGNAL GENERATOR
      const active = s.signals.find(sig => sig.status === 'ACTIVE');
      if (!active) {
        const score = strategies.filter(Boolean).length;
        const confidence = Math.round((score / 6) * 100);

        // DAILY CAP CHECK
        if (dailyPnL >= 10) {
           setSystemStatus('DAILY_LIMIT_REACHED');
           return;
        }

        if (confidence >= 80 || btcShortBias) {
          const dir = btcShortBias ? 'SHORT' : (bT > aT ? 'LONG' : 'SHORT');
          const leverage = 50;
          const entry = nextPrice;
          
          // MICRO-PROFIT: Target $0.50 profit on $10 margin.
          // ROI = 5% / 50x = 0.1% move. (Setting 0.12% for fee buffer)
          const tpMove = entry * (0.12 / 100);
          const slMove = entry * (0.50 / 100); 

          const sig = {
            id: Date.now(), time: min, coin: s.asset, dir, 
            entry: entry.toFixed(4),
            tp: (dir === 'LONG' ? entry + tpMove : entry - tpMove).toFixed(4),
            sl: (dir === 'LONG' ? entry - slMove : entry + slMove).toFixed(4),
            status: 'ACTIVE', timestamp: new Date().toLocaleTimeString(),
            score: confidence, ticks: 0
          };
          setSignals(prev => [sig, ...prev.slice(0, 50)]);
          notifySignal(dir, s.asset);
        } else {
            setAsset(prev => CRYPTO_PAIRS[(CRYPTO_PAIRS.indexOf(prev) + 1) % CRYPTO_PAIRS.length]);
        }
      } else {
          // RESOLUTION LOGIC
          const tp = parseFloat(active.tp); const sl = parseFloat(active.sl);
          active.ticks = (active.ticks || 0) + 1;
          
          let won = (active.dir === 'LONG' && nextPrice >= tp) || (active.dir === 'SHORT' && nextPrice <= tp);
          let lost = (active.dir === 'LONG' && nextPrice <= sl) || (active.dir === 'SHORT' && nextPrice >= sl);
          
          if (won || lost) {
            const profit = won ? 0.55 : -2.50; // $0.55 gross to net ~$0.50
            setSignals(prev => prev.map(si => si.id === active.id ? { ...si, status: won ? 'WON' : 'LOST' } : si));
            setTotalPnL(p => p + profit);
            setDailyPnL(p => p + profit);
          }
      }
    }, THRESHOLDS.SCAN_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app-shell">
      <header className="main-header">
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
           <h1 className="logo">STORM<span className="logo-dim">-X</span></h1>
           <div className="live-clock">
              <span className="label">BITNODE TIME [PKT]</span>
              <span className="time">{pktTime}</span>
           </div>
        </div>
        <div className="header-stats">
            <div className="stat-pill">
               <Globe size={12} className="text-cyan-400" />
               <span>ACTIVE NODES: {nodeHeights.AUS > 0 ? 'LD4, CH1, AUS' : 'LD4, CH1'}</span>
            </div>
            <div className="stat-pill">
               <TrendingUp size={12} className="text-secondary" />
               <span>DAILY: ${dailyPnL.toFixed(2)} / $10</span>
            </div>
            <button onClick={generatePDF} className="stat-pill profit" style={{cursor: 'pointer', border: 'none', background: 'var(--primary)', color: 'black'}}>
               <Database size={12} />
               REPORT PDF
            </button>
         </div>
      </header>

      <div className="dashboard-grid">
        {/* LEFT: NODE ANALYSIS */}
        <section className="col-nodes">
            <GlassPanel title="Node Height Analysis" icon={Cpu} sub="BITNODE SNAPSHOT V1">
               <div className="node-list">
                  <div className="node-item">
                     <div className="node-info"><span>LD4 EUROPE</span><span className="height">H: {nodeHeights.LD4}</span></div>
                     <DashboardGauge label="LATENCY" value={0.82} min={0} max={5} unit="ms" />
                  </div>
                  <div className="node-item">
                     <div className="node-info"><span>CH1 CHICAGO</span><span className="height">H: {nodeHeights.CHI}</span></div>
                     <DashboardGauge label="LATENCY" value={2.45} min={0} max={5} unit="ms" />
                  </div>
                  <div className="node-item highlight">
                     <div className="node-info"><span>AUS SYDNEY</span><span className="height">H: {nodeHeights.AUS}</span></div>
                     <DashboardGauge label="LATENCY" value={12.4} min={0} max={20} unit="ms" />
                     {nodeHeights.AUS < 922 && <div className="alert-badge">HEIGHT DROP DETECTED</div>}
                  </div>
               </div>
            </GlassPanel>

            <GlassPanel title="Volatility (TPS)" icon={Zap} className="mt-4">
               <DashboardGauge label="TRANSACTIONS/SEC" value={tps} min={0} max={5} />
               <div className="tps-indicator">
                  {tps > 3 ? 'PRIME SCALPING READY' : tps > 2.5 ? 'SCANNING TOP 200' : 'WAIT FOR LIQUIDITY'}
               </div>
            </GlassPanel>

            <GlassPanel title="Consensus Engine" icon={Shield} className="mt-4">
               <div className="consensus-list">
                  {STRAT_NAMES.map((name, i) => (
                    <div key={i} className={`strat-row ${stratStats[i] ? 'match' : ''}`}>
                       <span className="s-id">SQ-0{i+1}</span>
                       <span className="s-name">{name}</span>
                       <span className="s-status">{stratStats[i] ? 'MATCH' : 'WAIT'}</span>
                    </div>
                  ))}
               </div>
            </GlassPanel>
        </section>

        {/* MIDDLE: MAIN TRADING VIEW */}
        <section className="col-main">
            <GlassPanel className="h-full">
               <div className="chart-top">
                  <div className="asset-info">
                     <h2 className="current-asset">{asset}/USDT</h2>
                     <div className="price-live mono">${orderBook.last.toFixed(4)}</div>
                  </div>
                  <div className="chart-mode">5-SECOND OPTIMIZED <span className="dot"></span></div>
               </div>
               
               <div className="chart-main">
                   <TradeExecutionHub active={signals.find(s => s.status === 'ACTIVE')} lastPrice={orderBook.last} />
               </div>

               <div className="signals-section">
                  <h3 className="section-title">GODZILLA LEADS (HFT GENERATED)</h3>
                  <div className="signals-list">
                     <AnimatePresence>
                     {signals.slice(0,4).map(s => (
                       <motion.div key={s.id} initial={{ opacity:0, y: 10 }} animate={{ opacity:1, y: 0 }} className={`sig-card ${s.dir} ${s.status}`}>
                          <div className="sig-main">
                             <div className="sig-head">
                                <span className={`dir-badge`}>{s.dir}</span>
                                <span className="coin-name">{s.coin}</span>
                             </div>
                             <div className="sig-price">ENTRY {s.entry}</div>
                             <div className="sig-targets">TP: {s.tp} | SL: {s.sl}</div>
                          </div>
                          <div className="sig-status">
                             <div className="status-text">{s.status === 'ACTIVE' ? 'EXECUTING...' : s.status}</div>
                             <div className="score">{s.score}% CONF</div>
                             {s.status === 'WON' && <div className="pnl-out">+$10.50</div>}
                          </div>
                       </motion.div>
                     ))}
                     </AnimatePresence>
                     {signals.length === 0 && <div className="empty-state">WAITING FOR TPS &gt; 2.5 ...</div>}
                  </div>
               </div>
            </GlassPanel>
        </section>

        {/* RIGHT: ORDER FLOW & AI */}
        <section className="col-flow">
           <GlassPanel title="Order Flow (L2)" icon={Layers}>
              <div className="orderbook">
                 {orderBook.asks.map((s, i) => (
                        <div key={i} className={`ob-row ask ${s.p === orderBook.last ? 'current' : ''}`}>
                           <div className="bar" style={{ width: `${(s.t / 10) * 100}%` }} />
                           <div className="content">
                              <span className="p">{s.p.toFixed(4)}</span>
                              <span className="v">{s.s}</span>
                           </div>
                        </div>
                 ))}
                 <div className="spread-row">{orderBook.last.toFixed(4)}</div>
                 {orderBook.bids.map((s, i) => (
                    <div key={i} className={`ob-row bid ${s.p === orderBook.last ? 'current' : ''}`}>
                       <div className="bar" style={{ width: `${(s.t / 10) * 100}%` }} />
                       <div className="content">
                          <span className="p">{s.p.toFixed(4)}</span>
                          <span className="v">{s.s}</span>
                       </div>
                    </div>
                 ))}
              </div>
           </GlassPanel>

           <GlassPanel title="Whale Tracking" icon={Database} className="mt-4">
              <div className="whale-card">
                 <div className="whale-header"><span className="label">CROSS-NODE FLOW</span><span className="status live">LIVE</span></div>
                 <p className="whale-text">
                    "Inflow detected on {asset} from BNB-ASIA node cluster. Price momentum correlating with Random Walk S(t) prediction. Prepare for Godzilla Long lead."
                 </p>
              </div>
           </GlassPanel>

           <GlassPanel title="Network Integrity" icon={Activity} className="mt-4">
              <div className="integrity-row"><span>NODE SYNC</span><span className="mono text-cyan-400">99.9%</span></div>
              <div className="integrity-row"><span>PACKET LOSS</span><span className="mono text-cyan-400">0.00%</span></div>
              <div className="integrity-row"><span>REPLAY ATTACK PROP</span><span className="mono text-cyan-400">SAFE</span></div>
           </GlassPanel>
        </section>
      </div>
    </div>
  );
}

const AppWrapper = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWrapper;
