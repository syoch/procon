import { SplitOSMData } from "../../src/routes/api/osm/osm-data";
import { loadFixture } from "../lib/data";
import { clone, stageEntries, StageRecorder } from "../lib/harness";
import type { Scenario, ScenarioResult } from "./types";

/**
 * `SplitOSMData` 単体を測る。
 *
 * キャッシュ保存側（新規セル / TTL 失効時）だけで走る処理なので、経路検索のたびに
 * 実行されるわけではない。下の `search` 系シナリオと分けて追えるようにしている。
 *
 * 出力の重複やセル取りこぼしは、このシナリオでは検出できない。
 * 正しさの検証は `app/tests/osm-cache/split-osm-data.test.ts` の責務。
 */
export const splitScenario: Scenario = {
  name: "split",
  description: "SplitOSMData 単体（キャッシュ保存時に 1 回だけ走る）",
  defaultIterations: 30,
  async run({ iterations, warmup }): Promise<ScenarioResult> {
    const fixture = loadFixture();
    const recorder = new StageRecorder("split", { warmup, iterations });
    await recorder.measure(
      "SplitOSMData",
      // clone は測定対象ではないので setup 側で行う
      () => clone(fixture),
      (data) => {
        SplitOSMData(data);
      },
    );
    const stages = recorder.result();
    return {
      scenario: "split",
      stages,
      total: stageEntries(stages).reduce((sum, [, s]) => sum + s.median, 0),
      info: {
        elements: fixture.elements.length,
        nodes: fixture.elements.filter((e) => e.type === "node").length,
        ways: fixture.elements.filter((e) => e.type === "way").length,
      },
    };
  },
};
