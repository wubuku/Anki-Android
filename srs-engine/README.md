# srs-engine: A Standalone FSRS Algorithm Implementation

This directory contains a standalone, headless TypeScript implementation of the FSRS (Free Spaced Repetition Scheduler) algorithm, inspired by Anki's core scheduling logic.

## Our Journey: From Exploration to Implementation

This module is the result of an iterative and collaborative development process:

1.  **Exploration**: We began by analyzing the `Anki-Android` codebase to understand its core architecture.
2.  **Architectural Pivot**: We pivoted from a server-centric design to a **"Local-First"** architecture, which is more robust, cost-effective, and provides a superior offline user experience.
3.  **Deep Dive & Adaptation**: We investigated Anki's core Rust library (`rslib`) and the `ts-fsrs` TypeScript port to understand the precise FSRS formulas.
4.  **TDD Implementation**: This module was built from the ground up using **Test-Driven Development (TDD)**. We wrote tests for each piece of functionality first, then implemented the code to make them pass.

The result is a reliable, standalone, and thoroughly tested SRS engine that can be confidently integrated into any PWA or JavaScript/TypeScript project.

## Features

- **Accurate FSRS Algorithm**: Implements the core FSRS scheduling logic based on a validated implementation (`ts-fsrs`).
- **Complete State Handling**: Correctly processes all four card states: `New`, `Learning`, `Review`, and `Relearning`.
- **Multi-step Learning**: Supports configurable, multi-step learning paths for new and lapsed cards.
- **Review Timing (`delta_t`)**: Accurately adjusts stability gain based on whether a review was early, on-time, or late.
- **Interval Fuzzing**: Includes logic to apply a random "fuzz" to review intervals, preventing cards from clustering on a single day.
- **Fully Typed**: Written in TypeScript for robust type safety.
- **Comprehensively Tested**: Includes a full suite of unit tests built with Jest.

## Getting Started

To use or develop this module, first install the necessary dependencies.

```bash
cd srs-engine
npm install
```

## How to Test

The correctness of this module is guaranteed by a comprehensive suite of unit tests.

To run the tests, execute the following command from within the `srs-engine` directory:

```bash
npm test
```

You should see all tests passing, confirming that the engine is working as expected.

## Core API & Usage

The engine exports several functions, with `getNextStates` being the primary entry point.

### `getNextStates(card: Card, config: DeckConfig, now: Date): NextStates`
This is the main function. It takes the current `card`, the `deck's configuration` (which includes learning steps and FSRS parameters), and the `current time`, and returns an object containing the calculated next state for all four possible ratings (Again, Hard, Good, Easy).

### `applyFuzzAndLoadBalance(interval: number): number`
This function takes a calculated interval (in days) and applies a random fuzz factor. 

**Note on Load Balancing**: This function currently only implements **Fuzzing**. True **Load Balancing** is an orchestration feature that sits *above* this engine. It should be implemented in your application's scheduling service, which would use the fuzzed interval from this function as an input and then choose the best date based on future workload data from your database.

### Example

```typescript
import { getNextStates, applyFuzzAndLoadBalance, Card, Rating, State, DeckConfig, FSRS_DEFAULT_PARAMS_FULL } from './src';

// 1. Define your configuration
const config: DeckConfig = {
    learningSteps: [60, 600], // 1m, 10m
    relearningSteps: [600],
    fsrsParams: {
        request_retention: 0.9,
        maximum_interval: 36500,
        w: FSRS_DEFAULT_PARAMS_FULL,
    }
};

// 2. Get your card and the current time
const now = new Date();
const myCard: Card = {
  id: 'card1',
  due: now,
  last_review: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // Reviewed 10 days ago
  stability: 10,
  difficulty: 5,
  lapses: 0,
  state: State.Review,
  step: 0,
};

// 3. Get all possible next states
const nextStates = getNextStates(myCard, config, now);

// 4. User rates the card as "Good"
const chosenState = nextStates.good;

// 5. Apply fuzz to the calculated interval
const finalInterval = applyFuzzAndLoadBalance(chosenState.interval);

// 6. Update your card object and save it to your database
const updatedCard: Card = {
    ...myCard,
    due: new Date(now.getTime() + finalInterval * 24 * 60 * 60 * 1000),
    stability: chosenState.stability,
    difficulty: chosenState.difficulty,
    state: State.Review, // Or Relearning if lapsed
    last_review: now,
};

console.log(`Card state updated. New interval: ${finalInterval} days.`);
```

### Full Implementation

For the full, detailed source code, please refer to the files in the `src/` directory:
- **Data Structures**: `srs-engine/src/types.ts`
- **Core Algorithm**: `srs-engine/src/index.ts`