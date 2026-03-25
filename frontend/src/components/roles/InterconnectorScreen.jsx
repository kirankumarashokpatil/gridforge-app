import React, { useMemo, useState } from 'react';
import SharedLayout from './SharedLayout';
import { ASSETS } from '../../shared/constants';
import MarketOverviewPanel from '../shared/MarketOverviewPanel';

const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function InterconnectorScreen(props) {
  const {
    market, sp, msLeft, tickSpeed, phase,
    cash, daCash,
    assetKey,
    daMyBid, setDaMyBid, daSubmitted, onDaSubmit,
    idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit,
    spContracts, pid, contractPosition,
    bmOrderBook, daOrderBook, idOrderBook,
    simRes,
    currentSp,
    publishedForecast,
    leaderboardData,
    room,
    paused,
    freqBreachSec,
    scenario
  } = props;

  const def = ASSETS[assetKey] || ASSETS.INTERCONNECTOR || ASSETS.BESS_S;
  const currentMkt = ["FORECAST_0", "FORECAST_1", "FORECAST_2", "FORECAST", "DA", "IDA1", "IDA2", "ID", "ID_ROUNDS"].includes(phase) ? market?.forecast : market?.actual;
  const sysDemand = (market?.actual || market?.forecast || {})?.system?.demandMw || 0;
  const sysWind = (market?.actual || market?.forecast || {})?.system?.windMw || 0;
  const sysSolar = (market?.actual || market?.forecast || {})?.system?.solarMw || 0;

  const [tab, setTab] = useState('OVERVIEW');

  const topRight = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{ background: '#0c1c2a', border: '1px solid #1a3045', padding: '4px 8px', borderRadius: 4, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 7.5, color: '#4d7a96' }}>NET POS (SP{sp})</span>
        <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: contractPosition > 0 ? '#1de98b' : contractPosition < 0 ? '#f0455a' : '#ddeeff' }}>
          {contractPosition > 0 ? '+' : ''}{f0(contractPosition)} MW
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, fontSize: 10, alignItems: 'baseline' }}>
        <span style={{ color: '#4d7a96' }}>SYS DMD</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: '#f5b222' }}>{f0(sysDemand)}</span>
        <span style={{ color: '#4d7a96' }}>WIND</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: '#a3e635' }}>{f0(sysWind)}</span>
        <span style={{ color: '#4d7a96' }}>SOLAR</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: '#fbbf24' }}>{f0(sysSolar)}</span>
      </div>
    </div>
  );

  const left = (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ background: '#0c1c2a', border: `1px solid ${def.col || '#1a3045'}55`, borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 10, color: '#4d7a96', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>Asset</div>
        <div style={{ fontSize: 14, fontWeight: 900, color: '#ddeeff' }}>{def.emoji} {def.name}</div>
        <div style={{ fontSize: 9, color: '#4d7a96', marginTop: 8, lineHeight: 1.5 }}>{def.desc}</div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {['OVERVIEW', 'DA', 'ID', 'BM'].map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: tab === k ? '#38c0fc' : '#0c1c2a',
              border: `1px solid ${tab === k ? '#38c0fc' : '#1a3045'}`,
              borderRadius: 8,
              color: tab === k ? '#050e16' : '#4d7a96',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer'
            }}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );

  const price = market?.actual?.price ?? market?.forecast?.price ?? 0;

  const center = useMemo(() => {
    if (tab === 'OVERVIEW') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MarketOverviewPanel market={market} phase={phase} sp={sp} />
          <div style={{ background: '#0c1c2a', border: `1px solid ${def.col || '#1a3045'}33`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: '#4d7a96', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>Cross-Border Flow</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#08141f', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 8, color: '#4d7a96' }}>CONTRACT POSITION</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 900, color: contractPosition > 0 ? '#1de98b' : contractPosition < 0 ? '#f0455a' : '#ddeeff' }}>
                  {contractPosition > 0 ? '+' : ''}{f0(contractPosition)} MW
                </div>
              </div>
              <div style={{ background: '#08141f', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 8, color: '#4d7a96' }}>MARKET PRICE</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 900, color: '#f5b222' }}>£{f0(price)}/MWh</div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (tab === 'DA') {
      return (
        <div style={{ background: '#0c1c2a', border: '1px solid #1a3045', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#4d7a96', fontWeight: 800, textTransform: 'uppercase', marginBottom: 12 }}>Day-Ahead Bid</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 9, color: '#4d7a96', display: 'block', marginBottom: 4 }}>VOLUME (MW)</label>
                <input type="number" value={daMyBid?.mw || ''} onChange={e => setDaMyBid?.(b => ({ ...b, mw: e.target.value }))}
                  style={{ width: '100%', padding: '8px', background: '#08141f', border: '1px solid #1a3045', borderRadius: 6, color: '#ddeeff', fontSize: 12, fontFamily: "'JetBrains Mono'", boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#4d7a96', display: 'block', marginBottom: 4 }}>PRICE (£/MWh)</label>
                <input type="number" value={daMyBid?.price || ''} onChange={e => setDaMyBid?.(b => ({ ...b, price: e.target.value }))}
                  style={{ width: '100%', padding: '8px', background: '#08141f', border: '1px solid #1a3045', borderRadius: 6, color: '#f5b222', fontSize: 12, fontFamily: "'JetBrains Mono'", boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['offer', 'bid'].map(s => (
                <button key={s} onClick={() => setDaMyBid?.(b => ({ ...b, side: s }))}
                  style={{ flex: 1, padding: '6px', background: daMyBid?.side === s ? (s === 'offer' ? '#f0455a' : '#1de98b') : '#08141f', border: `1px solid ${s === 'offer' ? '#f0455a' : '#1de98b'}44`, borderRadius: 6, color: daMyBid?.side === s ? '#fff' : '#4d7a96', fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' }}>
                  {s === 'offer' ? '↑ EXPORT' : '↓ IMPORT'}
                </button>
              ))}
            </div>
            <button onClick={onDaSubmit} disabled={daSubmitted}
              style={{ padding: '10px', background: daSubmitted ? '#0c1c2a' : '#f5b222', border: 'none', borderRadius: 8, color: daSubmitted ? '#4d7a96' : '#050e16', fontWeight: 800, fontSize: 12, cursor: daSubmitted ? 'default' : 'pointer' }}>
              {daSubmitted ? '✓ DA BID SUBMITTED' : 'SUBMIT DA BID'}
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'ID') {
      return (
        <div style={{ background: '#0c1c2a', border: '1px solid #1a3045', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#4d7a96', fontWeight: 800, textTransform: 'uppercase', marginBottom: 12 }}>Intraday Order</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 9, color: '#4d7a96', display: 'block', marginBottom: 4 }}>VOLUME (MW)</label>
                <input type="number" value={idMyOrder?.mw || ''} onChange={e => setIdMyOrder?.(o => ({ ...o, mw: e.target.value }))}
                  style={{ width: '100%', padding: '8px', background: '#08141f', border: '1px solid #1a3045', borderRadius: 6, color: '#ddeeff', fontSize: 12, fontFamily: "'JetBrains Mono'", boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#4d7a96', display: 'block', marginBottom: 4 }}>PRICE (£/MWh)</label>
                <input type="number" value={idMyOrder?.price || ''} onChange={e => setIdMyOrder?.(o => ({ ...o, price: e.target.value }))}
                  style={{ width: '100%', padding: '8px', background: '#08141f', border: '1px solid #1a3045', borderRadius: 6, color: '#38c0fc', fontSize: 12, fontFamily: "'JetBrains Mono'", boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['sell', 'buy'].map(s => (
                <button key={s} onClick={() => setIdMyOrder?.(o => ({ ...o, side: s }))}
                  style={{ flex: 1, padding: '6px', background: idMyOrder?.side === s ? (s === 'sell' ? '#f0455a' : '#1de98b') : '#08141f', border: `1px solid ${s === 'sell' ? '#f0455a' : '#1de98b'}44`, borderRadius: 6, color: idMyOrder?.side === s ? '#fff' : '#4d7a96', fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' }}>
                  {s === 'sell' ? '↑ SELL' : '↓ BUY'}
                </button>
              ))}
            </div>
            <button onClick={onIdSubmit} disabled={idSubmitted}
              style={{ padding: '10px', background: idSubmitted ? '#0c1c2a' : '#38c0fc', border: 'none', borderRadius: 8, color: idSubmitted ? '#4d7a96' : '#050e16', fontWeight: 800, fontSize: 12, cursor: idSubmitted ? 'default' : 'pointer' }}>
              {idSubmitted ? '✓ ID ORDER PLACED' : 'PLACE ID ORDER'}
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'BM') {
      return (
        <div style={{ background: '#0c1c2a', border: '1px solid #1a3045', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#4d7a96', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>BM Order Book</div>
          {bmOrderBook?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
              {bmOrderBook.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: '#08141f', borderRadius: 4 }}>
                  <span style={{ fontSize: 11, color: b.side === 'offer' ? '#f0455a' : '#1de98b', fontWeight: 700 }}>{b.side?.toUpperCase()}</span>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: '#ddeeff' }}>{f0(b.mw)} MW</span>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: '#f5b222' }}>£{f0(b.price)}</span>
                  <span style={{ fontSize: 10, color: '#4d7a96' }}>{b.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#4d7a96', textAlign: 'center', padding: 20 }}>No BM bids yet this SP</div>
          )}
        </div>
      );
    }

    return null;
  }, [tab, market, phase, sp, contractPosition, price, daMyBid, idMyOrder, daSubmitted, idSubmitted, bmOrderBook]);

  return (
    <SharedLayout
      roleName="Interconnector"
      phase={phase}
      sp={sp}
      msLeft={msLeft}
      tickSpeed={tickSpeed}
      market={market}
      paused={paused}
      freqBreachSec={freqBreachSec}
      scenario={scenario}
      room={room}
      cash={cash}
      daCash={daCash}
      leaderboard={leaderboardData}
      publishedForecast={publishedForecast}
      topRight={topRight}
      left={left}
      center={center}
    />
  );
}
