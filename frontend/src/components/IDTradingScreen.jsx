import { useState, useMemo } from 'react';
import { 
  isIDGateOpen, 
  getTimeToGateClosure, 
  getGateStatusDisplay, 
  formatPosition,
  formatGateClosureTime
} from '../engine/IDTradingEngine.js';
import { spTime, f0, fpp } from '../shared/utils.js';

/**
 * IDTradingScreen Component
 * 
 * Per-SP Intraday trading interface:
 * - Shows all 48 SPs with DA positions
 * - Each SP has gate closure countdown
 * - Buy/Sell buttons for each open SP
 * - Locked SPs grayed out
 * - Shows current position and profit potential
 */

function SPCard({ 
  sp, 
  daVolume, 
  idTrades,
  currentTimeHour,
  onTrade,
  idPrice,
  isActive = false
}) {
  const gateStatus = getGateStatusDisplay(sp, currentTimeHour);
  const isOpen = gateStatus.canTrade;
  
  // Calculate current position
  const idBuyVol = idTrades
    .filter(t => t.side === 'buy')
    .reduce((sum, t) => sum + t.volumeMW, 0);
  const idSellVol = idTrades
    .filter(t => t.side === 'sell')
    .reduce((sum, t) => sum + t.volumeMW, 0);
  const netPosition = daVolume + idBuyVol - idSellVol;
  
  const positionDisplay = formatPosition(netPosition);
  
  const timeLabel = spTime(sp);
  const spLabel = `SP${sp}`;
  
  return (
    <div style={{
      background: isOpen ? '#0c1c2a' : '#050e16',
      border: `1px solid ${isActive ? '#38c0fc' : isOpen ? '#1a3045' : '#0c1c2a'}`,
      borderLeft: `3px solid ${gateStatus.color}`,
      borderRadius: 6,
      padding: '10px 12px',
      opacity: isOpen ? 1 : 0.6,
      transition: 'all 0.2s'
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ 
            fontFamily: 'JetBrains Mono', 
            fontSize: 13, 
            fontWeight: 800, 
            color: isOpen ? '#ffffff' : '#475569'
          }}>
            {spLabel}
          </span>
          <span style={{ fontSize: 10, color: '#64748b' }}>{timeLabel}</span>
        </div>
        <div style={{
          fontSize: 9,
          fontWeight: 700,
          color: gateStatus.color,
          background: `${gateStatus.color}11`,
          padding: '2px 6px',
          borderRadius: 4
        }}>
          {gateStatus.message}
        </div>
      </div>
      
      {/* Position display */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 10,
        padding: '6px 8px',
        background: '#08141f',
        borderRadius: 4
      }}>
        <div style={{ fontSize: 10, color: '#64748b' }}>Position</div>
        <div style={{ 
          fontSize: 12, 
          fontWeight: 700, 
          color: positionDisplay.color,
          fontFamily: 'JetBrains Mono'
        }}>
          {positionDisplay.emoji} {positionDisplay.text}
        </div>
      </div>
      
      {/* DA position */}
      {daVolume !== 0 && (
        <div style={{ 
          fontSize: 9, 
          color: '#64748b',
          marginBottom: 8,
          textAlign: 'right'
        }}>
          DA: {daVolume > 0 ? '+' : ''}{f0(daVolume)}MW
          {idTrades.length > 0 && (
            <span style={{ color: '#38c0fc' }}>
              {' '}({idTrades.length} ID trade{idTrades.length > 1 ? 's' : ''})
            </span>
          )}
        </div>
      )}
      
      {/* Trade buttons */}
      {isOpen ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            onClick={() => onTrade(sp, 'buy')}
            style={{
              padding: '6px 8px',
              background: '#021520',
              border: '1px solid #38c0fc',
              borderRadius: 4,
              color: '#38c0fc',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.target.style.background = '#38c0fc';
              e.target.style.color = '#022c22';
            }}
            onMouseOut={(e) => {
              e.target.style.background = '#021520';
              e.target.style.color = '#38c0fc';
            }}
          >
            BUY @{f0(idPrice)}
          </button>
          <button
            onClick={() => onTrade(sp, 'sell')}
            style={{
              padding: '6px 8px',
              background: '#1f0709',
              border: '1px solid #f0455a',
              borderRadius: 4,
              color: '#f0455a',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.target.style.background = '#f0455a';
              e.target.style.color = '#1f0709';
            }}
            onMouseOut={(e) => {
              e.target.style.background = '#1f0709';
              e.target.style.color = '#f0455a';
            }}
          >
            SELL @{f0(idPrice)}
          </button>
        </div>
      ) : (
        <div style={{
          padding: '8px',
          background: '#050e16',
          borderRadius: 4,
          textAlign: 'center',
          fontSize: 10,
          color: '#475569',
          fontStyle: 'italic'
        }}>
          {gateStatus.message}
        </div>
      )}
    </div>
  );
}

