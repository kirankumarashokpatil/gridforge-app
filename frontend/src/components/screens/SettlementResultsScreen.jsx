import React from "react";
import { SP_DURATION_H } from "../../shared/constants.js";

const SP_PER_DAY = 48;

/**
 * SettlementResultsScreen - End of Day Results Table
 * 
 * Shows the complete P&L breakdown for all 48 SPs:
 * - DA Plan vs ID Adjustments
 * - Gate closure times
 * - Promised vs Delivered volumes
 * - Imbalance charges
 * - BM revenues
 * - Total profit for the day
 */

export default function SettlementResultsScreen({
  dayResults,
  gameDay,
  onNextDay,
  assetConfig,
}) {
  if (!dayResults) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Calculating settlement...</div>
      </div>
    );
  }

  const { spResults, totalDaRevenue, totalIdRevenue, totalBmRevenue, totalImbalance, totalProfit } = dayResults;

  // Helper to format time
  const formatTime = (sp) => {
    const startMin = (sp - 1) * 30;  // Bug fix: was sp*30 which shifted all times by 30 minutes
    const h = Math.floor(startMin / 60);
    const m = startMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Helper to format gate closure time
  const formatGateClosure = (sp) => {
    const spStartMin = (sp - 1) * 30;  // Bug fix: same off-by-one correction
    const gateMin = spStartMin - 60; // 1 hour before
    const h = Math.floor(gateMin / 60);
    const m = gateMin % 60;
    const day = h < 0 ? "Day D" : "Day D+1";
    const adjustedH = h < 0 ? 24 + h : h;
    return `${day} ${String(adjustedH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Day {gameDay} Settlement Results</h2>
        <div style={styles.subtitle}>Complete P&L for Tomorrow (Day {gameDay + 1})</div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryPanel}>
        <div style={{...styles.summaryCard, borderColor: '#38c0fc'}}>
          <div style={styles.cardLabel}>DA Revenue</div>
          <div style={{...styles.cardValue, color: '#38c0fc'}}>£{totalDaRevenue.toFixed(0)}</div>
        </div>
        <div style={{...styles.summaryCard, borderColor: '#1de98b'}}>
          <div style={styles.cardLabel}>ID Revenue</div>
          <div style={{...styles.cardValue, color: '#1de98b'}}>£{totalIdRevenue.toFixed(0)}</div>
        </div>
        <div style={{...styles.summaryCard, borderColor: '#b78bfa'}}>
          <div style={styles.cardLabel}>BM Revenue</div>
          <div style={{...styles.cardValue, color: '#b78bfa'}}>£{totalBmRevenue.toFixed(0)}</div>
        </div>
        <div style={{...styles.summaryCard, borderColor: totalImbalance <= 0 ? '#f0455a' : '#1de98b'}}>
          <div style={styles.cardLabel}>Imbalance</div>
          {/* Bug fix: negative imbalance (shortage at SBP) is the bad case — was inverted */}
          <div style={{...styles.cardValue, color: totalImbalance <= 0 ? '#f0455a' : '#1de98b'}}>
            £{totalImbalance.toFixed(0)}
          </div>
        </div>
        <div style={{...styles.summaryCard, borderColor: totalProfit >= 0 ? '#1de98b' : '#f0455a', backgroundColor: totalProfit >= 0 ? 'rgba(29, 233, 139, 0.1)' : 'rgba(240, 69, 90, 0.1)'}}>
          <div style={styles.cardLabel}>TOTAL PROFIT</div>
          <div style={{...styles.cardValue, color: totalProfit >= 0 ? '#1de98b' : '#f0455a', fontSize: '32px'}}>
            £{totalProfit.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Detailed Results Table */}
      <div style={styles.tableContainer}>
        <div style={styles.tableHeader}>
          <div style={styles.colSp}>SP</div>
          <div style={styles.colTime}>Time</div>
          <div style={styles.colGate}>Gate Closure</div>
          <div style={styles.colDa}>DA Plan</div>
          <div style={styles.colId}>ID Adj</div>
          <div style={styles.colContract}>Promised</div>
          <div style={styles.colActual}>Delivered</div>
          <div style={styles.colImb}>Imbalance</div>
          <div style={styles.colBm}>BM £/MWh</div>
          <div style={styles.colCash}>Cash Flow</div>
        </div>
        
        <div style={styles.tableBody}>
          {spResults.map((result) => {
            const cashFlow = result.daRev + result.idRev + result.bmRev + result.imbCharge;
            const isProfit = cashFlow >= 0;
            const isBalanced = Math.abs(result.imbalance) < 0.1;
            
            return (
              <div 
                key={result.sp} 
                style={{
                  ...styles.tableRow,
                  backgroundColor: result.sp % 2 === 0 ? '#1a1a1a' : '#222',
                }}
              >
                <div style={styles.colSp}>{result.sp}</div>
                <div style={styles.colTime}>{formatTime(result.sp)}</div>
                <div style={styles.colGate}>{formatGateClosure(result.sp)}</div>
                <div style={styles.colDa}>{result.daVolume.toFixed(1)}</div>
                <div style={styles.colId}>{result.idAdj > 0 ? '+' : ''}{result.idAdj.toFixed(1)}</div>
                <div style={styles.colContract}>{result.contract.toFixed(1)}</div>
                <div style={styles.colActual}>{result.actual.toFixed(1)}</div>
                <div style={{
                  ...styles.colImb,
                  color: isBalanced ? '#1de98b' : result.imbalance > 0 ? '#f5b222' : '#f0455a'
                }}>
                  {result.imbalance > 0 ? '+' : ''}{result.imbalance.toFixed(1)}
                  {isBalanced && ' ✓'}
                </div>
                <div style={styles.colBm}>£{result.sbp?.toFixed(0) || '??'}</div>
                <div style={{
                  ...styles.colCash,
                  color: isProfit ? '#1de98b' : '#f0455a',
                  fontWeight: 'bold',
                }}>
                  {isProfit ? '+' : ''}£{cashFlow.toFixed(0)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart-style Visualization */}
      <div style={styles.chartSection}>
        <h3 style={styles.chartTitle}>Cumulative Profit Throughout Day</h3>
        <div style={styles.profitBar}>
          {spResults.map((result, idx) => {
            const cumCash = spResults
              .slice(0, idx + 1)
              .reduce((sum, r) => sum + r.daRev + r.idRev + r.bmRev + r.imbCharge, 0);
            const maxProfit = Math.max(...spResults.map((_, i) => 
              spResults.slice(0, i + 1).reduce((s, r) => s + r.daRev + r.idRev + r.bmRev + r.imbCharge, 0)
            ), Math.abs(totalProfit));
            const heightPct = maxProfit > 0 ? (Math.abs(cumCash) / maxProfit) * 100 : 0;
            
            return (
              <div key={idx} style={styles.barContainer}>
                <div 
                  style={{
                    ...styles.bar,
                    height: `${Math.max(heightPct, 5)}%`,
                    backgroundColor: cumCash >= 0 ? '#1de98b' : '#f0455a',
                  }}
                  title={`SP ${idx + 1}: £${cumCash.toFixed(0)}`}
                />
                {idx % 6 === 0 && (
                  <div style={styles.barLabel}>{idx + 1}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={styles.actionPanel}>
        <button style={styles.nextDayBtn} onClick={onNextDay}>
          Start Day {gameDay + 1} DA Auction
        </button>
      </div>

      {/* Performance Notes */}
      <div style={styles.notesPanel}>
        <h4 style={styles.notesTitle}>Performance Summary</h4>
        <ul style={styles.notesList}>
          <li>
            <strong>Balanced Periods:</strong> {spResults.filter(r => Math.abs(r.imbalance) < 0.1).length}/48 
            ({((spResults.filter(r => Math.abs(r.imbalance) < 0.1).length / 48) * 100).toFixed(0)}%)
          </li>
          <li>
            <strong>Over-Delivered:</strong> {spResults.filter(r => r.imbalance > 0.1).length} periods 
            (paid at SSP)
          </li>
          <li>
            <strong>Under-Delivered:</strong> {spResults.filter(r => r.imbalance < -0.1).length} periods 
            (charged at SBP)
          </li>
          <li>
            <strong>Average Imbalance:</strong> {(spResults.reduce((a, r) => a + Math.abs(r.imbalance), 0) / 48).toFixed(2)} MW
          </li>
        </ul>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: '20px',
    maxWidth: '1400px',
    margin: '0 auto',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  loading: {
    textAlign: 'center',
    color: '#888',
    padding: '50px',
    fontSize: '18px',
  },
  header: {
    marginBottom: '20px',
    borderBottom: '2px solid #38c0fc',
    paddingBottom: '15px',
  },
  title: {
    margin: '0 0 8px 0',
    color: '#38c0fc',
    fontSize: '24px',
  },
  subtitle: {
    color: '#888',
    fontSize: '14px',
  },
  summaryPanel: {
    display: 'flex',
    gap: '15px',
    marginBottom: '25px',
    flexWrap: 'wrap',
  },
  summaryCard: {
    flex: '1',
    minWidth: '140px',
    padding: '15px',
    backgroundColor: '#1a1a1a',
    borderRadius: '8px',
    border: '2px solid',
    textAlign: 'center',
  },
  cardLabel: {
    fontSize: '12px',
    color: '#888',
    marginBottom: '8px',
  },
  cardValue: {
    fontSize: '24px',
    fontWeight: 'bold',
  },
  tableContainer: {
    border: '1px solid #444',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '25px',
  },
  tableHeader: {
    display: 'flex',
    backgroundColor: '#222',
    padding: '12px 10px',
    fontWeight: 'bold',
    fontSize: '12px',
    color: '#888',
    borderBottom: '1px solid #444',
  },
  tableBody: {
    maxHeight: '500px',
    overflowY: 'auto',
  },
  tableRow: {
    display: 'flex',
    padding: '8px 10px',
    fontSize: '13px',
    alignItems: 'center',
  },
  colSp: { width: '40px', textAlign: 'center' },
  colTime: { width: '60px', textAlign: 'center' },
  colGate: { width: '130px', textAlign: 'center', fontSize: '11px' },
  colDa: { width: '70px', textAlign: 'center' },
  colId: { width: '70px', textAlign: 'center' },
  colContract: { width: '80px', textAlign: 'center', fontWeight: 'bold' },
  colActual: { width: '80px', textAlign: 'center' },
  colImb: { width: '80px', textAlign: 'center' },
  colBm: { width: '80px', textAlign: 'center' },
  colCash: { width: '100px', textAlign: 'right' },
  chartSection: {
    backgroundColor: '#1a1a1a',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '25px',
  },
  chartTitle: {
    margin: '0 0 15px 0',
    color: '#fff',
    fontSize: '16px',
  },
  profitBar: {
    display: 'flex',
    alignItems: 'flex-end',
    height: '150px',
    gap: '2px',
    padding: '10px',
    backgroundColor: '#222',
    borderRadius: '4px',
  },
  barContainer: {
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    minHeight: '2px',
    borderRadius: '2px',
    transition: 'all 0.3s',
  },
  barLabel: {
    fontSize: '10px',
    color: '#666',
    marginTop: '4px',
  },
  actionPanel: {
    textAlign: 'center',
    padding: '20px',
    borderTop: '2px solid #444',
  },
  nextDayBtn: {
    padding: '18px 40px',
    backgroundColor: '#38c0fc',
    color: '#000',
    border: 'none',
    borderRadius: '10px',
    fontSize: '20px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  notesPanel: {
    backgroundColor: '#1a1a1a',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #333',
  },
  notesTitle: {
    margin: '0 0 12px 0',
    color: '#888',
    fontSize: '14px',
  },
  notesList: {
    margin: 0,
    paddingLeft: '20px',
    color: '#aaa',
    fontSize: '13px',
    lineHeight: '1.8',
  },
};
