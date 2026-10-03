import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requireOSMData } from "../../src/routes/api/osm/index";
import { cacheManager } from "../../src/routes/api/osm/fs-cache-manager";
import { RequestContext } from "../../src/lib/tracing/requestContext";
import { divideBoundary } from "../../src/routes/api/osm/boundary";
import { fixtureBoundary, listFixtureCells, readFixtureCell } from "../lib/data";
import { measure, summarize } from "../lib/harness";
import type { Samples } from "../lib/harness";
import type { Scenario, ScenarioResult } from "./types";

/**
 * ファイルキャッシュが全てヒットした状態での `requireOSMData` を測る。
 *
 * これは本番の「キャッシュ読取」側で、1 検索あたりにファイル I/O がここに出る。
 * `RequestContext` が本番で出力しているログ（cache / merge / trim）の内訳も
 * 同時に採取するので、計測値とログを見比べる神器になる。
 *
 * `cacheManager` は import 時に `OSM_CACHE_DIR` を読むので、このシナリオでは
 * プロセス環境ではなく `env` を差し替えてから readCache する。
 */
export const cacheReadScenario: Scenario = {
  name: "cache-read",
  description: "ファイルキャッシュが全ヒットした状態での requireOSMData（キャッシュ読取側）",
  defaultIterations: 15,
  async run({ iterations, warmup }): Promise<ScenarioResult> {
    const boundary = fixtureBoundary();
    const cellCount = divideBoundary(boundary).length;

    // 実キャッシュと同じセル構成を一時ディレクトリに用意する。
    // readCache は missing を null に変換する（= 取得し直し）ので、1 セルでも
    // 欠けてると Overpass 取得に到達してエラーになるので、セルが欠けていないことを前提にする。
    const cacheDir = mkdtempSync(join(tmpdir(), "procon-bench-cache-"));
    for (const cell of listFixtureCells()) {
      writeFileSync(join(cacheDir, cell), JSON.stringify(readFixtureCell(cell)), "utf-8");
    }
    const previousCacheDir = process.env.OSM_CACHE_DIR;
    process.env.OSM_CACHE_DIR = cacheDir;

    const notExpectedToFetch = async (): Promise<App.OSMData> => {
      throw new Error("キャッシュが効いていない: Overpass 取得に到達した");
    };

    const contextStages: Record<string, number[]> = {};
    let elementCount = 0;

    const runOnce = async () => {
      const ctx = new RequestContext();
      const data = await requireOSMData(ctx, boundary, cacheManager, notExpectedToFetch);
      // endMeasurement は measuredEntries を空にするので、先に読む
      for (const entry of ctx.measuredEntries) {
        (contextStages[entry.name] ??= []).push(entry.endTime - entry.startTime);
      }
      // console への出力は 1 回 10ms 程度かかるので、計測中には出さない
      const originalLog = console.log;
      console.log = () => {};
      try {
        ctx.endMeasurement();
      } finally {
        console.log = originalLog;
      }
      return data;
    };

    const samples = await measure(
      () => {},
      async () => {
        const data = await runOnce();
        elementCount = data.elements.length;
      },
      { warmup, iterations },
    );

    if (previousCacheDir === undefined) delete process.env.OSM_CACHE_DIR;
    else process.env.OSM_CACHE_DIR = previousCacheDir;
    rmSync(cacheDir, { recursive: true, force: true });

    const stages: Record<string, Samples> = { requireOSMData: samples };
    for (const [label, values] of Object.entries(contextStages)) {
      const kept = values.slice(warmup);
      if (kept.length === 0) continue;
      stages[`RequestContext.${label}`] = summarize(kept);
    }

    return {
      scenario: "cache-read",
      stages,
      total: samples.median,
      info: { cellCount, elementCount, mode: "cache-hit" },
    };
  },
};
