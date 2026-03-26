import { useState } from 'react';

const f0 = v => Math.round(v).toLocaleString();
const f1 = v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });

/**
 * DA Results Table — shows per-SP auction clearing results.
 * Displays awarded volume, clearing price, Pmax, remaining capacity, and status.
 * 
 * Props:
 *   daAuctionResults: { prices[48], volumes: { pid: [48] }, pmax: { pid: [48] } }
 *   daPositions: number[48] — DA-only awarded volumes (signed)
 *   positions: number[48] — current positions (DA + ID)
 *   pid: string — current player ID
 *   currentSp: number — current SP (1-48)
 *   compact: boolean — if true, show condensed view (nearby SPs only)
 */
export default function DAResultsTable({ daAuctionResults, daPositions, positions, pid, currentSp, compact = true }) {
  const [expanded, setExpanded] = useState(false);

  if (!daAuctionResults || !daAuctionResults.prices) return null;

  const prices = daAuctionResults.prices;
  const myVolumes = daAuctionResults.volumes?.[pid] || new Array(48).fill(0);
  const myPmax = daAuctionResults.pmax?.[pid] || new Array(48).fill(0);

  // Determine which SPs to show
  let spRange;
  if (!compact || expanded) {
    spRange = Array.from({ length: 48 }, (_, i) => i + 1);
  } else {
    // Show ±4 SPs around current, plus any with notable results
    const nearby = new Set();
    for (let i = Math.max(1, currentSp - 3); i <= Math.min(48, currentSp + 4); i++) nearby.add(i);
    // Also include any SP with non-zero volume
    for (let i = 0; i < 48; i++) {
      if (Math.abs(myVolumes[i]) > 0.01) nearby.add(i + 1);
    }
    spRange = [...nearby].sort((a, b) => a - b);
  }

  const getStatus = (vol, pm, price, sp) => {
    const absVol = Math.abs(vol);
    if (pm === 0) return { label: 'OFF', color: '#4d7a96', bg: '#0c1c2a' };
    if (absVol < 0.01) return { label: 'OUT OF $', color: '#f0455a', bg: '#1f070922' };
    if (absVol >= pm * 0.99) return { label: 'FULL', color: '#1de98b', bg: '#1de98b15' };
    return { label: 'PARTIAL', color: '#f5b222', bg: '#f5b22215' };
  };

  const totalAwarded = myVolumes.reduce((s, v) => s + Math.abs(v), 0);
  const totalPmax = myPmax.reduce((s, v) => s + v, 0);
  const totalRemaining = totalPmax - totalAwarded;

  return (
    <div style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#0c1c2a', borderBottom: '1px solid #1a3045' }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: '#f5b222', letterSpacing: 1 }}>DA AUCTION RESULTS</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 8, color: '#4d7a96' }}>Awarded: <b style={{ color: '#1de98b' }}>{f0(totalAwarded)}MW</b></span>
          <span style={{ fontSize: 8, color: '#4d7a96' }}>Remaining: <b style={{ color: '#38c0fc' }}>{f0(totalRemaining)}MW</b></span>
          {compact && (
            <button onClick={() => setExpanded(e => !e)} style={{ padding: '2px 6px', background: '#162c3d', border: '1px solid #1a3045', borderRadius: 3, color: '#4d7a96', fontSize: 7, cursor: 'pointer' }}>
              {expanded ? '▲ Compact' : '▼ All 48 SPs'}
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '40px 60px 55px 55px 55px 60px', gap: 0, padding: '4px 10px', borderBottom: '1px solid #0c1c2a', fontSize: 7, color: '#2a5570', fontWeight: 700, letterSpacing: 0.5 }}>
        <div>SP</div>
        <div>MARKET £</div>
        <div>AWARDED</div>
        <div>PMAX</div>
        <div>REMAINING</div>
        <div>STATUS</div>
      </div>

      {/* Rows */}
      <div style={{ maxHeight: expanded ? 400 : 200, overflowY: 'auto' }}>
        {spRange.map(spNum => {
          const idx = spNum - 1;
          const vol = myVolumes[idx] || 0;
          const absVol = Math.abs(vol);
          const pm = myPmax[idx] || 0;
          const price = prices[idx] || 0;
          const remaining = Math.max(0, pm - absVol);
          const status = getStatus(vol, pm, price, spNum);
          const isCurrent = spNum === currentSp;

          return (
            <div key={spNum} style={{
              display: 'grid', gridTemplateColumns: '40px 60px 55px 55px 55px 60px', gap: 0,
              padding: '3px 10px', borderBottom: '1px solid #0a1420',
              background: isCurrent ? '#162c3d' : 'transparent',
              fontSize: 9, fontFamily: "'JetBrains Mono'",
            }}>
              <div style={{ color: isCurrent ? '#f5b222' : '#4d7a96', fontWeight: isCurrent ? 800 : 400 }}>
                {spNum}{isCurrent ? ' ◄' : ''}
              </div>
              <div style={{ color: '#ddeeff' }}>£{f0(price)}</div>
              <div style={{ color: absVol > 0 ? '#1de98b' : '#4d7a96', fontWeight: absVol > 0 ? 700 : 400 }}>
                {vol < 0 ? '-' : '+'}{f0(absVol)}MW
              </div>
              <div style={{ color: '#4d7a96' }}>{f0(pm)}MW</div>
              <div style={{ color: remaining > 0 ? '#38c0fc' : '#2a5570' }}>{f0(remaining)}MW</div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, background: status.bg, color: status.color, fontWeight: 700 }}>
                  {status.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div style={{ padding: '6px 10px', fontSize: 7.5, color: '#2a5570', borderTop: '1px solid #0c1c2a', lineHeight: 1.5 }}>
        Remaining capacity available for ID / BM trading. Partial = market needed less than your Pmax.
      </div>
    </div>
  );
}
