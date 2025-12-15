# srs-engine: A Standalone FSRS Algorithm Implementation

This directory contains a standalone, headless TypeScript implementation of the FSRS (Free Spaced Repetition Scheduler) algorithm, inspired by Anki's core scheduling logic.

## Our Journey: From Exploration to Implementation

This module is the result of an iterative and collaborative development process:

1.  **Exploration**: We began by analyzing the `Anki-Android` codebase to understand its core architecture.
2.  **Architectural Pivot**: We pivoted from a server-centric design to a **"Local-First"** architecture, which is more robust, cost-effective, and provides a superior offline user experience.
3.  **Deep Dive & Adaptation**: We investigated Anki's core Rust library (`rslib`) and the `ts-fsrs` TypeScript port to understand and adapt the precise FSRS formulas.
4.  **TDD Implementation**: This module was built from the ground up using **Test-Driven Development (TDD)**, resulting in a reliable, standalone, and thoroughly tested SRS engine.

The result is a reliable, standalone, and thoroughly tested SRS engine that can be confidently integrated into any PWA or JavaScript/TypeScript project.

## Features

- **Accurate FSRS Algorithm**: Implements the core FSRS scheduling logic based on a validated implementation (`ts-fsrs`).
- **Complete State Handling**: Correctly processes all four card states: `New`, `Learning`, `Review`, and `Relearning`.
- **Multi-step Learning**: Supports configurable, multi-step learning paths for new and lapsed cards.
- **Review Timing (`delta_t`)**: Accurately adjusts stability gain based on whether a review was early, on-time, or late.
- **Interval Fuzzing**: Includes logic to apply a random "fuzz" to review intervals.
- **Fully Typed**: Written in TypeScript for robust type safety.
- **Comprehensively Tested**: Includes a full suite of unit tests built with Jest.

## Getting Started

To use or develop this module, first install the necessary dependencies.

```bash
cd srs-engine
npm install
```

## How to Test

The correctness of this module is guaranteed by a comprehensive suite of unit tests. To run the tests, execute the following command from within the `srs-engine` directory:

```bash
npm test
```

You should see all tests passing, confirming that the engine is working as expected.

### Latest Test Developments

We've recently added comprehensive integration tests (`ts-fsrs-integration.test.ts`) to validate the official `ts-fsrs` npm package as our recommended production solution. These tests confirm:

- **Functional Compatibility**: Our custom implementation produces nearly identical scheduling results to the official `ts-fsrs` package
- **Feature Parity**: The official package supports all required FSRS functionality including custom parameters, time-based adjustments, and advanced scheduling
- **Production Readiness**: Validated for direct production use with robust error handling and performance characteristics

## Core API & Usage

The engine exports several functions, with `getNextStates` being the primary entry point.

### `getNextStates(card: Card, config: DeckConfig, now: Date): NextStates`
This is the main function. It takes the current `card`, the `deck's configuration` (which includes learning steps and FSRS parameters), and the `current time`, and returns an object containing the calculated next state for all four possible ratings (Again, Hard, Good, Easy).

### `applyFuzzAndLoadBalance(interval: number): number`
This function takes a calculated interval (in days) and applies a random fuzz factor. 

**Note on Load Balancing**: This function currently only implements **Fuzzing**. True **Load Balancing** is an orchestration feature that sits *above* this engine and should be implemented in your application's scheduling service.

### Full Implementation

For the full, detailed source code, please refer to the files in the `src/` directory:
- **Data Structures**: `srs-engine/src/types.ts`
- **Core Algorithm**: `srs-engine/src/index.ts`

---

## Final Recommendation

While this module is a complete and functional implementation, for a production application, it is **strongly recommended to use the official `ts-fsrs` npm package directly**. This `srs-engine` project was an invaluable tool for research, deep understanding, and validation, but relying on the official package ensures you receive ongoing bug fixes, performance improvements, and algorithm updates from the community. Our engine can serve as a lightweight adapter or wrapper if needed.
