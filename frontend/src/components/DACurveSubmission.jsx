import { useState, useMemo } from 'react';
import { 
  DEFAULT_DA_SEGMENTS, 
  validateFullCurve, 
  previewCurveRevenue, 
  createSegment, 
  updateSegment, 
  deleteSegment, 
  addSegment,
  getVolumeAtPrice 
} from '../engine/DACurveEngine.js';
import { spTime, f0, fpp } from '../shared/utils.js';

/**
 * DACurveSubmission Component
 * 
 * EPEX/N2EX-style Day-Ahead curve input:
 * - Piecewise linear segments
 * - Each segment: SP range, Pmin/Pmax, Price1/Price2
 * - Preview chart showing 48-SP curve
 * - Revenue estimate based on forecast prices
 * - One "Submit Full Curve" button
 */

const COLORS = ['#38c0fc', '#1de98b', '#f5b222', '#f0455a', '#b78bfa', '#fb923c'];

function SegmentEditor({ segment, index, onUpdate, onDelete }) {
  const color = COLORS[index % COLORS.length];
  
  return (
    <div style={{ 
      background: '#0c1c2a', 
      border: `1px solid ${color}44`, 
      borderRadius: 8, 
      padding: '12px 16px',
      marginBottom: 8 
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ 
            width: 12, height: 12, borderRadius: '50%', 
            background: color,
            boxShadow: `0 0 8px ${color}`
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color }}>Segment {index + 1}</span>
        </div>
        <input
          type="text"
          value={segment.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid #1a3045',
            color: '#94a3b8',
            fontSize: 11,
            width: 120,
            textAlign: 'right'
          }}
        />
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 40px', gap: 8, alignItems: 'center' }}>
        {/* SP Range */}
        <div>
          <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 4 }}>SP Range</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              min={1}
              max={48}
              value={segment.spStart}
              onChange={(e) => onUpdate({ spStart: parseInt(e.target.value) || 1 })}
              style={{
                width: 45,
                padding: '4px 6px',
                background: '#08141f',
                border: '1px solid #1a3045',
                borderRadius: 4,
                color: '#ddeeff',
                fontSize: 12,
                fontFamily: 'JetBrains Mono'
              }}
            />
            <span style={{ color: '#475569', fontSize: 11 }}>-</span>
            <input
              type="number"
              min={1}
              max={48}
              value={segment.spEnd}
              onChange={(e) => onUpdate({ spEnd: parseInt(e.target.value) || 48 })}
              style={{
                width: 45,
                padding: '4px 6px',
                background: '#08141f',
                border: '1px solid #1a3045',
                borderRadius: 4,
                color: '#ddeeff',
                fontSize: 12,
                fontFamily: 'JetBrains Mono'
              }}
            />
          </div>
        </div>
        
        {/* Pmin/Pmax */}
        <div>
          <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 4 }}>Volume (MW)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              min={0}
              value={segment.pmin}
              onChange={(e) => onUpdate({ pmin: parseFloat(e.target.value) || 0 })}
              style={{
                width: 50,
                padding: '4px 6px',
                background: '#08141f',
                border: '1px solid #1a3045',
                borderRadius: 4,
                color: '#38c0fc',
                fontSize: 12,
                fontFamily: 'JetBrains Mono'
              }}
              placeholder="Pmin"
            />
            <span style={{ color: '#475569', fontSize: 11 }}>to</span>
            <input
              type="number"
              min={0}
              value={segment.pmax}
              onChange={(e) => onUpdate({ pmax: parseFloat(e.target.value) || 0 })}
              style={{
                width: 50,
                padding: '4px 6px',
                background: '#08141f',
                border: '1px solid #1a3045',
                borderRadius: 4,
                color: '#1de98b',
                fontSize: 12,
                fontFamily: 'JetBrains Mono'
              }}
              placeholder="Pmax"
            />
          </div>
        </div>
        
        {/* Price1/Price2 */}
        <div>
          <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 4 }}>Price (£/MWh)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              min={0}
              max={1000}
              value={segment.price1}
              onChange={(e) => onUpdate({ price1: parseFloat(e.target.value) || 0 })}
              style={{
                width: 50,
                padding: '4px 6px',
                background: '#08141f',
                border: '1px solid #1a3045',
                borderRadius: 4,
                color: '#f5b222',
                fontSize: 12,
                fontFamily: 'JetBrains Mono'
              }}
              placeholder="£1"
            />
            <span style={{ color: '#475569', fontSize: 11 }}>to</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={segment.price2}
              onChange={(e) => onUpdate({ price2: parseFloat(e.target.value) || 0 })}
              style={{
                width: 50,
                padding: '4px 6px',
                background: '#08141f',
                border: '1px solid #1a3045',
                borderRadius: 4,
                color: '#f5b222',
                fontSize: 12,
                fontFamily: 'JetBrains Mono'
              }}
              placeholder="£2"
            />
          </div>
        </div>
        
        {/* Mini preview of the curve shape */}
        <div>
          <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 4 }}>Slope</label>
          <div style={{ 
            width: 60, 
            height: 30, 
            background: '#08141f',
            borderRadius: 4,
            position: 'relative'
          }}>
            {/* Simple line from (price1, pmin) to (price2, pmax) */}
            <svg width="60" height="30" style={{ position: 'absolute', top: 0, left: 0 }}>
              <line
                x1="5"
                y1={25 - (segment.pmin / Math.max(segment.pmax, 1)) * 20}
                x2="55"
                y2={25 - (segment.pmax / Math.max(segment.pmax, 1)) * 20}
                stroke={color}
                strokeWidth="2"
              />
            </svg>
          </div>
        </div>
        
        {/* Delete button */}
        <button
          onClick={onDelete}
          style={{
            width: 32,
            height: 32,
            background: '#1f0709',
            border: '1px solid #f0455a44',
            borderRadius: 6,
            color: '#f0455a',
            cursor: 'pointer',
            fontSize: 14
          }}
          title="Delete segment"
        >
          X
        </button>
      </div>
    </div>
  );
}

