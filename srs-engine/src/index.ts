import { Card, NextStates, Rating, State, DeckConfig, FSRSParameters } from './types';

export * from './types';

export const FSRS_DEFAULT_PARAMS_FULL: Readonly<number[]> = [
    0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 
    1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61, // Original 17
    0.5, 0.1, 1.0, 0.5 // w[17] - w[20] from ts-fsrs default
];

const S_MIN = 0.1; // Minimum stability from ts-fsrs constant.ts
const S_MAX = 36500; // Maximum stability, based on ts-fsrs default

const GRADUATING_INTERVAL_DAYS = 1; // Default for graduating from learning
const EASY_INTERVAL_DAYS = 4; // Default for easy rating on new cards

export function date_diff(dateA: Date, dateB: Date, unit: 'days'): number { // Exported for use in tests
    const diff_ms = dateA.getTime() - dateB.getTime();
    if (unit === 'days') {
        return diff_ms / (24 * 60 * 60 * 1000);
    }
    return diff_ms; // default to milliseconds if unit not recognized
}

export const DAY_IN_MS = 24 * 60 * 60 * 1000; // Exported for use in tests

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

// --- FSRS core functions adapted from ts-fsrs/packages/fsrs/src/algorithm.ts ---

function computeDecayFactor(w: Readonly<number[]>) {
    const decay = -w[20]; 
    const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1.0;
    return { decay, factor: +factor.toFixed(8) };
}

function forgetting_curve(w: Readonly<number[]>, elapsed_days: number, stability: number): number {
    const { decay, factor } = computeDecayFactor(w);
    return +Math.pow(1 + (factor * elapsed_days) / stability, decay).toFixed(8);
}

function init_stability(g: Rating, w: Readonly<number[]>): number {
    return Math.max(w[g - 1], S_MIN);
}

function init_difficulty(g: Rating, w: Readonly<number[]>): number {
    const d = w[4] - Math.exp((g - 1) * w[5]) + 1;
    return +d.toFixed(8);
}

function linear_damping(delta_d: number, old_d: number): number {
    return +(delta_d * (10 - old_d)) / 9;
}

function mean_reversion(init: number, current: number, w: Readonly<number[]>): number {
    return +(w[7] * init + (1 - w[7]) * current).toFixed(8);
}

function next_difficulty(d: number, g: Rating, w: Readonly<number[]>, init_d_easy: number): number {
    const delta_d = -w[6] * (g - 3);
    const next_d_calc = d + linear_damping(delta_d, d);
    return clamp(mean_reversion(init_d_easy, next_d_calc, w), 1, 10);
}

function next_recall_stability(d: number, s: number, r: number, g: Rating, w: Readonly<number[]>): number {
    const hard_penalty = Rating.Hard === g ? w[15] : 1;
    const easy_bound = Rating.Easy === g ? w[16] : 1;
    return +clamp(
      s *
        (1 +
          Math.exp(w[8]) *
            (11 - d) *
            Math.pow(s, -w[9]) *
            (Math.exp((1 - r) * w[10]) - 1) *
            hard_penalty *
            easy_bound),
      S_MIN,
      S_MAX
    ).toFixed(8);
}

function next_forget_stability(d: number, s: number, r: number, w: Readonly<number[]>): number {
    return +clamp(
        w[11] *
        Math.pow(d, -w[12]) *
        (Math.pow(s + 1, w[13]) - 1) *
        Math.exp((1 - r) * w[14]),
        S_MIN,
        S_MAX
    ).toFixed(8);
}

function calculate_interval_modifier(request_retention: number, w: Readonly<number[]>): number {
    if (request_retention <= 0 || request_retention > 1) {
      throw new Error('Requested retention rate should be in the range (0,1]')
    }
    const { decay, factor } = computeDecayFactor(w);
    return +((Math.pow(request_retention, 1 / decay) - 1) / factor).toFixed(8);
}

function next_interval(s: number, request_retention: number, w: Readonly<number[]>, maximum_interval: number): number {
    const intervalModifier = calculate_interval_modifier(request_retention, w);
    const newInterval = Math.min(
      Math.max(1, Math.round(s * intervalModifier)),
      maximum_interval
    );
    return newInterval;
}


