import type { LogLine } from ".";
import { isTracingEnabled, saveRequest } from "./database.server";

export class RequestContext {
  startTime: number | undefined;
  measuredEntries: {
    name: string;
    startTime: number;
    endTime: number;
  }[];
  logs: LogLine[];
  constructor() {
    this.startTime = performance.now();
    this.measuredEntries = [];
    this.logs = [];
  }

  endMeasurement(requestedAt: Date, method: string, url: string) {
    if (this.startTime === undefined) {
      throw new Error("Performance measurement has not been started.");
    }

    if (isTracingEnabled()) {
      try {
        saveRequest(requestedAt, method, url, {
          entries: this.measuredEntries,
          start: this.startTime,
          end: performance.now()
        }, this.logs);
      } catch (error) {
        console.error("Failed to save request performance data:", error);
      }
    }

  }

  log(log: string) {
    this.logs.push({ loggedAt: Date.now(), log });
  }

  logError(error: unknown) {
    if (!(error instanceof Error)) {
      this.log(String(error));
      return;
    }

    this.log(`${error.name}: ${error.message}`);
    if (error.stack === undefined) {
      return;
    }
    for (const line of error.stack.split("\n").slice(1, 5)) {
      const trimmed = line.trim();
      if (trimmed !== "") {
        this.log(trimmed);
      }
    }
  }

  measure<T>(name: string, fn: () => T): T {
    if (this.startTime === undefined) {
      throw new Error("Performance measurement has not been started.");
    }
    const startTime = performance.now();
    const res = fn();
    const endTime = performance.now();

    this.measuredEntries.push({ name, startTime, endTime });

    return res;
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.startTime === undefined) {
      throw new Error("Performance measurement has not been started.");
    }
    const startTime = performance.now();
    const res = await fn();
    const endTime = performance.now();

    this.measuredEntries.push({ name, startTime, endTime });

    return res;
  }

  begin(name: string): () => void {
    if (this.startTime === undefined) {
      throw new Error("Performance measurement has not been started.");
    }
    const startTime = performance.now();
    return () => {
      const endTime = performance.now();
      this.measuredEntries.push({ name, startTime, endTime });
    };
  }
};