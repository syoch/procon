import { finishRequest, insertLogLine, insertRequest, isTracingEnabled } from "./database.server";

export class RequestContext {
  startTime: number | undefined;
  measuredEntries: {
    name: string;
    startTime: number;
    endTime: number;
  }[];
  requestId: string | undefined;
  constructor(requestedAt: Date, method: string, url: string) {
    this.startTime = performance.now();
    this.measuredEntries = [];

    if (isTracingEnabled()) {
      try {
        this.requestId = insertRequest(requestedAt, method, url, this.startTime);
      } catch (error) {
        console.error("Failed to insert request record:", error);
      }
    }
  }

  endMeasurement() {
    if (this.startTime === undefined) {
      throw new Error("Performance measurement has not been started.");
    }
    if (this.requestId === undefined) {
      return;
    }

    try {
      finishRequest(this.requestId, {
        entries: this.measuredEntries,
        start: this.startTime,
        end: performance.now()
      });
    } catch (error) {
      console.error("Failed to save request performance data:", error);
    }

  }

  log(log: string) {
    if (this.requestId === undefined) {
      return;
    }

    try {
      insertLogLine(this.requestId, log);
    } catch (error) {
      console.error("Failed to save log line:", error);
    }
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
