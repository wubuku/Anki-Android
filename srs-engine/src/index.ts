import { Card, NextStates, Rating, State } from './types';

export * from './types';

// Default parameters from PWA_PLAN_v3.md
export const FSRS_DEFAULT_PARAMS = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];

// Helper functions based on FSRS formulas
function next_difficulty(d: number, r: Rating): number {
    const new_d = d - FSRS_DEFAULT_PARAMS[6] * (r - 3);
    const constrained_d = Math.min(Math.max(new_d, 1), 10);
    return parseFloat(constrained_d.toFixed(2));
}

function next_stability(d: number, s: number, r: Rating): number {
    const hard_penalty = r === Rating.Hard ? FSRS_DEFAULT_PARAMS[15] : 1;
    const easy_bonus = r === Rating.Easy ? FSRS_DEFAULT_PARAMS[16] : 1;
    return s * (1 + Math.exp(FSRS_DEFAULT_PARAMS[8]) * (11 - d) * Math.pow(s, -FSRS_DEFAULT_PARAMS[9]) * (Math.exp((1 - r) * FSRS_DEFAULT_PARAMS[10]) - 1) * hard_penalty * easy_bonus);
}


export function getNextStates(card: Card, desired_retention: number = 0.9): NextStates {
  if (card.state === State.New || card.state === State.Learning || card.state === State.Relearning) {
    const s_good = FSRS_DEFAULT_PARAMS[0] + (Rating.Good - 1) * FSRS_DEFAULT_PARAMS[1];
    const s_easy = FSRS_DEFAULT_PARAMS[0] + (Rating.Easy - 1) * FSRS_DEFAULT_PARAMS[1];

    // For learning/relearning cards, 'Again' and 'Hard' could be handled differently, 
    // e.g., by resetting to a specific learning step.
    // For now, we simplify and treat it like a new card's graduation.
    return {
        again: { stability: 0, difficulty: next_difficulty(card.difficulty, Rating.Again), interval: 0 },
        hard: { stability: 0, difficulty: next_difficulty(card.difficulty, Rating.Hard), interval: 0 },
        good: { stability: s_good, difficulty: next_difficulty(card.difficulty, Rating.Good), interval: Math.round(s_good) },
        easy: { stability: s_easy, difficulty: next_difficulty(card.difficulty, Rating.Easy), interval: Math.round(s_easy) },
    };
  }

  if (card.state === State.Review) {
    const { stability, difficulty } = card;
    const s_again = next_stability(difficulty, stability, Rating.Again);
    const s_hard = next_stability(difficulty, stability, Rating.Hard);
    const s_good = next_stability(difficulty, stability, Rating.Good);
    const s_easy = next_stability(difficulty, stability, Rating.Easy);

    const retention_term = Math.log(desired_retention) / Math.log(0.9);
    const ivl_hard = Math.round(s_hard * retention_term);
    const ivl_good = Math.round(s_good * retention_term);
    const ivl_easy = Math.round(s_easy * retention_term);

    return {
        again: { stability: s_again, difficulty: next_difficulty(difficulty, Rating.Again), interval: 0 },
        hard: { stability: s_hard, difficulty: next_difficulty(difficulty, Rating.Hard), interval: ivl_hard },
        good: { stability: s_good, difficulty: next_difficulty(difficulty, Rating.Good), interval: ivl_good },
        easy: { stability: s_easy, difficulty: next_difficulty(difficulty, Rating.Easy), interval: ivl_easy },
    };
  }

  // This should not be reached if all states are handled.
  // Return a default value as a fallback.
  return {
    again: { stability: 0, difficulty: 0, interval: 0 },
    hard: { stability: 0, difficulty: 0, interval: 0 },
    good: { stability: 0, difficulty: 0, interval: 0 },
    easy: { stability: 0, difficulty: 0, interval: 0 },
  };
}

export function applyFuzzAndLoadBalance(interval: number): number {
    if (interval < 2.5) {
        return interval;
    }
    // 简化版 Fuzz: 在一个小的范围内随机选择
    const fuzz_range = Math.max(2, Math.round(interval * 0.05));
    const min_ivl = Math.max(2, Math.round(interval - fuzz_range));
    const max_ivl = Math.round(interval + fuzz_range);
    
    // Ensure min_ivl is not greater than max_ivl
    if (min_ivl > max_ivl) {
        return interval; 
    }

    // Generate a random integer within the range [min_ivl, max_ivl]
    return Math.floor(Math.random() * (max_ivl - min_ivl + 1)) + min_ivl;
}
