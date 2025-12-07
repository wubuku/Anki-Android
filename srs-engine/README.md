# srs-engine: A Standalone FSRS Algorithm Implementation

This directory contains a standalone, headless TypeScript implementation of the FSRS (Free Spaced Repetition Scheduler) algorithm, inspired by Anki's core scheduling logic.

## Our Journey: From Exploration to Implementation

This module is the result of an iterative and collaborative development process:

1.  **Exploration**: We began by analyzing the `Anki-Android` codebase to understand its core architecture, data models, and scheduling logic.
2.  **Architectural Pivot**: Our initial server-centric design was challenged and refined. We pivoted to a **"Local-First"** architecture, which is more robust, cost-effective, and provides a superior offline user experience.
3.  **Deep Dive**: We investigated Anki's core Rust library (`rslib`) to understand the principles behind the modern FSRS algorithm.
4.  **TDD Implementation**: This module was built from the ground up using **Test-Driven Development (TDD)**. We wrote tests for each piece of functionality first, then implemented the code to make them pass.

The result is a reliable, standalone, and thoroughly tested SRS engine that can be confidently integrated into any PWA or JavaScript/TypeScript project.

## Features

- **FSRS Algorithm**: Implements the core logic for the FSRS algorithm, including calculations for `stability` and `difficulty`.
- **Complete State Handling**: Correctly processes all four card states: `New`, `Learning`, `Review`, and `Relearning`.
- **Interval Fuzzing**: Includes logic to apply a random "fuzz" to review intervals, preventing cards from clustering on a single day.
- **Fully Typed**: Written in TypeScript for robust type safety and excellent editor support.
- **Comprehensively Tested**: Includes a full suite of unit tests built with Jest, ensuring the algorithm's correctness across a wide range of scenarios.

## Getting Started

To use or develop this module, first install the necessary dependencies.

```bash
cd srs-engine
npm install
```

## How to Test

The correctness of this module is guaranteed by a comprehensive suite of unit tests. We have 12 tests covering all card states and fuzzing logic.

To run the tests, execute the following command from within the `srs-engine` directory:

```bash
npm test
```

**Expected Output:**

You should see all tests passing, confirming that the engine is working as expected.

```
 PASS  tests/srs.test.ts
  FSRS getNextStates for New Cards
    ✓ should handle rating: Good (2 ms)
    ✓ should handle rating: Again
    ✓ should handle rating: Hard
    ✓ should handle rating: Easy
  FSRS getNextStates for Review Cards
    ✓ should handle rating: Good
    ✓ should handle rating: Hard
    ✓ should handle rating: Easy
    ✓ should handle rating: Again (Lapse)
  FSRS getNextStates for Learning Cards
    ✓ should graduate to Review state when rated Good
  FSRS getNextStates for Relearning Cards
    ✓ should graduate back to Review state when rated Good
  applyFuzzAndLoadBalance
    ✓ should apply fuzz to the interval
    ✓ should not fuzz small intervals (less than 2.5 days)

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Snapshots:   0 total
Time:        ...
Ran all test suites.
```

## Basic Usage (API)

The module exports two primary functions for use in your application.

```typescript
import { getNextStates, applyFuzzAndLoadBalance, Card, Rating, State } from './src';

// 1. Define your card object
const myCard: Card = {
  id: 'card1',
  due: new Date(),
  stability: 10,
  difficulty: 5,
  lapses: 0,
  state: State.Review,
};

// 2. Get all possible next states when reviewing the card
const nextStates = getNextStates(myCard);

// 3. User rates the card as "Good" (Rating.Good = 3)
const chosenState = nextStates.good;

// 4. Apply fuzz to the calculated interval before scheduling
const finalInterval = applyFuzzAndLoadBalance(chosenState.interval);

// 5. Update your card object with the new state
const now = new Date();
const updatedCard: Card = {
    ...myCard,
    stability: chosenState.stability,
    difficulty: chosen_state.difficulty,
    due: new Date(now.getTime() + finalInterval * 24 * 60 * 60 * 1000),
    state: State.Review, // Update state based on logic
    last_review: now,
};

console.log(`Card is next due in ${finalInterval} days.`);

```