function CurveChart({ segments, forecastPrices }) {
  const width = 600;
  const height = 150;
  const padding = { top: 10, right: 10, bottom: 30, left: 50 };
  
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Calculate max volume for scaling
  const maxVolume = Math.max(...segments.map(s => s.pmax), 100);
  
  // Generate points for the curve
  const points = [];
  for (let sp = 1; sp <= 48; sp++) {
    const price = forecastPrices?.[sp - 1] || 55;
    let volume = 0;
    
    for (const seg of segments) {
      if (sp >= seg.spStart && sp <= seg.spEnd) {
        // Linear interpolation
        const priceRange = seg.price2 - seg.price1;
        const volRange = seg.pmax - seg.pmin;
        if (Math.abs(priceRange) < 0.001) {
          volume = price >= seg.price1 ? seg.pmax : seg.pmin;
        } else {
          const slope = volRange / priceRange;
          volume = seg.pmin + (price - seg.price1) * slope;
          volume = Math.max(seg.pmin, Math.min(seg.pmax, volume));
        }
        break;
      }
    }
    
    points.push({
      sp,
      volume,
      x: padding.left + ((sp - 1) / 47) * chartWidth,
      y: padding.top + chartHeight - (Math.abs(volume) / maxVolume) * chartHeight
    });
  }
  
  // Create path
  const pathD = points.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');
  
  return (
    <svg width={width} height={height} style={{ background: '#08141f', borderRadius: 8 }}>
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map(pct => (
        <line
          key={`h-${pct}`}
          x1={padding.left}
          y1={padding.top + chartHeight * (1 - pct/100)}
          x2={width - padding.right}
          y2={padding.top + chartHeight * (1 - pct/100)}
          stroke="#1a3045"
          strokeWidth="1"
          strokeDasharray="2,2"
        />
      ))}
      
      {/* X-axis labels (every 6 SPs) */}
      {[1, 7, 13, 19, 25, 31, 37, 43].map(sp => (
        <text
          key={`label-${sp}`}
          x={padding.left + ((sp - 1) / 47) * chartWidth}
          y={height - 8}
          fill="#64748b"
          fontSize="9"
          textAnchor="middle"
        >
          {spTime(sp)}
        </text>
      ))}
      
      {/* Y-axis label */}
      <text
        x={15}
        y={height / 2}
        fill="#64748b"
        fontSize="9"
        textAnchor="middle"
        transform={`rotate(-90, 15, ${height/2})`}
      >
        MW
      </text>
      
      {/* Volume bars (one per SP) */}
      {points.map((p, i) => (
        <rect
          key={`bar-${i}`}
          x={p.x - 3}
          y={p.y}
          width={6}
          height={padding.top + chartHeight - p.y}
          fill={p.volume > 0 ? '#38c0fc88' : '#f0455a88'}
          rx={1}
        />
      ))}
      
      {/* Line connecting points */}
      <path
        d={pathD}
        fill="none"
        stroke="#1de98b"
        strokeWidth="2"
      />
    </svg>
  );
}

