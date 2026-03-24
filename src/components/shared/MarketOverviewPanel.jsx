import React from 'react';
import DayAheadCurve from './DayAheadCurve';
import IntradayDepthChart from './IntradayDepthChart';
import SupplyDemandCurve from './SupplyDemandCurve';

export default function MarketOverviewPanel({ phase, daOrderBook, daResult, idOrderBook, spContracts, currentSp, msLeft, tickSpeed, bmOrderBook, market, simRes }) {

    // Map new phase names to display groups
    const isAuctionPhase = ["DA", "IDA1", "IDA2"].includes(phase);
    const isIdPhase = phase === "ID" || phase === "ID_ROUNDS";
    const isBmPhase = ["BM", "BM_OPEN", "BM_CLEAR", "BM_CLOSE", "SP_SETTLED", "REALTIME"].includes(phase);
    const isSettled = ["SETTLED", "RESULTS"].includes(phase);
    const isWaitPhase = ["FORECAST", "FORECAST_0", "FORECAST_1", "FORECAST_2"].includes(phase);

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            {isAuctionPhase && (
                <DayAheadCurve
                    bids={Object.values(daOrderBook || {})}
                    marketForecast={market?.forecast}
                    daResult={daResult}
                />
            )}

            {isIdPhase && (
                <IntradayDepthChart
                    idOrderBook={idOrderBook}
                    spContracts={spContracts}
                    currentSp={currentSp}
                    msLeft={msLeft}
                    tickSpeed={tickSpeed}
                />
            )}

            {(isBmPhase || isResultPhase) && (
                <SupplyDemandCurve
                    allBids={Object.values(bmOrderBook || {})}
                    market={isBmPhase ? market?.actual : (market?.actual || market?.forecast)}
                    simRes={simRes}
                />
            )}

            {/* FORECAST / unknown phase placeholder */}
            {isWaitPhase && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, color: "#a78bfa", fontSize: 12, flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 28 }}>🔮</div>
                    <div style={{ fontWeight: 700 }}>FORECAST PHASE</div>
                    <div style={{ fontSize: 10, color: "#4d7a96" }}>NESO is preparing market forecasts for all 48 SPs...</div>
                </div>
            )}

            {!isAuctionPhase && !isIdPhase && !isBmPhase && !isResultPhase && !isWaitPhase && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, color: "#4d7a96", fontSize: 10 }}>
                    <div>Awaiting Market Phase...</div>
                </div>
            )}
        </div>
    );
}