function TradeModal({ sp, side, onConfirm, onCancel, maxVolume = 50 }) {
  const [volume, setVolume] = useState(5);
  const [price, setPrice] = useState(side === 'buy' ? 60 : 55);
  
  const timeLabel = spTime(sp);
  
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: '#000000cc',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#0c1c2a',
        border: `2px solid ${side === 'buy' ? '#38c0fc' : '#f0455a'}`,
        borderRadius: 12,
        padding: '24px',
        width: 320
      }}>
        <h3 style={{ 
          margin: '0 0 4px 0', 
          fontSize: 16, 
          color: side === 'buy' ? '#38c0fc' : '#f0455a',
          textTransform: 'uppercase'
        }}>
          {side === 'buy' ? 'BUY POWER' : 'SELL POWER'}
        </h3>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 20 }}>
          SP{sp} ({timeLabel}) - Intraday Market
        </div>
        
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 6 }}>
            Volume (MW)
          </label>
          <input
            type="number"
            min={1}
            max={maxVolume}
            value={volume}
            onChange={(e) => setVolume(Math.min(maxVolume, Math.max(1, parseFloat(e.target.value) || 0)))}
            style={{
              width: '100%',
              padding: '10px',
              background: '#08141f',
              border: '1px solid #1a3045',
              borderRadius: 6,
              color: '#ddeeff',
              fontSize: 16,
              fontFamily: 'JetBrains Mono',
              fontWeight: 700,
              boxSizing: 'border-box'
            }}
          />
          <input
            type="range"
            min={1}
            max={maxVolume}
            value={volume}
            onChange={(e) => setVolume(parseInt(e.target.value))}
            style={{ width: '100%', marginTop: 8 }}
          />
        </div>
        
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 6 }}>
            Price (£/MWh)
          </label>
          <input
            type="number"
            min={0}
            max={200}
            value={price}
            onChange={(e) => setPrice(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{
              width: '100%',
              padding: '10px',
              background: '#08141f',
              border: '1px solid #1a3045',
              borderRadius: 6,
              color: '#f5b222',
              fontSize: 16,
              fontFamily: 'JetBrains Mono',
              fontWeight: 700,
              boxSizing: 'border-box'
            }}
          />
        </div>
        
        <div style={{
          background: '#08141f',
          borderRadius: 6,
          padding: '10px',
          marginBottom: 20,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Trade Value</div>
          <div style={{ 
            fontSize: 18, 
            fontWeight: 900, 
            color: side === 'buy' ? '#f0455a' : '#1de98b',
            fontFamily: 'JetBrains Mono'
          }}>
            {side === 'buy' ? '-' : '+'}{fpp(volume * price * 0.5)}
          </div>
          <div style={{ fontSize: 9, color: '#475569' }}>{volume}MW x {price}£/MWh x 0.5h</div>
        </div>
        
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '10px',
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: 6,
              color: '#64748b',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ volume, price })}
            style={{
              flex: 2,
              padding: '10px',
              background: side === 'buy' ? '#38c0fc' : '#f0455a',
              border: 'none',
              borderRadius: 6,
              color: '#050e16',
              fontSize: 12,
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            {side === 'buy' ? 'CONFIRM BUY' : 'CONFIRM SELL'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IDTradingScreen({
  daVolumes = new Array(48).fill(0),
  idTrades = [],
  currentTimeHour = 2,
  onTrade,
  idPrices = new Array(48).fill(55),
  activeSP = null
}) {
  const [modalState, setModalState] = useState(null); // { sp, side }
  
  // Group SPs by gate closure urgency
  const { openSPs, closedSPs, urgentSPs } = useMemo(() => {
    const open = [];
    const closed = [];
    const urgent = [];
    
    for (let sp = 1; sp <= 48; sp++) {
      const hoursLeft = getTimeToGateClosure(sp, currentTimeHour);
      
      if (hoursLeft <= 0) {
        closed.push(sp);
      } else if (hoursLeft <= 0.5) {
        urgent.push(sp);
      } else {
        open.push(sp);
      }
    }
    
    return { openSPs: open, closedSPs: closed, urgentSPs: urgent };
  }, [currentTimeHour]);
  
  const handleTradeClick = (sp, side) => {
    setModalState({ sp, side });
  };
  
  const handleConfirmTrade = ({ volume, price }) => {
    if (modalState) {
      onTrade?.(modalState.sp, modalState.side, volume, price);
      setModalState(null);
    }
  };
  
  // Summary statistics
  const summary = useMemo(() => {
    let totalLong = 0;
    let totalShort = 0;
    let totalIDVolume = 0;
    
    for (let sp = 1; sp <= 48; sp++) {
      const daVol = daVolumes[sp - 1] || 0;
      const spTrades = idTrades.filter(t => t.sp === sp);
      const idBuy = spTrades.filter(t => t.side === 'buy').reduce((s, t) => s + t.volumeMW, 0);
      const idSell = spTrades.filter(t => t.side === 'sell').reduce((s, t) => s + t.volumeMW, 0);
      const net = daVol + idBuy - idSell;
      
      if (net > 0) totalLong += net;
      if (net < 0) totalShort += Math.abs(net);
      totalIDVolume += idBuy + idSell;
    }
    
    return { totalLong, totalShort, totalIDVolume, openGates: openSPs.length };
  }, [daVolumes, idTrades, openSPs]);
  
  return (
    <div style={{
      background: '#050e16',
      border: '1px solid #1a3045',
      borderRadius: 12,
      padding: '20px 24px',
      maxWidth: 900
    }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 800,
          color: '#ffffff',
          letterSpacing: 1
        }}>
          INTRADAY TRADING
        </h2>
        <p style={{
          margin: '4px 0 0 0',
          fontSize: 11,
          color: '#64748b'
        }}>
          Adjust tomorrow's positions SP-by-SP before gate closure
        </p>
      </div>
      
      {/* Summary bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: 20
      }}>
        <div style={{
          background: '#021520',
          border: '1px solid #38c0fc33',
          borderRadius: 8,
          padding: '12px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#38c0fc', fontFamily: 'JetBrains Mono' }}>
            {f0(summary.totalLong)}
          </div>
          <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>Total Long</div>
        </div>
        
        <div style={{
          background: '#1f0709',
          border: '1px solid #f0455a33',
          borderRadius: 8,
          padding: '12px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#f0455a', fontFamily: 'JetBrains Mono' }}>
            {f0(summary.totalShort)}
          </div>
          <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>Total Short</div>
        </div>
        
        <div style={{
          background: '#0c1c2a',
          border: '1px solid #f5b22233',
          borderRadius: 8,
          padding: '12px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#f5b222', fontFamily: 'JetBrains Mono' }}>
            {f0(summary.totalIDVolume)}
          </div>
          <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>ID Volume</div>
        </div>
        
        <div style={{
          background: summary.openGates > 10 ? '#071f13' : '#1f1f09',
          border: `1px solid ${summary.openGates > 10 ? '#1de98b33' : '#f5b22233'}`,
          borderRadius: 8,
          padding: '12px',
          textAlign: 'center'
        }}>
          <div style={{ 
            fontSize: 20, 
            fontWeight: 900, 
            color: summary.openGates > 10 ? '#1de98b' : '#f5b222',
            fontFamily: 'JetBrains Mono' 
          }}>
            {summary.openGates}
          </div>
          <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>Open Gates</div>
        </div>
      </div>
      
      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginBottom: 16,
        fontSize: 10,
        color: '#64748b'
      }}>
        <span><span style={{ color: '#1de98b' }}>&#x25CF;</span> Open</span>
        <span><span style={{ color: '#f5b222' }}>&#x25CF;</span> Urgent (&lt;30m)</span>
        <span><span style={{ color: '#f0455a' }}>&#x25CF;</span> Closed</span>
        <span style={{ marginLeft: 'auto' }}>{urgentSPs.length} urgent - {closedSPs.length} closed</span>
      </div>
      
      {/* SP Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 8,
        maxHeight: 500,
        overflowY: 'auto',
        padding: 4
      }}>
        {/* Urgent SPs first */}
        {urgentSPs.map(sp => (
          <SPCard
            key={sp}
            sp={sp}
            daVolume={daVolumes[sp - 1] || 0}
            idTrades={idTrades.filter(t => t.sp === sp)}
            currentTimeHour={currentTimeHour}
            onTrade={handleTradeClick}
            idPrice={idPrices[sp - 1] || 55}
            isActive={sp === activeSP}
          />
        ))}
        
        {/* Then open SPs */}
        {openSPs.filter(sp => !urgentSPs.includes(sp)).map(sp => (
          <SPCard
            key={sp}
            sp={sp}
            daVolume={daVolumes[sp - 1] || 0}
            idTrades={idTrades.filter(t => t.sp === sp)}
            currentTimeHour={currentTimeHour}
            onTrade={handleTradeClick}
            idPrice={idPrices[sp - 1] || 55}
            isActive={sp === activeSP}
          />
        ))}
        
        {/* Then closed SPs (collapsed) */}
        {closedSPs.map(sp => (
          <SPCard
            key={sp}
            sp={sp}
            daVolume={daVolumes[sp - 1] || 0}
            idTrades={idTrades.filter(t => t.sp === sp)}
            currentTimeHour={currentTimeHour}
            onTrade={handleTradeClick}
            idPrice={idPrices[sp - 1] || 55}
            isActive={sp === activeSP}
          />
        ))}
      </div>
      
      {/* Instructions */}
      <div style={{
        background: '#08141f',
        borderRadius: 8,
        padding: '12px 16px',
        marginTop: 16,
        fontSize: 10,
        color: '#64748b'
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: '#94a3b8' }}>
          How Intraday Trading Works:
        </div>
        <div style={{ marginBottom: 4 }}>
          - <strong style={{ color: '#38c0fc' }}>Gate closures</strong> happen progressively — SP1 closes at 23:00, SP48 at 22:30 tomorrow
        </div>
        <div style={{ marginBottom: 4 }}>
          - <strong style={{ color: '#f5b222' }}>Buy/Sell</strong> per SP to adjust your DA position before each gate closes
        </div>
        <div>
          - After gate closure, your position is <strong>locked</strong> until BM trading opens
        </div>
      </div>
      
      {/* Trade Modal */}
      {modalState && (
        <TradeModal
          sp={modalState.sp}
          side={modalState.side}
          onConfirm={handleConfirmTrade}
          onCancel={() => setModalState(null)}
        />
      )}
    </div>
  );
}
