import { getNextStates, FSRS_DEFAULT_PARAMS, applyFuzzAndLoadBalance } from '../src/index';
import { Card, State, Rating } from '../src/types';

describe('FSRS getNextStates for New Cards', () => {
  const baseCard: Card = {
    id: 'test-card-new',
    due: new Date(),
    stability: 0,
    difficulty: 5,
    lapses: 0,
    state: State.New,
  };

  it('should handle rating: Good', () => {
    const nextStates = getNextStates(baseCard);
    const expected_s = FSRS_DEFAULT_PARAMS[0] + (Rating.Good - 1) * FSRS_DEFAULT_PARAMS[1];
    expect(nextStates.good.stability).toBeCloseTo(expected_s);
    expect(nextStates.good.difficulty).toBe(5);
    expect(nextStates.good.interval).toBe(Math.round(expected_s));
  });

  it('should handle rating: Again', () => {
    const nextStates = getNextStates(baseCard);
    expect(nextStates.again.stability).toBe(0);
    expect(nextStates.again.difficulty).toBeCloseTo(5 - FSRS_DEFAULT_PARAMS[6] * (Rating.Again - 3));
    expect(nextStates.again.interval).toBe(0);
  });

  it('should handle rating: Hard', () => {
    const nextStates = getNextStates(baseCard);
    const expected_d = 5 - FSRS_DEFAULT_PARAMS[6] * (Rating.Hard - 3);
    expect(nextStates.hard.stability).toBe(0);
    expect(nextStates.hard.difficulty).toBeCloseTo(expected_d);
    expect(nextStates.hard.interval).toBe(0);
  });

  it('should handle rating: Easy', () => {
    const nextStates = getNextStates(baseCard);
    const expected_s = FSRS_DEFAULT_PARAMS[0] + (Rating.Easy - 1) * FSRS_DEFAULT_PARAMS[1];
    const expected_d = 5 - FSRS_DEFAULT_PARAMS[6] * (Rating.Easy - 3);
    expect(nextStates.easy.stability).toBeCloseTo(expected_s);
    expect(nextStates.easy.difficulty).toBeCloseTo(expected_d);
    expect(nextStates.easy.interval).toBe(Math.round(expected_s));
  });
});

describe('FSRS getNextStates for Review Cards', () => {
    const baseCard: Card = {
        id: 'test-card-review',
        due: new Date(),
        stability: 10,
        difficulty: 5,
        lapses: 0,
        state: State.Review,
    };
    const desired_retention = 0.9;
    
    // Helper to calculate expected stability
    const calc_s = (d: number, s: number, r: Rating) => {
        const hard_penalty = r === Rating.Hard ? FSRS_DEFAULT_PARAMS[15] : 1;
        const easy_bonus = r === Rating.Easy ? FSRS_DEFAULT_PARAMS[16] : 1;
        return s * (1 + Math.exp(FSRS_DEFAULT_PARAMS[8]) * (11 - d) * Math.pow(s, -FSRS_DEFAULT_PARAMS[9]) * (Math.exp((1 - r) * FSRS_DEFAULT_PARAMS[10]) - 1) * hard_penalty * easy_bonus);
    };

    // Helper to calculate expected difficulty
    const calc_d = (d: number, r: Rating) => {
        return d - FSRS_DEFAULT_PARAMS[6] * (r - 3);
    }
    
    it('should handle rating: Good', () => {
        const nextStates = getNextStates(baseCard, desired_retention);
        const expected_s = calc_s(baseCard.difficulty, baseCard.stability, Rating.Good);
        const expected_ivl = Math.round(expected_s * (Math.log(desired_retention) / Math.log(0.9)));

        expect(nextStates.good.stability).toBeCloseTo(expected_s);
        expect(nextStates.good.difficulty).toBe(baseCard.difficulty);
        expect(nextStates.good.interval).toBe(expected_ivl);
    });

    it('should handle rating: Hard', () => {
        const nextStates = getNextStates(baseCard, desired_retention);
        const expected_s = calc_s(baseCard.difficulty, baseCard.stability, Rating.Hard);
        const expected_d = calc_d(baseCard.difficulty, Rating.Hard);
        const expected_ivl = Math.round(expected_s * (Math.log(desired_retention) / Math.log(0.9)));

        expect(nextStates.hard.stability).toBeCloseTo(expected_s);
        expect(nextStates.hard.difficulty).toBeCloseTo(expected_d);
        expect(nextStates.hard.interval).toBe(expected_ivl);
    });

    it('should handle rating: Easy', () => {
        const nextStates = getNextStates(baseCard, desired_retention);
        const expected_s = calc_s(baseCard.difficulty, baseCard.stability, Rating.Easy);
        const expected_d = calc_d(baseCard.difficulty, Rating.Easy);
        const expected_ivl = Math.round(expected_s * (Math.log(desired_retention) / Math.log(0.9)));

        expect(nextStates.easy.stability).toBeCloseTo(expected_s);
        expect(nextStates.easy.difficulty).toBeCloseTo(expected_d);
        expect(nextStates.easy.interval).toBe(expected_ivl);
    });

    it('should handle rating: Again (Lapse)', () => {
        const nextStates = getNextStates(baseCard, desired_retention);
        const expected_s = calc_s(baseCard.difficulty, baseCard.stability, Rating.Again);
        const expected_d = calc_d(baseCard.difficulty, Rating.Again);

        expect(nextStates.again.stability).toBeCloseTo(expected_s);
        expect(nextStates.again.difficulty).toBeCloseTo(expected_d);
        expect(nextStates.again.interval).toBe(0); // Lapsed card should have interval reset
    });
});

