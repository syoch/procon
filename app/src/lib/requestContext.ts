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

  endMeasurement() {
    if (this.startTime === undefined) {
      throw new Error("Performance measurement has not been started.");
    }
    const totalTime = performance.now() - this.startTime;
    console.log(`Total time: ${totalTime.toFixed(2)}ms`);
    for (const entry of this.measuredEntries) {
      const duration = entry.endTime - entry.startTime;
      console.log(`${entry.name}: ${duration.toFixed(2)}ms`);
    }
    this.startTime = undefined;
    this.measuredEntries = [];
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