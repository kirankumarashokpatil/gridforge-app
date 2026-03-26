import { MIN_SOC, MAX_SOC } from '../shared/constants.js';

export const ACHIEVEMENTS = [
    // BM mastery
    {
        id: "FIRST_CLEAR", name: "First Blood", emoji: "🎯", desc: "Get your first bid accepted in the BM", col: "#1de98b",
        check: (s) => s.totalAccepted >= 1
    },
    {
        id: "STREAK_5", name: "Hot Streak", emoji: "🔥", desc: "5 consecutive accepted bids", col: "#f5b222",
        check: (s) => s.streak >= 5
    },
    {
        id: "STREAK_10", name: "Unstoppable", emoji: "💎", desc: "10 consecutive accepted bids", col: "#b78bfa",
        check: (s) => s.streak >= 10
    },

    // Revenue milestones
    {
        id: "EARN_500", name: "Profitable Trader", emoji: "💰", desc: "Earn £500 total revenue", col: "#1de98b",
        check: (s) => s.totalRevenue >= 500
    },
    {
        id: "EARN_2000", name: "Market Maker", emoji: "🏦", desc: "Earn £2,000 total revenue", col: "#38c0fc",
        check: (s) => s.totalRevenue >= 2000
    },
    {
        id: "EARN_5000", name: "Whale", emoji: "🐋", desc: "Earn £5,000 total revenue", col: "#b78bfa",
        check: (s) => s.totalRevenue >= 5000
    },

    // Asset-specific
    {
        id: "BATTERY_MASTER", name: "Battery Master", emoji: "🔋", desc: "Operate a battery through 10+ SPs without hitting SoC limits", col: "#1de98b",
        check: (s) => s.assetKind === "soc" && s.totalSPs >= 10 && !s.hitSoCLimit
    },
    {
        id: "WIND_WHISPERER", name: "Wind Whisperer", emoji: "🌬️", desc: "Earn £1,000+ with a wind farm", col: "#a3e635",
        check: (s) => s.assetKey === "WIND" && s.totalRevenue >= 1000
    },
    {
        id: "GAS_KING", name: "Scarcity Shark", emoji: "🦈", desc: "Earn £500+ in a single SP with OCGT", col: "#f0455a",
        check: (s) => s.assetKey === "OCGT" && s.bestSingleSP >= 500
    },
    {
        id: "FLEX_LORD", name: "Flex Lord", emoji: "🏗️", desc: "Accept 15+ bids with DSR", col: "#f5b222",
        check: (s) => s.assetKey === "DSR" && s.totalAccepted >= 15
    },

    // Scenario-specific
    {
        id: "SURVIVE_DUNKEL", name: "Dark Survivor", emoji: "🌑", desc: "Stay profitable during Dunkelflaute", col: "#f0455a",
        check: (s) => s.scenario === "DUNKELFLAUTE" && s.totalRevenue > 0
    },
    {
        id: "SPIKE_RIDER", name: "Spike Rider", emoji: "🚀", desc: "Earn £1,000+ during a Scarcity Event scenario", col: "#f5b222",
        check: (s) => s.scenario === "SPIKE" && s.totalRevenue >= 1000
    },

    // DA market
    {
        id: "DA_WINNER", name: "Forward Thinker", emoji: "📋", desc: "Earn £500+ from Day-Ahead auctions", col: "#f5b222",
        check: (s) => s.daCash >= 500
    },

    // Strategic
    {
        id: "PERFECT_TIMING", name: "Perfect Timing", emoji: "⏱️", desc: "Buy low and sell high within 3 SPs", col: "#38c0fc",
        check: (s) => s.hadBuySellFlip
    },
    {
        id: "SURVIVOR", name: "Grid Guardian", emoji: "🛡️", desc: "Play 20+ SPs without triggering frequency breach", col: "#67e8f9",
        check: (s) => s.totalSPs >= 20 && !s.hadFreqBreach
    },
];

export function buildAchievementStats({ spHistory, cash, daCash, assetKey, assetKind, scenario, soc, freqBreachSec }) {
    const totalSPs = spHistory.length;
    const accepted = spHistory.filter(h => h.accepted);
    const totalAccepted = accepted.length;
    const totalRevenue = cash; // Using cash directly as it now includes settled DA
    const bestSingleSP = accepted.length ? Math.max(...accepted.map(h => h.revenue)) : 0;

    let streak = 0;
    for (let i = spHistory.length - 1; i >= 0; i--) {
        if (spHistory[i].accepted) streak++;
        else break;
    }

    // Dynamic limit check based on shared constants
    const hitSoCLimit = soc <= (MIN_SOC + 1) || soc >= (MAX_SOC - 1);

    const hadBuySellFlip = spHistory.length >= 3 &&
        spHistory.slice(-3).some(h => h.accepted && !h.isShort) &&
        spHistory.slice(-3).some(h => h.accepted && h.isShort);

    return {
        totalSPs, totalAccepted, totalRevenue, bestSingleSP, streak,
        assetKey, assetKind, scenario, daCash, soc,
        hitSoCLimit, hadBuySellFlip,
        hadFreqBreach: freqBreachSec > 0,
    };
}

export function checkAchievements(stats, alreadyEarned) {
    const newlyEarned = [];
    for (const a of ACHIEVEMENTS) {
        if (alreadyEarned.includes(a.id)) continue;
        try { if (a.check(stats)) newlyEarned.push(a); } catch { }
    }
    return newlyEarned;
}