// --- Main getNextStates function refactored to use ts-fsrs logic ---
export function getNextStates(card: Card, config: DeckConfig, now: Date): NextStates {
    const w = config.fsrsParams.w;
    const { learningSteps, relearningSteps } = config;
    const request_retention = config.fsrsParams.request_retention;
    const maximum_interval = config.fsrsParams.maximum_interval;

    const init_d_easy = init_difficulty(Rating.Easy, w); // Helper for next_difficulty

    // Elapsed days 't' (delta_t)
    const elapsed_days = card.last_review ? date_diff(now, card.last_review, 'days') : 0;
    
    // Retrievability 'r'
    const r_val = card.state === State.Review ? forgetting_curve(w, elapsed_days, card.stability) : 0;

    // --- Handling New cards ---
    if (card.state === State.New) {
        return {
            again: { stability: init_stability(Rating.Again, w), difficulty: next_difficulty(card.difficulty, Rating.Again, w, init_d_easy), interval: learningSteps[0] },
            hard: { stability: init_stability(Rating.Hard, w), difficulty: next_difficulty(card.difficulty, Rating.Hard, w, init_d_easy), interval: learningSteps[0] },
            good: { stability: init_stability(Rating.Good, w), difficulty: next_difficulty(card.difficulty, Rating.Good, w, init_d_easy), interval: learningSteps[0] },
            easy: { stability: init_stability(Rating.Easy, w), difficulty: next_difficulty(card.difficulty, Rating.Easy, w, init_d_easy), interval: EASY_INTERVAL_DAYS },
        };
    }

    // --- Handling Learning and Relearning states ---
    // These states are step-based.
    
    if (card.state === State.Learning || card.state === State.Relearning) {
        const steps = card.state === State.Learning ? learningSteps : relearningSteps;
        
        // Again/Hard: reset to first step
        const again_interval = steps[0];
        const hard_interval = again_interval;

        // Good: advance step or graduate
        const next_step_index_good = card.step + 1;
        let good_interval: number;
        if (next_step_index_good < steps.length) {
            good_interval = steps[next_step_index_good];
        } else {
            good_interval = GRADUATING_INTERVAL_DAYS; // Graduates to review
        }

        // Easy: graduate immediately
        const easy_interval = EASY_INTERVAL_DAYS;
        
        const d_again = next_difficulty(card.difficulty, Rating.Again, w, init_d_easy);
        const d_hard = next_difficulty(card.difficulty, Rating.Hard, w, init_d_easy);
        const d_good = next_difficulty(card.difficulty, Rating.Good, w, init_d_easy);
        const d_easy = next_difficulty(card.difficulty, Rating.Easy, w, init_d_easy);

        const s_again_graduating = init_stability(Rating.Again, w);
        const s_hard_graduating = init_stability(Rating.Hard, w);
        const s_good_graduating = init_stability(Rating.Good, w);
        const s_easy_graduating = init_stability(Rating.Easy, w);

        return {
            again: { stability: s_again_graduating, difficulty: d_again, interval: again_interval },
            hard: { stability: s_hard_graduating, difficulty: d_hard, interval: hard_interval },
            good: { stability: s_good_graduating, difficulty: d_good, interval: good_interval },
            easy: { stability: s_easy_graduating, difficulty: d_easy, interval: easy_interval },
        };
    }
    
    // --- State.Review (main FSRS calculation for established cards) ---
    const { stability, difficulty, last_review } = card;
    const delta_t = last_review ? date_diff(now, last_review, 'days') : 0.01; // Actual elapsed time in days

    const d_again = next_difficulty(difficulty, Rating.Again, w, init_d_easy);
    const d_hard = next_difficulty(difficulty, Rating.Hard, w, init_d_easy);
    const d_good = next_difficulty(difficulty, Rating.Good, w, init_d_easy);
    const d_easy = next_difficulty(difficulty, Rating.Easy, w, init_d_easy);

    // Calculate next stabilities based on r_val
    const s_again = next_forget_stability(difficulty, stability, r_val, w);
    const s_hard = next_recall_stability(difficulty, stability, r_val, Rating.Hard, w);
    const s_good = next_recall_stability(difficulty, stability, r_val, Rating.Good, w);
    const s_easy = next_recall_stability(difficulty, stability, r_val, Rating.Easy, w);

    // Calculate intervals
    const ivl_again = relearningSteps[0]; // Lapse puts card into relearning
    const ivl_hard = next_interval(s_hard, request_retention, w, maximum_interval);
    const ivl_good = next_interval(s_good, request_retention, w, maximum_interval);
    const ivl_easy = next_interval(s_easy, request_retention, w, maximum_interval);

    return {
        again: { stability: s_again, difficulty: d_again, interval: ivl_again },
        hard: { stability: s_hard, difficulty: d_hard, interval: ivl_hard },
        good: { stability: s_good, difficulty: d_good, interval: ivl_good },
        easy: { stability: s_easy, difficulty: d_easy, interval: ivl_easy },
    };
}

export function applyFuzzAndLoadBalance(interval: number): number {
    if (interval < 2.5) {
        return Math.round(interval);
    }
    const fuzz_range = Math.max(2, Math.round(interval * 0.05));
    const min_ivl = Math.max(2, Math.round(interval - fuzz_range));
    const max_ivl = Math.round(interval + fuzz_range);
    
    if (min_ivl > max_ivl) {
        return Math.round(interval); 
    }

    return Math.floor(Math.random() * (max_ivl - min_ivl + 1)) + min_ivl;
}