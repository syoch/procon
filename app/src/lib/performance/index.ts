type PerfCtx = {
  startTime: number | undefined;
  measuredEntries: {
    name: string;
    startTime: number;
    endTime: number;
  }[];
}

const globalPerformanceCtx: PerfCtx = {
  startTime: undefined,
  measuredEntries: [],
};

export function startPerfMeasure() {
  globalPerformanceCtx.startTime = performance.now();
  globalPerformanceCtx.measuredEntries = [];
}

export function endPerfMeasure() {
  if (globalPerformanceCtx.startTime === undefined) {
    throw new Error("Performance measurement has not been started.");
  }
  const totalTime = performance.now() - globalPerformanceCtx.startTime;
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  for (const entry of globalPerformanceCtx.measuredEntries) {
    const duration = entry.endTime - entry.startTime;
    console.log(`${entry.name}: ${duration.toFixed(2)}ms`);
  }
  globalPerformanceCtx.startTime = undefined;
  globalPerformanceCtx.measuredEntries = [];
}

export function measurePerf<T>(name: string, fn: () => T): T {
  if (globalPerformanceCtx.startTime === undefined) {
    throw new Error("Performance measurement has not been started.");
  }
  const startTime = performance.now();
  const res = fn();
  const endTime = performance.now();

  globalPerformanceCtx.measuredEntries.push({ name, startTime, endTime });

  return res;
}

export async function measurePerfAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (globalPerformanceCtx.startTime === undefined) {
    throw new Error("Performance measurement has not been started.");
  }
  const startTime = performance.now();
  const res = await fn();
  const endTime = performance.now();

  globalPerformanceCtx.measuredEntries.push({ name, startTime, endTime });

  return res;
}

export function beginMeasure(name: string): () => void {
  if (globalPerformanceCtx.startTime === undefined) {
    throw new Error("Performance measurement has not been started.");
  }
  const startTime = performance.now();
  return () => {
    const endTime = performance.now();
    globalPerformanceCtx.measuredEntries.push({ name, startTime, endTime });
  };
}