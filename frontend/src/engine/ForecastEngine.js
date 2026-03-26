/**
 * ForecastEngine.js
 * 
 * Handles generation and publication of standard GB electricity market forecasts.
 * Models Demand, Wind, and Solar over 48 Settlement Periods (SPs).
 * Supports modes:
 *  - 'manual': Instructor draws/modifies curves.
 *  - 'auto': Uses stochastic models to generate forecasts with noise.
 *  - 'mixed': Auto runs but manual overrides lock it.
 */

class ForecastVersion {
    constructor({ author, mode, demand, wind, solar, confidence, note }) {
        this.id = 'v' + Date.now();
        this.author = author;
        this.mode = mode;
        this.timestamp = new Date().toISOString();
        this.demand = demand || Array(48).fill(0);
        this.wind = wind || Array(48).fill(0);
        this.solar = solar || Array(48).fill(0);
        this.confidence = confidence || Array(48).fill(0); // 1-sigma uncertainty band
        this.note = note || '';
    }
}

class ForecastEngine {
    constructor(sp_per_day = 48) {
        this.sp_per_day = sp_per_day;
        this.published = null;      // The current shared version
        this.history = [];          // Archive of published versions
        this.mode = 'auto';         // 'manual' | 'auto' | 'mixed'
        this.manual_lock = false;   // If true, auto-update is paused
        this.skill_level = 0.9;     // 0.0 to 1.0; defines accuracy in auto model

        // Default base parameters for generation
        this.params = {
            base_demand: 35000, // MW
            peak_multiplier: 1.3,
            wind_capacity: 25000,
            solar_capacity: 15000,
            noise_level: 0.03 // 3%
        };
    }

    // Set simulation operating mode
    setMode(newMode) {
        if (['manual', 'auto', 'mixed'].includes(newMode)) {
            this.mode = newMode;
            // If switching explicitly to manual, lock the auto overrides
            this.manual_lock = (newMode === 'manual');
        }
    }

    // Publish a custom/drawn forecast (Manual mode)
    createManual(author, demand_ts, wind_ts, solar_ts, confidence_ts = null, note = "") {
        if (this.mode === 'auto') {
            console.warn("ForecastEngine is in 'auto' mode. Switch to 'manual' or 'mixed' to publish manual versions.");
            // We still allow it but usually UI warns.
        }

        // In Mixed mode, a manual publish engages the lock
        if (this.mode === 'mixed') {
            this.manual_lock = true;
        }

        const version = new ForecastVersion({
            author,
            mode: 'manual',
            demand: demand_ts,
            wind: wind_ts,
            solar: solar_ts,
            confidence: confidence_ts || this._defaultConfidence(demand_ts),
            note
        });

        this._publish(version);
        return version;
    }

    // Publish automatically based on internal models (Auto mode)
    autoGenerate(noise_multiplier = 1.0) {
        const demand = this._modelDemand(noise_multiplier);
        const wind = this._modelWind(noise_multiplier);
        const solar = this._modelSolar(noise_multiplier);
        const confidence = demand.map(d => d * this.params.noise_level * (1.1 - this.skill_level));

        const version = new ForecastVersion({
            author: 'NESO_AI',
            mode: 'auto',
            demand,
            wind,
            solar,
            confidence,
            note: 'Auto-generated DA forecast'
        });

        this._publish(version);
        return version;
    }

    // Inject a sudden change (Shock event)
    injectShock(shock_type, modifier_pct) {
        if (!this.published) {
            console.warn("Cannot inject shock without a published baseline.");
            return;
        }

        // Deep copy current version
        const newDemand = [...this.published.demand];
        const newWind = [...this.published.wind];
        const newSolar = [...this.published.solar];

        // Apply modifier
        for (let i = 0; i < this.sp_per_day; i++) {
            if (shock_type === 'wind_drop') newWind[i] *= (1 + modifier_pct);
            if (shock_type === 'demand_spike') newDemand[i] *= (1 + modifier_pct);
        }

        const version = new ForecastVersion({
            author: 'Instructor (System Override)',
            mode: 'manual',
            demand: newDemand,
            wind: newWind,
            solar: newSolar,
            confidence: [...this.published.confidence],
            note: `SYSTEM SHOCK: ${shock_type}`
        });

        this._publish(version);
        return version;
    }

    // Expose specific version
    getVersion(id) {
        return this.history.find(v => v.id === id);
    }

    // Internal publisher
    _publish(version) {
        this.published = version;
        this.history.push(version);
        // Sliding window: keep only last 50 versions to prevent memory bloat
        if (this.history.length > 50) {
            this.history.shift();
        }
        // Ideally this emits an event that socket/MarketEngine listens to.
        console.log(`[ForecastEngine] Published new version ${version.id} by ${version.author}`);
    }

    generateInitialDraft(currentSp) {
        return {
            demand: this._modelDemand(1.0),
            wind: this._modelWind(1.0),
            solar: this._modelSolar(1.0),
            margin: Array(48).fill(4000)
        };
    }

    // --- Internal Stochastic Models (per SP) ---

    _modelDemand(noise_mult) {
        // Basic double peak (morning, evening)
        const curve = [];
        for (let sp = 0; sp < this.sp_per_day; sp++) {
            let val = this.params.base_demand;
            const hour = sp / 2;

            // Morning peak (07:00 - 09:00)
            if (hour >= 7 && hour <= 9) val *= 1.15;
            // Evening peak (17:00 - 19:00)
            if (hour >= 17 && hour <= 19) val *= this.params.peak_multiplier;
            // Night drop (00:00 - 05:00)
            if (hour >= 0 && hour <= 5) val *= 0.7;

            const noise = 1 + (Math.random() - 0.5) * this.params.noise_level * noise_mult;
            curve.push(+(val * noise).toFixed(1));
        }
        return curve;
    }

    _modelWind(noise_mult) {
        const curve = [];
        // Wind often correlated, AR(1) proxy
        let current_yield = 0.4 + (Math.random() * 0.2); // 40-60% base
        for (let sp = 0; sp < this.sp_per_day; sp++) {
            current_yield += (Math.random() - 0.5) * 0.1 * noise_mult; // walk
            current_yield = Math.max(0, Math.min(1, current_yield)); // clamp
            curve.push(+(this.params.wind_capacity * current_yield).toFixed(1));
        }
        return curve;
    }

    _modelSolar(noise_mult) {
        const curve = [];
        for (let sp = 0; sp < this.sp_per_day; sp++) {
            const hour = sp / 2;
            let val = 0;
            if (hour > 6 && hour < 18) {
                // Bell curve peaking at 12:00
                const dist = Math.abs(12 - hour);
                val = Math.max(0, 1 - (dist / 6));
            }
            const noise = 1 + (Math.random() - 0.5) * (this.params.noise_level * 2) * noise_mult;
            curve.push(+(this.params.solar_capacity * val * noise).toFixed(1));
        }
        return curve;
    }

    _defaultConfidence(demand) {
        return demand.map(d => +(d * this.params.noise_level).toFixed(1));
    }
}

export default ForecastEngine;
export { ForecastVersion };
