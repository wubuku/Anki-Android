export enum Rating {
  Again = 1,
  Hard,
  Good,
  Easy,
}

export enum State {
  New = 0,
  Learning,
  Review,
  Relearning,
}

export interface Card {
  id: string;
  due: Date;
  stability: number;
  difficulty: number;
  lapses: number;
  state: State;
  last_review?: Date;
  step: number; // Index of the current learning step
}

export interface DeckConfig {
  learningSteps: number[]; // in seconds, e.g., [60, 600] for 1m, 10m
  relearningSteps: number[]; // in seconds
  fsrsParams: FSRSParameters;
}

export interface FSRSParameters {
  request_retention: number;
  maximum_interval: number;
  w: Readonly<number[]>; // Changed to Readonly<number[]>
}

export interface MemoryState {
  stability: number;
  difficulty: number;
}

export interface NextStates {
  again: MemoryState & { interval: number };
  hard: MemoryState & { interval: number };
  good: MemoryState & { interval: number };
  easy: MemoryState & { interval: number };
}

export type ReviewLog = {
  card_id: string;
  review_time: Date;
  rating: Rating;
  state: State;
  due: Date;
  stability: number;
  difficulty: number;
  lapses: number;
};