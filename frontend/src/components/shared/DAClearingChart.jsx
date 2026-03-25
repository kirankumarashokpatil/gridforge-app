import { useState, useMemo } from 'react';
import { spTime, f0 } from '../../shared/utils.js';

/**
 * DAClearingChart — Visual "Your Offer vs Cleared" chart for DA/IDA results.
 *
 * Shows a 48-SP dual-layer bar chart:
 *   - Background bar: your offered capacity (Pmax)
 *   - Foreground bar: your awarded volume
 *   - Line overlay: clearing price per SP
 *   - Hover tooltip with full SP details
 *
 * Props:
 *   daAuctionResults: { prices[48], volumes: { pid: [48] }, pmax: { pid: [48] } }
 *   pid: string — current player ID
 *   currentSp: number — highlight current SP
 *   height?: number — chart height (default 180)
 */
export default function DAClearingChart({ daAuctionResults, pid, currentSp, height = 180 }) {
  const [hoverSp, setHoverSp] = useState(null);

  const data = useMemo(() => {
    if (!daAuctionResults?.prices) return null;

    const prices = daAuctionResults.prices;
    const myVolumes = daAuctionResults.volumes?.[pid] || new Array(48).fill(0);
    const myPmax = daAuctionResults.pmax?.[pid] || new Array(48).fill(0);

    const maxVol = Math.max(...myPmax, ...myVolumes.map(Math.abs), 10);
    const maxPrice = Math.max(...prices.filter(Boolean), 80);
    const minPrice = Math.min(...prices.filter(p => p > 0), 20);

    let totalAwarded = 0;
    let totalRevenue = 0;
    let spsAwarded = 0;

    const sps = [];
    for (let i = 0; i < 48; i++) {
      const vol = Math.abs(myVolumes[i] || 0);
      const pm = myPmax[i] || 0;
      const price = prices[i] || 0;
      const side = (myVolumes[i] || 0) >= 0 ? 'bid' : 'offer';
      totalAwarded += vol;
      totalRevenue += vol * price * 0.5; // SP_DURATION_H = 0.5
      if (vol > 0.01) spsAwarded++;
      sps.push({ sp: i + 1, vol, pmax: pm, price, side });
    }

    return { sps, maxVol, maxPrice, minPrice, totalAwarded, totalRevenue, spsAwarded };
  }, [daAuctionResults, pid]);

  if (!data) return null;

  const W = 600;
  const H = height;
  const pad = { top: 20, right: 50, bottom: 28, left: 45 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const barW = Math.max(2, (cw / 48) - 1.5);

  const xOfSp = (sp) => pad.left + ((sp - 1) / 47) * cw;
  const yOfVol = (v) => pad.top + ch - (v / data.maxVol) * ch;
  const yOfPrice = (p) => {
    const range = data.maxPrice - data.minPrice || 1;
    return pad.top + ch - ((p - data.minPrice) / range) * ch;
  };

  // Price line path
  const pricePath = data.sps
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOfSp(s.sp)} ${yOfPrice(s.price)}`)
    .join(' ');

  const hd = hoverSp ? data.sps[hoverSp - 1] : null;

  return (
    <div style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#0c1c2a', borderBottom: '1px solid #1a3045' }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: '#f5b222', letterSpacing: 1 }}>YOUR OFFER vs CLEARED</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: '#4d7a96' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 1, background: '#1a3045' }} />
            Offered
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: '#4d7a96' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 1, background: '#1de98b' }} />
            Awarded
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: '#4d7a96' }}>
            <span style={{ display: 'inline-block', width: 16, height: 2, borderRadius: 1, background: '#f5b222' }} />
            Clearing £
          </span>
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 16, padding: '6px 12px', borderBottom: '1px solid #0c1c2a', fontSize: 9 }}>
        <span style={{ color: '#4d7a96' }}>Awarded: <b style={{ color: '#1de98b' }}>{f0(data.totalAwarded)} MW</b> across <b style={{ color: '#1de98b' }}>{data.spsAwarded}</b> SPs</span>
        <span style={{ color: '#4d7a96' }}>Est. Revenue: <b style={{ color: data.totalRevenue >= 0 ? '#1de98b' : '#f0455a' }}>£{f0(Math.abs(data.totalRevenue))}</b></span>
      </div>

      {/* Chart */}
      <div style={{ position: 'relative' }}>
        <svg width={W} height={H} style={{ display: 'block' }} viewBox={`0 0 ${W} ${H}`}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => (
            <line
              key={`g-${pct}`}
              x1={pad.left} y1={pad.top + ch * (1 - pct)}
              x2={W - pad.right} y2={pad.top + ch * (1 - pct)}
              stroke="#0c1c2a" strokeWidth="1"
            />
          ))}

          {/* Y-axis labels (volume) */}
          {[0, 0.5, 1].map(pct => (
            <text key={`yl-${pct}`} x={pad.left - 4} y={pad.top + ch * (1 - pct) + 3}
              fill="#2a5570" fontSize="8" textAnchor="end" fontFamily="JetBrains Mono">
              {f0(data.maxVol * pct)}
            </text>
          ))}
          <text x={8} y={pad.top + ch / 2} fill="#2a5570" fontSize="8"
            textAnchor="middle" transform={`rotate(-90, 8, ${pad.top + ch / 2})`}>
            MW
          </text>

          {/* Y-axis labels (price, right side) */}
          {[0, 0.5, 1].map(pct => {
            const p = data.minPrice + (data.maxPrice - data.minPrice) * pct;
            return (
              <text key={`pr-${pct}`} x={W - pad.right + 4} y={pad.top + ch * (1 - pct) + 3}
                fill="#6b5c00" fontSize="8" textAnchor="start" fontFamily="JetBrains Mono">
                £{f0(p)}
              </text>
            );
          })}

          {/* Bars per SP */}
          {data.sps.map(s => {
            const x = xOfSp(s.sp) - barW / 2;
            const isCurrent = s.sp === currentSp;
            const isHover = s.sp === hoverSp;

            return (
              <g key={s.sp}>
                {/* Background: Pmax (offered capacity) */}
                {s.pmax > 0 && (
                  <rect
                    x={x} y={yOfVol(s.pmax)}
                    width={barW} height={Math.max(0, pad.top + ch - yOfVol(s.pmax))}
                    fill={isCurrent ? '#1a3045' : '#111e2b'}
                    rx={1}
                  />
                )}
                {/* Foreground: Awarded volume */}
                {s.vol > 0.01 && (
                  <rect
                    x={x} y={yOfVol(s.vol)}
                    width={barW} height={Math.max(0, pad.top + ch - yOfVol(s.vol))}
                    fill={s.side === 'offer' ? '#1de98b' : '#38c0fc'}
                    opacity={isHover ? 1 : 0.75}
                    rx={1}
                  />
                )}
                {/* Current SP marker */}
                {isCurrent && (
                  <line x1={xOfSp(s.sp)} y1={pad.top - 2} x2={xOfSp(s.sp)} y2={pad.top + ch}
                    stroke="#f5b222" strokeWidth="1" strokeDasharray="3,2" opacity={0.5} />
                )}
                {/* Hover target (invisible rect for mouse events) */}
                <rect
                  x={x - 1} y={pad.top}
                  width={barW + 2} height={ch}
                  fill="transparent"
                  onMouseEnter={() => setHoverSp(s.sp)}
                  onMouseLeave={() => setHoverSp(null)}
                  style={{ cursor: 'crosshair' }}
                />
              </g>
            );
          })}

          {/* Price line */}
          <path d={pricePath} fill="none" stroke="#f5b222" strokeWidth="1.5" opacity={0.8} />

          {/* Price dots at key SPs */}
          {data.sps.filter((_, i) => i % 6 === 0).map(s => (
            <circle key={`pd-${s.sp}`} cx={xOfSp(s.sp)} cy={yOfPrice(s.price)}
              r={2.5} fill="#f5b222" />
          ))}

          {/* X-axis labels */}
          {[1, 7, 13, 19, 25, 31, 37, 43, 48].map(sp => (
            <text key={`xl-${sp}`} x={xOfSp(sp)} y={H - 6}
              fill="#2a5570" fontSize="8" textAnchor="middle" fontFamily="JetBrains Mono">
              {spTime(sp)}
            </text>
          ))}

          {/* Hover crosshair and tooltip */}
          {hd && (
            <>
              <line x1={xOfSp(hd.sp)} y1={pad.top} x2={xOfSp(hd.sp)} y2={pad.top + ch}
                stroke="#ddeeff" strokeWidth="0.5" strokeDasharray="2,2" />
            </>
          )}
        </svg>

        {/* Tooltip overlay */}
        {hd && (
          <div style={{
            position: 'absolute',
            left: Math.min(xOfSp(hd.sp) + 8, W - 140),
            top: 15,
            background: '#0c1c2a',
            border: '1px solid #1a3045',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 9,
            color: '#ddeeff',
            pointerEvents: 'none',
            zIndex: 10,
            minWidth: 120,
            boxShadow: '0 4px 12px #00000088',
          }}>
            <div style={{ fontWeight: 800, color: hd.sp === currentSp ? '#f5b222' : '#ddeeff', marginBottom: 4 }}>
              SP {hd.sp} — {spTime(hd.sp)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 8px' }}>
              <span style={{ color: '#4d7a96' }}>Clearing £</span>
              <span style={{ fontWeight: 700, color: '#f5b222', fontFamily: "'JetBrains Mono'" }}>£{f0(hd.price)}/MWh</span>
              <span style={{ color: '#4d7a96' }}>Offered</span>
              <span style={{ fontFamily: "'JetBrains Mono'" }}>{f0(hd.pmax)} MW</span>
              <span style={{ color: '#4d7a96' }}>Awarded</span>
              <span style={{ fontWeight: 700, color: hd.vol > 0 ? '#1de98b' : '#4d7a96', fontFamily: "'JetBrains Mono'" }}>
                {hd.vol > 0.01 ? `${f0(hd.vol)} MW` : '—'}
              </span>
              <span style={{ color: '#4d7a96' }}>Fill %</span>
              <span style={{ fontFamily: "'JetBrains Mono'", color: hd.pmax > 0 ? (hd.vol / hd.pmax > 0.9 ? '#1de98b' : '#f5b222') : '#4d7a96' }}>
                {hd.pmax > 0 ? `${Math.round(hd.vol / hd.pmax * 100)}%` : '—'}
              </span>
              <span style={{ color: '#4d7a96' }}>Revenue</span>
              <span style={{ fontWeight: 700, color: '#1de98b', fontFamily: "'JetBrains Mono'" }}>
                £{f0(hd.vol * hd.price * 0.5)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