export default function DACurveSubmission({ 
  onSubmit, 
  forecastPrices = new Array(48).fill(55),
  initialSegments = DEFAULT_DA_SEGMENTS,
  initialBlocks = [],
  assetMaxMW = 100,
  daSubmitted = false
}) {
  const [segments, setSegments] = useState(initialSegments.map((s, i) => ({
    ...s,
    id: s.id || `seg_${Date.now()}_${i}`
  })));
  const [validation, setValidation] = useState({ valid: true, errors: [], isComplete: true });
  const [showPreview, setShowPreview] = useState(true);
  const [blocks, setBlocks] = useState(
    (initialBlocks || []).map((b, i) => ({
      id: b.id || `blk_${Date.now()}_${i}`,
      spStart: Math.max(1, Math.min(48, Number(b.spStart || 1))),
      spEnd: Math.max(1, Math.min(48, Number(b.spEnd || 2))),
      mw: Math.max(0, Number(b.mw || 0)),
      price: Number(b.price || 50),
      side: b.side === 'buy' ? 'buy' : 'sell',
      name: b.name || `Block ${i + 1}`,
    }))
  );
  
  // Scale Pmax to asset capacity
  const scaledSegments = useMemo(() => {
    return segments.map(s => ({
      ...s,
      pmax: Math.min(s.pmax, assetMaxMW)
    }));
  }, [segments, assetMaxMW]);
  
  // Validate on changes
  useMemo(() => {
    const result = validateFullCurve(segments);
    setValidation(result);
  }, [segments]);
  
  // Calculate preview
  const preview = useMemo(() => {
    return previewCurveRevenue(scaledSegments, forecastPrices);
  }, [scaledSegments, forecastPrices]);
  
  const handleUpdateSegment = (id, updates) => {
    setSegments(prev => updateSegment(prev, id, updates));
  };
  
  const handleDeleteSegment = (id) => {
    setSegments(prev => deleteSegment(prev, id));
  };
  
  const handleAddSegment = () => {
    const newSeg = createSegment(1, 48, 0, 50, 40, 60, `Segment ${segments.length + 1}`);
    setSegments(prev => addSegment(prev, newSeg));
  };
  
  const handleSubmit = () => {
    if (!validation.valid) return;
    const validBlocks = blocks
      .filter(b => b.mw > 0 && b.spStart >= 1 && b.spEnd <= 48 && b.spStart <= b.spEnd)
      .map(b => ({
        id: b.id,
        spStart: Number(b.spStart),
        spEnd: Number(b.spEnd),
        mw: Number(b.mw),
        price: Number(b.price),
        side: b.side,
        name: b.name,
      }));
    onSubmit({ segments: scaledSegments, blocks: validBlocks });
  };

  const handleAddBlock = () => {
    setBlocks(prev => ([
      ...prev,
      {
        id: `blk_${Date.now()}_${prev.length + 1}`,
        spStart: 1,
        spEnd: 2,
        mw: 10,
        price: 55,
        side: 'sell',
        name: `Block ${prev.length + 1}`,
      }
    ]));
  };

  const updateBlock = (id, patch) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  };

  const deleteBlock = (id) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
  };
  
  return (
    <div style={{ 
      background: '#050e16', 
      border: '1px solid #1a3045',
      borderRadius: 12,
      padding: '20px 24px',
      maxWidth: 700
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ 
            margin: 0, 
            fontSize: 16, 
            fontWeight: 800, 
            color: '#ffffff',
            letterSpacing: 1 
          }}>
            DAY-AHEAD CURVE SUBMISSION
          </h2>
          <p style={{ 
            margin: '4px 0 0 0', 
            fontSize: 11, 
            color: '#64748b' 
          }}>
            Submit full 48-SP curve (EPEX format: Pmin/Pmax, Price1/Price2)
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#1de98b', fontFamily: 'JetBrains Mono' }}>
            {preview.totalRevenue > 0 ? '+' : ''}{fpp(preview.totalRevenue)}
          </div>
          <div style={{ fontSize: 9, color: '#64748b' }}>Expected Revenue</div>
        </div>
      </div>
      
      {/* Validation errors */}
      {validation.errors.length > 0 && (
        <div style={{ 
          background: '#1f0709', 
          border: '1px solid #f0455a44',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16
        }}>
          <div style={{ fontSize: 11, color: '#f0455a', fontWeight: 700, marginBottom: 8 }}>
            VALIDATION ERRORS
          </div>
          {validation.errors.map((err, i) => (
            <div key={i} style={{ fontSize: 10, color: '#f0455aaa', marginBottom: 4 }}>
              - {err}
            </div>
          ))}
        </div>
      )}
      
      {/* Uncovered SPs warning */}
      {!validation.isComplete && (
        <div style={{ 
          background: '#1f1f09', 
          border: '1px solid #f5b22244',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16
        }}>
          <div style={{ fontSize: 11, color: '#f5b222', fontWeight: 700 }}>
            Uncovered SPs: {validation.uncoveredSPs?.join(', ')}
          </div>
          <div style={{ fontSize: 10, color: '#f5b222aa', marginTop: 4 }}>
            You have gaps in your curve. Add segments to cover all 48 SPs.
          </div>
        </div>
      )}
      
      {/* Curve preview toggle */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setShowPreview(!showPreview)}
          style={{
            background: showPreview ? '#0c1c2a' : 'transparent',
            border: '1px solid #1a3045',
            borderRadius: 6,
            padding: '6px 12px',
            color: showPreview ? '#38c0fc' : '#64748b',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </button>
      </div>
      
      {/* Chart preview */}
      {showPreview && (
        <div style={{ marginBottom: 20 }}>
          <CurveChart segments={scaledSegments} forecastPrices={forecastPrices} />
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: '#64748b' }}>
            <span style={{ color: '#38c0fc' }}>Buy/Chg volumes shown</span>
            <span>Based on forecast prices</span>
          </div>
        </div>
      )}
      
      {/* Segment editors */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ 
          fontSize: 10, 
          color: '#64748b', 
          fontWeight: 700, 
          letterSpacing: 1,
          marginBottom: 12,
          textTransform: 'uppercase'
        }}>
          Curve Segments
        </div>
        
        {segments.map((seg, i) => (
          <SegmentEditor
            key={seg.id}
            segment={seg}
            index={i}
            onUpdate={(updates) => handleUpdateSegment(seg.id, updates)}
            onDelete={() => handleDeleteSegment(seg.id)}
          />
        ))}
        
        <button
          onClick={handleAddSegment}
          style={{
            width: '100%',
            padding: '10px',
            background: '#08141f',
            border: '2px dashed #1a3045',
            borderRadius: 8,
            color: '#64748b',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => {
            e.target.style.borderColor = '#38c0fc';
            e.target.style.color = '#38c0fc';
          }}
          onMouseOut={(e) => {
            e.target.style.borderColor = '#1a3045';
            e.target.style.color = '#64748b';
          }}
        >
          + Add Segment
        </button>
      </div>

      {/* Optional block orders */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ 
          fontSize: 10, 
          color: '#64748b', 
          fontWeight: 700, 
          letterSpacing: 1,
          marginBottom: 10,
          textTransform: 'uppercase'
        }}>
          Block Orders (All-or-Nothing)
        </div>

        {blocks.map((b) => (
          <div key={b.id} style={{
            background: '#0b1722',
            border: '1px solid #1a3045',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 8,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 90px 90px 80px 80px 1fr 28px', gap: 8, alignItems: 'center' }}>
              <select
                value={b.side}
                onChange={(e) => updateBlock(b.id, { side: e.target.value })}
                style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 4, color: '#ddeeff', fontSize: 11, padding: '4px 6px' }}
              >
                <option value="sell">SELL</option>
                <option value="buy">BUY</option>
              </select>
              <input
                type="number"
                min={1}
                max={48}
                value={b.spStart}
                onChange={(e) => updateBlock(b.id, { spStart: Number(e.target.value || 1) })}
                style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 4, color: '#ddeeff', fontSize: 11, padding: '4px 6px' }}
                placeholder="SP start"
              />
              <input
                type="number"
                min={1}
                max={48}
                value={b.spEnd}
                onChange={(e) => updateBlock(b.id, { spEnd: Number(e.target.value || 1) })}
                style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 4, color: '#ddeeff', fontSize: 11, padding: '4px 6px' }}
                placeholder="SP end"
              />
              <input
                type="number"
                min={0}
                step={1}
                value={b.mw}
                onChange={(e) => updateBlock(b.id, { mw: Number(e.target.value || 0) })}
                style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 4, color: '#ddeeff', fontSize: 11, padding: '4px 6px' }}
                placeholder="MW"
              />
              <input
                type="number"
                step={1}
                value={b.price}
                onChange={(e) => updateBlock(b.id, { price: Number(e.target.value || 0) })}
                style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 4, color: '#ddeeff', fontSize: 11, padding: '4px 6px' }}
                placeholder="£/MWh"
              />
              <input
                type="text"
                value={b.name}
                onChange={(e) => updateBlock(b.id, { name: e.target.value })}
                style={{ background: '#08141f', border: '1px solid #1a3045', borderRadius: 4, color: '#94a3b8', fontSize: 11, padding: '4px 6px' }}
                placeholder="Block name"
              />
              <button
                onClick={() => deleteBlock(b.id)}
                style={{ background: 'transparent', border: 'none', color: '#f0455a', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                title="Delete block"
              >
                ×
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 9, color: '#64748b' }}>
              AON block: either fully accepted across SP {b.spStart}-{b.spEnd}, or fully rejected.
            </div>
          </div>
        ))}

        <button
          onClick={handleAddBlock}
          style={{
            width: '100%',
            padding: '8px',
            background: '#08141f',
            border: '1px dashed #1a3045',
            borderRadius: 8,
            color: '#64748b',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + Add Block Order
        </button>
      </div>
      
      {/* Legend */}
      <div style={{ 
        background: '#08141f',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 20,
        fontSize: 10,
        color: '#64748b'
      }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: '#94a3b8' }}>
          How DA Curves Work:
        </div>
        <div style={{ marginBottom: 4 }}>
          - <strong style={{ color: '#38c0fc' }}>Pmin/Pmax:</strong> Volume range (0 to max MW)
        </div>
        <div style={{ marginBottom: 4 }}>
          - <strong style={{ color: '#f5b222' }}>Price1/Price2:</strong> Price range (£/MWh)
        </div>
        <div>
          - Auction extracts your volume where market clearing price intersects your slope
        </div>
        <div style={{ marginTop: 4 }}>
          - Optional blocks are all-or-nothing across their SP range
        </div>
      </div>
      
      {/* Last-submitted indicator */}
      {daSubmitted && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#071f13', border: '1px solid #1de98b44',
          borderRadius: 6, padding: '6px 12px', marginBottom: 10,
          fontSize: 11, color: '#1de98b'
        }}>
          <span>✓</span>
          <span>Curve submitted — you can update until gate closure</span>
        </div>
      )}
      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!validation.valid}
        style={{
          width: '100%',
          padding: '14px',
          background: validation.valid 
            ? 'linear-gradient(135deg, #1de98b, #059669)' 
            : '#1a3045',
          border: 'none',
          borderRadius: 8,
          color: validation.valid ? '#022c22' : '#4d7a96',
          fontSize: 14,
          fontWeight: 900,
          cursor: validation.valid ? 'pointer' : 'not-allowed',
          letterSpacing: 1,
          fontFamily: 'Outfit',
          boxShadow: validation.valid ? '0 4px 14px #1de98b44' : 'none'
        }}
      >
        {validation.valid 
          ? (daSubmitted ? 'UPDATE CURVE' : 'SUBMIT FULL CURVE TO AUCTION')
          : 'FIX ERRORS TO SUBMIT'}
      </button>
    </div>
  );
}