describe('FSRS getNextStates for Learning Cards', () => {
    const baseCard: Card = {
      id: 'test-card-learning',
      due: new Date(),
      stability: 0.5, // Learning cards have some temporary stability
      difficulty: 5,
      lapses: 0,
      state: State.Learning,
    };
  
    it('should graduate to Review state when rated Good', () => {
      const nextStates = getNextStates(baseCard);
      // Logic for graduating a learning card is similar to a new card's 'Good' rating
      const expected_s = FSRS_DEFAULT_PARAMS[0] + (Rating.Good - 1) * FSRS_DEFAULT_PARAMS[1];

      expect(nextStates.good.stability).toBeCloseTo(expected_s);
      expect(nextStates.good.difficulty).toBe(baseCard.difficulty);
      // The interval should be the first review interval
      expect(nextStates.good.interval).toBe(Math.round(expected_s));
    });
});

describe('FSRS getNextStates for Relearning Cards', () => {
    const baseCard: Card = {
      id: 'test-card-relearning',
      due: new Date(),
      stability: 2, // Stability was lost due to a lapse
      difficulty: 7, // Difficulty increased due to a lapse
      lapses: 1,
      state: State.Relearning,
    };
  
    it('should graduate back to Review state when rated Good', () => {
      const nextStates = getNextStates(baseCard);
      // The logic is the same as graduating a new card
      const expected_s = FSRS_DEFAULT_PARAMS[0] + (Rating.Good - 1) * FSRS_DEFAULT_PARAMS[1];

      expect(nextStates.good.stability).toBeCloseTo(expected_s);
      expect(nextStates.good.difficulty).toBe(baseCard.difficulty);
      expect(nextStates.good.interval).toBe(Math.round(expected_s));
    });
});

describe('applyFuzzAndLoadBalance', () => {
    it('should apply fuzz to the interval', () => {
        const interval = 100;
        const fuzzedInterval = applyFuzzAndLoadBalance(interval);
        
        // Expect the fuzzed interval to be within a reasonable range (e.g., +/- 5% or 10 days)
        // The pseudo-code suggests a fuzz_range of max(2, interval * 0.05)
        const fuzz_range = Math.max(2, Math.round(interval * 0.05));
        const min_expected = interval - fuzz_range;
        const max_expected = interval + fuzz_range;

        expect(fuzzedInterval).toBeGreaterThanOrEqual(min_expected);
        expect(fuzzedInterval).toBeLessThanOrEqual(max_expected);
    });

    it('should not fuzz small intervals (less than 2.5 days)', () => {
      const interval = 2; // Less than 2.5
      const fuzzedInterval = applyFuzzAndLoadBalance(interval);
      expect(fuzzedInterval).toBe(interval); // Should not be fuzzed
    });
});
