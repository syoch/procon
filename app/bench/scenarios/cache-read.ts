import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requireOSMData } from "../../src/routes/api/osm/index";
import { cacheManager } from "../../src/routes/api/osm/fs-cache-manager";
import { RequestContext } from "../../src/lib/tracing/requestContext";
import { divideBoundary } from "../../src/routes/api/osm/boundary";
import { toStageId, type StageId } from "../ids";
import { fixtureBoundary, listFixtureCells, readFixtureCell } from "../lib/data";
import { StageRecorder } from "../lib/harness";
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

    // RequestContext の計測名は実行時に文字列で届く。レジストリに無い名前は
    // toStageId が落とすので、本番側に計測が増えたら bench 側で明示する必要がある。
    const contextSamples = new Map<StageId, number[]>();
    let elementCount = 0;

    const recorder = new StageRecorder("cache-read", { warmup, iterations });
    const runOnce = async () => {
      const ctx = new RequestContext();
      const data = await requireOSMData(ctx, boundary, cacheManager, notExpectedToFetch);
      // endMeasurement は measuredEntries を空にするので、先に読む
      for (const entry of ctx.measuredEntries) {
        const id = toStageId("cache-read", `RequestContext.${entry.name}`);
        const samples = contextSamples.get(id);
        if (samples === undefined) contextSamples.set(id, [entry.endTime - entry.startTime]);
        else samples.push(entry.endTime - entry.startTime);
      }
      // console への出力は 1 回 10ms 程度かかるので、計測中には出さない
      const originalLog = console.log;
      console.log = () => {};
      try {
        // 実際のサーバと同じ引数で呼び出す。引数は記録先の DB に保存されるだけで
        // measuredEntries の時間には影響しないので、計測対象の精度を損なわない。
        ctx.endMeasurement(new Date(), "POST", "http://localhost/bench");
      } finally {
        console.log = originalLog;
      }
      return data;
    };

    await recorder.measure("requireOSMData", () => {}, async () => {
      const data = await runOnce();
      elementCount = data.elements.length;
    });

    if (previousCacheDir === undefined) delete process.env.OSM_CACHE_DIR;
    else process.env.OSM_CACHE_DIR = previousCacheDir;
    rmSync(cacheDir, { recursive: true, force: true });

    for (const [id, samples] of contextSamples) {
      // 暖機ぶんは result() が落とすので、生の列をそのまま積む
      recorder.record(id, samples);
    }

    const stages = recorder.result();
    return {
      scenario: "cache-read",
      stages,
      // 内訳は requireOSMData に含まれるので、足し合わせない
      total: stages["cache-read/requireOSMData"]?.median ?? 0,
      info: { cellCount, elementCount, mode: "cache-hit" },
    };
  },
};
