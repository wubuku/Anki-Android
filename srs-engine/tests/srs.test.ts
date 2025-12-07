/// <reference types="jest" />
import { describe, expect, it } from '@jest/globals';
import { DAY_IN_MS, FSRS_DEFAULT_PARAMS_FULL, applyFuzzAndLoadBalance, getNextStates } from '../src/index';
import { Card, DeckConfig, Rating, State } from '../src/types';

const defaultConfig: DeckConfig = {
    learningSteps: [60, 600], // 1m, 10m in seconds
    relearningSteps: [600], // 10m in seconds
    fsrsParams: {
        request_retention: 0.9,
        maximum_interval: 36500,
        w: FSRS_DEFAULT_PARAMS_FULL,
    }
};

const now = new Date(); // Current time for the test run

describe('FSRS getNextStates', () => {

    describe('for New Cards', () => {
        const baseCard: Card = {
            id: 'test-card-new', due: new Date(), stability: 0, difficulty: 5, lapses: 0, state: State.New, step: 0,
        };

        it('should enter first learning step when rated Good', () => {
            const nextStates = getNextStates(baseCard, defaultConfig, now);
            // Expected values based on the FSRS logic
            const expected_s = Math.max(FSRS_DEFAULT_PARAMS_FULL[Rating.Good - 1], 0.1); // init_stability
            const expected_d = 1; // Simplified init_difficulty for now, needs exact calculation

            expect(nextStates.good.interval).toBe(defaultConfig.learningSteps[0]);
            expect(nextStates.good.stability).toBeCloseTo(expected_s);
            // expect(nextStates.good.difficulty).toBeCloseTo(expected_d); // Difficulty also needs exact check
        });

        it('should graduate immediately when rated Easy', () => {
            const nextStates = getNextStates(baseCard, defaultConfig, now);
            const easyIntervalDays = 4;
            expect(nextStates.easy.interval).toBe(easyIntervalDays);
        });

        it('should restart learning when rated Again', () => {
            const nextStates = getNextStates(baseCard, defaultConfig, now);
            expect(nextStates.again.interval).toBe(defaultConfig.learningSteps[0]);
        });
    });

    describe('for Learning Cards', () => {
        const learningCardStep0: Card = {
            id: 'test-card-learning-0', due: new Date(), stability: 0, difficulty: 5, lapses: 0, state: State.Learning, step: 0,
        };
        const learningCardStep1: Card = {
            ...learningCardStep0, id: 'test-card-learning-1', step: 1,
        }

        it("should advance to the next learning step when rated Good", () => {
            const nextStates = getNextStates(learningCardStep0, defaultConfig, now);
            expect(nextStates.good.interval).toBe(defaultConfig.learningSteps[1]);
        });

        it("should graduate when rated Good on the last learning step", () => {
            const nextStates = getNextStates(learningCardStep1, defaultConfig, now);
            const graduatingIntervalDays = 1;
            expect(nextStates.good.interval).toBe(graduatingIntervalDays);
        });

        it("should reset to the first step when rated Again", () => {
            const nextStates = getNextStates(learningCardStep1, defaultConfig, now);
            expect(nextStates.again.interval).toBe(defaultConfig.learningSteps[0]);
        });
    });

    describe('for Review Cards', () => {
        const baseCard: Card = {
            id: 'test-card-review', due: new Date(), last_review: new Date(now.getTime() - 10 * DAY_IN_MS), // Last reviewed 10 days ago
            stability: 10, difficulty: 5, lapses: 0, state: State.Review, step: 0,
        };

        it('should enter relearning step and decrease stability when rated Again (Lapse)', () => {
            const nextStates = getNextStates(baseCard, defaultConfig, now);
            expect(nextStates.again.interval).toBe(defaultConfig.relearningSteps[0]);
            expect(nextStates.again.stability).toBeLessThan(baseCard.stability);
            expect(nextStates.again.difficulty).toBeGreaterThan(baseCard.difficulty);
        });
    });

    describe('FSRS: Review Timing (delta_t)', () => {
        // Card was last reviewed 10 days ago. Planned interval was 10 days.
        // So, it's DUE today (now).
        const onTimeCard: Card = {
            id: 'on-time-card',
            due: now,
            last_review: new Date(now.getTime() - 10 * DAY_IN_MS),
            stability: 10, difficulty: 5, lapses: 0, state: State.Review, step: 0,
        };
        const onTimeExpectedStabilityGood = getNextStates(onTimeCard, defaultConfig, now).good.stability;

        // Card reviewed 3 days early: actual delta_t is 7 days instead of 10.
        const earlyCard: Card = {
            ...onTimeCard,
            id: 'early-card',
            last_review: new Date(now.getTime() - 7 * DAY_IN_MS), // Reviewed 7 days after last review
            due: new Date(now.getTime() + 3 * DAY_IN_MS), // Planned due was 3 days in future
        };
        const earlyNow = new Date(onTimeCard.last_review!.getTime() + 7 * DAY_IN_MS); // Review happens 7 days after last_review

        // Card reviewed 3 days late: actual delta_t is 13 days instead of 10.
        const lateCard: Card = {
            ...onTimeCard,
            id: 'late-card',
            last_review: new Date(now.getTime() - 13 * DAY_IN_MS), // Reviewed 13 days after last review
            due: new Date(now.getTime() - 3 * DAY_IN_MS), // Planned due was 3 days in past
        };
        const lateNow = new Date(onTimeCard.last_review!.getTime() + 13 * DAY_IN_MS); // Review happens 13 days after last_review


        it('should calculate next states for an on-time review', () => {
            const states = getNextStates(onTimeCard, defaultConfig, now);
            expect(states.good.stability).toBeCloseTo(onTimeExpectedStabilityGood);
        });

        it('should grant a smaller stability increase for an early review', () => {
            const earlyStates = getNextStates(earlyCard, defaultConfig, earlyNow);
            expect(earlyStates.good.stability).toBeLessThan(onTimeExpectedStabilityGood);
        });

        it('should grant a larger stability increase for a late review', () => {
            const lateStates = getNextStates(lateCard, defaultConfig, lateNow);
            expect(lateStates.good.stability).toBeGreaterThan(onTimeExpectedStabilityGood);
        });
    });
});

describe('applyFuzzAndLoadBalance', () => {
    it('should apply fuzz to a large interval', () => {
        const interval = 100;
        const results = Array.from({ length: 100 }, () => applyFuzzAndLoadBalance(interval));
        const fuzz_range = Math.max(2, Math.round(interval * 0.05));
        const min_expected = interval - fuzz_range;
        const max_expected = interval + fuzz_range;
        results.forEach(fuzzedInterval => {
            expect(fuzzedInterval).toBeGreaterThanOrEqual(min_expected);
            expect(fuzzedInterval).toBeLessThanOrEqual(max_expected);
        });
        const uniqueResults = new Set(results);
        expect(uniqueResults.size).toBeGreaterThan(1);
    });

    it('should not fuzz small intervals (< 2.5 days)', () => {
      const interval = 2;
      const fuzzedInterval = applyFuzzAndLoadBalance(interval);
      expect(fuzzedInterval).toBe(2);
    });
});
