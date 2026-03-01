import type {
  RuntimeTickContext,
  SimulationClockSnapshot,
} from './RuntimeTypes';

const DEFAULT_FIXED_STEP_SECONDS = 0.2;
const DEFAULT_MAX_STEPS_PER_FRAME = 6;
const DEFAULT_MAX_FRAME_DELTA_SECONDS = 0.5;

function sanitizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function sanitizeSteps(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

export interface SimulationClockOptions {
  fixedStepSeconds?: number;
  maxStepsPerFrame?: number;
  maxFrameDeltaSeconds?: number;
}

export class SimulationClock {
  private fixedStepSeconds: number;
  private maxStepsPerFrame: number;
  private maxFrameDeltaSeconds: number;
  private accumulatorSeconds = 0;
  private tick = 0;
  private elapsedSimulationSeconds = 0;

  constructor(options: SimulationClockOptions = {}) {
    this.fixedStepSeconds = sanitizePositive(options.fixedStepSeconds, DEFAULT_FIXED_STEP_SECONDS);
    this.maxStepsPerFrame = sanitizeSteps(options.maxStepsPerFrame, DEFAULT_MAX_STEPS_PER_FRAME);
    this.maxFrameDeltaSeconds = sanitizePositive(options.maxFrameDeltaSeconds, DEFAULT_MAX_FRAME_DELTA_SECONDS);
  }

  getFixedStepSeconds(): number {
    return this.fixedStepSeconds;
  }

  getTick(): number {
    return this.tick;
  }

  getElapsedSimulationSeconds(): number {
    return this.elapsedSimulationSeconds;
  }

  advance(frameDeltaSeconds: number): RuntimeTickContext[] {
    if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds <= 0) {
      return [];
    }

    const clampedFrameDelta = Math.min(frameDeltaSeconds, this.maxFrameDeltaSeconds);
    this.accumulatorSeconds += clampedFrameDelta;

    const ticks: RuntimeTickContext[] = [];
    let producedSteps = 0;

    while (
      this.accumulatorSeconds >= this.fixedStepSeconds &&
      producedSteps < this.maxStepsPerFrame
    ) {
      this.accumulatorSeconds -= this.fixedStepSeconds;
      this.tick += 1;
      this.elapsedSimulationSeconds += this.fixedStepSeconds;
      producedSteps += 1;

      ticks.push({
        tick: this.tick,
        deltaSeconds: this.fixedStepSeconds,
        totalSimulationSeconds: this.elapsedSimulationSeconds,
      });
    }

    if (
      producedSteps === this.maxStepsPerFrame &&
      this.accumulatorSeconds > this.fixedStepSeconds * this.maxStepsPerFrame
    ) {
      this.accumulatorSeconds = this.fixedStepSeconds;
    }

    return ticks;
  }

  createSnapshot(): SimulationClockSnapshot {
    return {
      fixedStepSeconds: this.fixedStepSeconds,
      maxStepsPerFrame: this.maxStepsPerFrame,
      maxFrameDeltaSeconds: this.maxFrameDeltaSeconds,
      accumulatorSeconds: this.accumulatorSeconds,
      tick: this.tick,
      elapsedSimulationSeconds: this.elapsedSimulationSeconds,
    };
  }

  loadSnapshot(snapshot: SimulationClockSnapshot): void {
    this.fixedStepSeconds = sanitizePositive(snapshot.fixedStepSeconds, DEFAULT_FIXED_STEP_SECONDS);
    this.maxStepsPerFrame = sanitizeSteps(snapshot.maxStepsPerFrame, DEFAULT_MAX_STEPS_PER_FRAME);
    this.maxFrameDeltaSeconds = sanitizePositive(snapshot.maxFrameDeltaSeconds, DEFAULT_MAX_FRAME_DELTA_SECONDS);

    const maxAccumulator = this.fixedStepSeconds * this.maxStepsPerFrame;
    this.accumulatorSeconds = Math.max(
      0,
      Math.min(
        Number.isFinite(snapshot.accumulatorSeconds) ? snapshot.accumulatorSeconds : 0,
        maxAccumulator,
      ),
    );
    this.tick = Math.max(0, Math.floor(Number.isFinite(snapshot.tick) ? snapshot.tick : 0));
    this.elapsedSimulationSeconds = Math.max(
      0,
      Number.isFinite(snapshot.elapsedSimulationSeconds) ? snapshot.elapsedSimulationSeconds : 0,
    );
  }

  reset(): void {
    this.accumulatorSeconds = 0;
    this.tick = 0;
    this.elapsedSimulationSeconds = 0;
  }
}
