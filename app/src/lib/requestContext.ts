import { saveRequest } from "./tracing";

export class RequestContext {
  startTime: number | undefined;
  measuredEntries: {
    name: string;
    startTime: number;
    endTime: number;
  }[];
  constructor() {
    this.startTime = performance.now();
    this.measuredEntries = [];
  }

  endMeasurement(requestedAt: Date, method: string, url: string) {
    if (this.startTime === undefined) {
      throw new Error("Performance measurement has not been started.");
    }
    
    saveRequest(requestedAt, method, url, this.measuredEntries);
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