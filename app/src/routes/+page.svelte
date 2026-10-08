<script lang="ts">
	import L from "leaflet";
	import { fade, fly } from "svelte/transition";
	import { cubicOut, backOut } from "svelte/easing";

	import { findNearestEdge } from "$lib/transient-split";
	import { CrossConvert } from "$lib/cross_transform";
	import { fold2DegreeEdges } from "$lib/fold2degree";
	import { assertGraph } from "$lib/utils/graph";
	import MapViewer from "$lib/components/MapViewer.svelte";
	import type { SharpTurn } from "$lib/sharp_turn";
	import type { PathFindResult } from "$lib/api/path-find";
	import type { WidthCoverage } from "$lib/road_width";
	import SpeedSafetySlider from "$lib/components/SpeedSafetySlider.svelte";
	import { SPEED_SAFETY_CENTER, sliderToLambda } from "$lib/speed_safety";
	import { formatDuration } from "$lib/utils/duration";
	import { createLatestGuard } from "$lib/utils/latest";
	import DetailButton from "$lib/components/figma/DetailButton.svelte";
	import DetailPanel from "$lib/components/figma/DetailPanel.svelte";
	import TitleScreen from "$lib/components/figma/TitleScreen.svelte";
	import SearchingOverlay from "$lib/components/figma/SearchingOverlay.svelte";
	import widenaviLogo from "$lib/assets/widenavi-logo.svg";
	import straightLogo from "$lib/assets/straight-logo.svg";
	import turnrightLogo from "$lib/assets/turnright-logo.svg";
	import turnleftLogo from "$lib/assets/turnleft-logo.svg"
	import startpointLogo from "$lib/assets/startpoint-logo.svg";
	import finishpointLogo from "$lib/assets/finishpoint-logo.svg";
	import uturnLogo from "$lib/assets/Uturn-logo.svg";
	import {
		MainAppContext,
		type ParameterVariant,
	} from "$lib/app_state.svelte";
	import { SelectMarker } from "$lib/utils/selectMarker.svelte";
	import { MODE_IDS, MODE_PROFILES } from "$lib/mode_profiles";
	import VehicleSelect from "$lib/components/figma/VehicleSelect.svelte";
	import GreenButton from "$lib/components/figma/GreenButton.svelte";
	import SearchField from "$lib/components/figma/SearchField.svelte";
	import { debounce } from "$lib/utils/debounce";

	/** 端点の連続変更をまとめてから先読みを出すまでの待ち時間 [ms] */
	const PRELOAD_DEBOUNCE_MS = 400;
	/** 速さ⇔安全スライダーの連続操作をまとめてから探し直すまでの待ち時間 [ms] */
	const RESEARCH_DEBOUNCE_MS = 300;

	let map: L.Map | undefined = $state(undefined);
	let error: string | null = $state(null);
	let beginMarker: SelectMarker | null = $state(null);
	let endMarker: SelectMarker | null = $state(null);

	let pathResult: App.Coordinate[] = $state([]);
	let sharpTurns: SharpTurn[] = $state([]);
	let totalDistance = $state<number | undefined>(undefined);
	let totalIntersections = $state<number | undefined>(undefined);
	/** 想定の所要時間 [秒] (信号・渋滞を含まない。mode なしの検索では null) */
	let totalTime = $state<number | null | undefined>(undefined);
	/** 経路の区間のうち、幅員が分かっている区間の割合 */
	let widthCoverage = $state<WidthCoverage | undefined>(undefined);
	/** 手動・自動を問わず検索を実行済みか（$state ではない） */
	let hasSearched = false;
	/** 最後に始めた検索の応答だけを画面に反映するための目印（$state ではない） */
	const latestSearch = createLatestGuard();
	let informationGraph=$state<App.InformationGraph>({ type: [], distance: [] });

	// 移動モード (徒歩・自転車・車・バイク・大型トラック) ごとのプリセット。
	// 表示名と重みは mode_profiles.ts を唯一の定義元とし、ここでは並べるだけにする
	const parameterVariants: ParameterVariant[] = MODE_IDS.map((mode) => ({
		name: MODE_PROFILES[mode].name,
		mode,
		...MODE_PROFILES[mode].defaultParameters,
	}));
	const locationProvider = async (q: string) => {
		const res = await fetch(
			`/api/location?q=${encodeURIComponent(q)}&limit=5`,
		);
		if (!res.ok) return [];
		const data = (await res.json()) as {
			candidates?: import("$lib/app_state.svelte").LocationCandidate[];
		};
		return data.candidates ?? [];
	};

	// 初期選択は「車」
	const ctx = MainAppContext.create(locationProvider, parameterVariants, MODE_IDS.indexOf("car"));

	function onClick(lat: number, lng: number) {
		console.debug("Clicked at", lat, lng);
		if (!ctx.state.locationSelection) {
			return; // no selection mode
		}

		let locationState =
			ctx.state.locationSelection === "begin"
				? ctx.state.begin
				: ctx.state.end;
		locationState.state = "confirmed";
		locationState.query = `${lat}, ${lat}`;
		ctx.state.setCoordinate(ctx.state.locationSelection, {lat, lng});
	}
	$effect(() => {
		const coordinate = ctx.state.coordinate("begin");
		if (coordinate) {
			beginMarker?.setCoordinate(coordinate);
		}
	});
	$effect(() => {
		const coordinate = ctx.state.coordinate("end");
		if (coordinate) {
			endMarker?.setCoordinate(coordinate);
		}
	});

	/**
	 * 端点を設定してから検索が走るまでの間に、経路探索と同じ範囲を温める。
	 * 閲覧中の pan/zoom では出さない。端点は連続で変わりうるのでデバウンスする。
	 */
	const preloadAroundEndpoints = debounce(() => {
		const begin = ctx.state.coordinate("begin");
		const end = ctx.state.coordinate("end");
		if (!begin && !end) return;

		// 片方だけのときは、その端点の周辺だけを温める。null を送ると 400 になるため片方だけにする
		const payload = begin && end ? { begin, end } : { begin: begin ?? end };
		fetch("/api/preload-osm", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}).catch((e) => console.error("Error preloading map:", e));
	}, PRELOAD_DEBOUNCE_MS);

	$effect(() => {
		// 端点の変化を依存として読む。先読みの実行は debounce に任せる
		const begin = ctx.state.coordinate("begin");
		const end = ctx.state.coordinate("end");
		if (!begin && !end) return;

		preloadAroundEndpoints();
		// 破棄時に未実行の先読みタイマーを止める
		return () => preloadAroundEndpoints.cancel();
	});

	/** 結果画面で速さ⇔安全を動かしたとき、同じ始点・終点で探し直す */
	const researchWithNewBalance = debounce(() => {
		if (ctx.state.appState !== "menu-result") return;
		startSearch();
	}, RESEARCH_DEBOUNCE_MS);

	async function startSearch(): Promise<boolean> {
		const begin = ctx.state.coordinate("begin");
		const end = ctx.state.coordinate("end");
		if (!begin) {
			error = "始点が指定されていません";
			return false;
		}
		if (!end) {
			error = "終点が指定されていません";
			return false;
		}
		// 検索は先読みを待たない。未実行の先読みは捨て、実行中なら requireOSMData 側で 1 回にまとめる
		preloadAroundEndpoints.cancel();
		// 手動の検索が始まったら、待機中の探し直しは捨てる
		researchWithNewBalance.cancel();
		const isLatest = latestSearch.begin();
		showSliders = false;
		error = null;
		hasSearched = true;
		pathResult = [];
		totalDistance = 0;
		totalIntersections = 0;
		totalTime = undefined;
		widthCoverage = undefined;
		sharpTurns = [];
		informationGraph = { type: [], distance: [] };

		const totalSlider = slider1 + slider2 + slider3;

		const params: App.SearchParameters = {
    		...ctx.searchParameters,
			lambda: sliderToLambda(speedSafety),
    		mix_score_weight: totalSlider === 0 ? 0 : slider1 / totalSlider,
    		view_score_weight: totalSlider === 0 ? 0 : slider2 / totalSlider,
    		width_score_weight: totalSlider === 0 ? 0 : slider3 / totalSlider,
		};


		// 送るのは重みの数値だけ (プリセットの表示名などは含めない)
		const { lambda, mix_score_weight, view_score_weight, width_score_weight } = params;
		const parameters = { lambda, mix_score_weight, view_score_weight, width_score_weight };
		const mode = ctx.searchMode;
		const res = await fetch("/api/path-find", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// モードがあるプリセットは mode で (通れる道はサーバー側のモード定義で決まる)、
			// 無いプリセットは従来どおり wayHighway で探索する
			body: JSON.stringify(
				mode
					? { begin, end, parameters, mode }
					: {
							begin,
							end,
							parameters,
							wayHighway: [
								"motorway",
								"trunk",
								"primary",
								"secondary",
								"tertiary",
								"unclassified",
								"residential",
							],
						},
			),
		});
		// 待っている間に次の検索が始まっていたら、この応答は反映しない (失敗ではないので true)
		if (!isLatest()) return true;

		if (!res.ok) {
			// 上限超過などは応答の message をそのまま表示する
			const body: { message?: unknown } = await res.json().catch(() => ({}));
			error = typeof body.message === "string" ? body.message : `/api/path-find API エラー: ${res.status}`;
			return false;
		}

		try {
			const resObj: PathFindResult = await res.json();
			if (!isLatest()) return true;

			if (!resObj.found) {
				// 到達できない理由 (目的地の近くに通れる道が無い など) をそのまま表示する
				error = resObj.message ?? "経路が見つかりませんでした。";
				return false;
			}

			pathResult = resObj.coords;
			totalDistance = resObj.totalDistance;
			totalIntersections = resObj.totalIntersections;
			totalTime = resObj.totalTime;
			widthCoverage = resObj.widthCoverage;
			sharpTurns = resObj.sharpTurns ?? [];
			informationGraph = resObj.infoGraph;
			ctx.state.appState = "menu-result";
		} catch (e) {
			error = "サーバー応答の読み取りエラーが発生しました";
			return false;
		}
		return true;
	}

	// 起動演出。booted が立つまで appState は "boot" を返すので、
	// テンプレートの分岐順は従来どおりでよい。
	$effect(() => {
		const timer = setTimeout(() => (ctx.state.booted = true), 1500);
		return () => clearTimeout(timer);
	});

	// Leaflet.Map オブジェクトが生成された後の処理
	$effect(() => {
		if (!map) return;

		beginMarker = new SelectMarker(map);
		endMarker = new SelectMarker(map);

		// 地図の viewpoint と URL の同期は状態モジュールが受け持つ
		const unbindMap = ctx.state.bindMap(map);
		return unbindMap;
	});

	/**
	 * 共有リンク (v=menu-result) で開かれた場合は経路検索も実行する。
	 * 経路そのものは URL に載せない（サイズが大きいため）ので、復元時に
	 * 取り直す。地図データと起動演出の完了を待ってから実行する。
	 */
	$effect(() => {
		if (!ctx.state.booted) return;
		if (ctx.state.appState !== "menu-result") return;
		if (hasSearched) return;
		
		(async () => {
			if (!(await startSearch())) {
				// 経路が出せない共有リンクでは詳細メニューへ戻す
				ctx.state.appState = "menu-detail";
			}
		})();
	});

	let showSliders = $state(false);
	//スライダー初期値
	let slider1 = $state(50);
    let slider2 = $state(50);
    let slider3 = $state(50);
	/** 速さ⇔安全スライダーの位置 (車種を変えても保つ) */
	let speedSafety = $state(SPEED_SAFETY_CENTER);

	$effect(()=> { 
		const params = ctx.state.parameterVariants[
      		ctx.state.selectedVariantIndex
    	];
		slider1 = params.mix_score_weight * 100;
		slider2 = params.view_score_weight * 100;
		slider3 = params.width_score_weight * 100;
	});

</script>

<MapViewer bind:map bind:pathResult {sharpTurns} {onClick}></MapViewer>

{#snippet scoreSliders()}
	<div class="slider-item">
		<label>混在スコア: {slider1}<br>
		<input type="range" min="0" max="100" bind:value={slider1} class="custom-slider" />
		</label>
	</div>
	<div class="slider-item">
		<label>視界(曲率)スコア: {slider2}<br>
		<input type="range" min="0" max="100" bind:value={slider2} class="custom-slider" />
		</label>
	</div>
	<div class="slider-item">
		<label>幅員スコア: {slider3}<br>
		<input type="range" min="0" max="100" bind:value={slider3} class="custom-slider" />
		</label>
	</div>
{/snippet}

{#if ctx.state.appState === "app"}
	<div class="menu-button" transition:fade={{ duration: 120 }}>
		<DetailButton onclick={() => (ctx.state.appState = "menu-detail")} />
	</div>
{:else if ctx.state.appState === "menu-detail" || ctx.state.appState === "menu-result"}
	<div
		class="panel-layer"
		in:fly={{ x: -398, duration: 300, easing: cubicOut }}
	>
		<DetailPanel
			onback={() => {
				ctx.state.appState =
					ctx.state.appState === "menu-result"
						? "menu-detail"
						: "app";
			}}
		>
			{#snippet content()}
				{#if ctx.state.appState === "menu-detail"}
					<div
						style="position: absolute; left: 49px; top: 128px;"
						transition:fade={{ duration: 140 }}
					>
						<SearchField placeholder="始点を入力" target="begin" />
					</div>
					<div
						style="position: absolute; left: 49px; top: 209px"
						transition:fade={{ duration: 140 }}
					>
						<SearchField placeholder="終点を入力" target="end" />
					</div>

					<div
						style="position: absolute; top: 312px; display: flex;"
						transition:fade={{ duration: 140 }}
					>
						<div style="flex: 0 0 44px;"></div>
						<div transition:fade={{ duration: 140 }}>
							<VehicleSelect />
						</div>
						<div style="flex: 0 0 25px;"></div>
						<GreenButton
							label="検索"
							width={60}
							onclick={startSearch}
						/>
					</div>
					<div
						style="position: absolute; left: 44px; top: 366px; width: 305px;"
						transition:fade={{ duration: 140 }}
					>
						<SpeedSafetySlider bind:value={speedSafety} />
					</div>

				{:else}
					<span
						style="position: absolute; white-space: nowrap; left: 18.3px; top: 100px;"
						>出発点</span
					>
					<span
						style="position: absolute; white-space: nowrap; left: 30.7px; top: 140px;"
						>{ctx.state.begin.query}</span
					>
					<span
						class="addr-scroll" style="top:180px;"
						>{ctx.state.begin.displayName ?? ""}</span
					>
					<div class="divider" style="top: 220px;"></div>
					<span
						style="position: absolute; white-space: nowrap; left: 18.5px; top: 230px;"
						>終着点</span
					>
					<span
						style="position: absolute; white-space: nowrap; left: 32.7px; top: 270px;"
						>{ctx.state.end.query}</span
					>
					<span
						class="addr-scroll" style="top: 310px;"
						>{ctx.state.end.displayName ?? ""}</span
					>
					<div class="divider" style="top: 350px;"></div>
					<span style="position: absolute; white-space: nowrap; left: 32.8px; top: 360px;">
						総走行距離: {((totalDistance ?? 0) / 1000).toFixed(2)} km
					</span>
					<span style="position: absolute; white-space: nowrap; left: 32.8px; top: 390px;">
						総通過交差点数: {totalIntersections ?? 0} 個
					</span>
					{#if totalTime != null}
						<span style="position: absolute; white-space: nowrap; left: 32.8px; top: 420px;">
							所要時間の目安: {formatDuration(totalTime)} <span class="summary-note">(信号・渋滞を除く)</span>
						</span>
					{/if}
					<div class="divider" style="top: 452px;"></div>
					<div
						style="position: absolute; top: 462px; display: flex;"
						transition:fade={{ duration: 140 }}
					>
						<div style="flex: 0 0 44px;"></div>
						<div transition:fade={{ duration: 140 }}>
							<VehicleSelect />
						</div>
						<div style="flex: 0 0 25px;"></div>
						<GreenButton
							label="検索"
							width={60}
							onclick={startSearch}
						/>
					</div>
					

 
	

<div style="position: absolute; left: 44px; top: 510px; width: 305px;">
	<SpeedSafetySlider bind:value={speedSafety} onchange={researchWithNewBalance} />
</div>

<div style="position: absolute; left: 50px; top: 542px;">
	<button type="button" class="slider-toggle" onclick={() => (showSliders = !showSliders)}>
		{showSliders ? "▲ スコア調整を閉じる" : "▼ スコアを調整する"}
	</button>
</div>
{#if widthCoverage && widthCoverage.ratio !== null}
	<span
		class="summary-note"
		style="position: absolute; white-space: nowrap; right: 16px; top: 547px;"
		title="経路の {widthCoverage.total} 区間のうち {widthCoverage.known} 区間で、国土地理院の幅員データが対応付いています。割合が低いほど、道幅による判定が効く区間が少なくなります。"
	>
		幅員データ: 経路の {Math.round(widthCoverage.ratio * 100)}%
	</span>
{/if}


{#if informationGraph && informationGraph.type && informationGraph.type.length > 0}
			<div class="route-scroll-container">
        <div class="text-title">経路案内</div>

        <!-- 開始地点 -->
        <div class="route-row">
            <img src={startpointLogo} alt="" />
            <div class="route-info">
                <div class="text-title">始点</div>
                <div class="text-sub">{ctx.state.begin.query}</div>
            </div>
        </div>

        {#if informationGraph && informationGraph.type.length > 0}
            <!-- 累積用の変数とステップ分割ロジック -->
            {@const steps = (() => {
                const aggregated = [];
                let accumDist = 0;
                let accumCross = 0;

                for (let i = 0; i < informationGraph.type.length; i++) {
                    const t = informationGraph.type[i];
                    const d = informationGraph.distance[i];

                    accumDist += d;
					if (t === "start" || t === "segments") {
        				continue;
    				}

                    if (t === "straight") {
                        accumCross++;
                    }else if (t === "right" || t === "left"|| t === "uturn") {
						// transientSplit が長さ0のエッジを拒否するため、現実の道路網データではここに到達しない。
    					// 万が一到達した場合は意図的に無視する（UIに距離0の案内を出さないため）。
						 if (Math.round(accumDist) > 0) {
                         	aggregated.push({
                            	type: "straight",
                            	distance: Math.round(accumDist),
                            	cross: accumCross
                        	});

                        	aggregated.push({
                            	type: t,
                        		distance: 0,
                            	cross: accumCross + 1
                        	});

                        	accumDist = 0;
                        	accumCross = 0;
						
                    	} else if (Math.round(accumDist) === 0) {//0mだったとき
        						aggregated.push({ 
								type: t,
								distance: 0,
								cross: accumCross+1
								});
							accumDist = 0;
                        	accumCross = 0;
    					}
					}else if (i === informationGraph.type.length - 1) {
                        if (accumDist > 0 || accumCross > 0) {
                            aggregated.push({
                            	type: "finish",
                            	distance: Math.round(accumDist),
                            	cross: accumCross
                        	});
                    	}
                    }
                }	
            	return aggregated;
				})()}

            <!-- まとめたステップをループして表示 -->
            {#each steps as step}
                <div class="route-row">
                    <img 
                        src={
							step.type === "right" ? turnrightLogo :
							step.type === "left" ? turnleftLogo : 
							step.type === "uturn" ? uturnLogo : straightLogo
						} 
						alt={step.type} 
					/>

					<div class="route-info">
						<div class="text-title">
							{#if step.type === "straight"}
								道なり
							{:else if step.type === "finish"}
								道なり
							{:else if step.type === "right"}
								右折
							{:else if step.type === "left"}
								左折
							{:else if step.type === "uturn"}
								Uターン
							{/if}
						</div>

						<div class="text-sub">
							{#if step.type === "straight"}
								{step.distance}m道なり
							{:else if step.type === "finish"}
								{step.distance}m道なり
							{:else if step.type === "right"}
								{step.cross}個目の交差点を右折
							{:else if step.type === "left"}
								{step.cross}個目の交差点を左折
							{:else if step.type === "uturn"}
								{step.cross}個目の交差点をUターン
							{/if}
						</div>
					</div>
				</div>
			{/each}
		{/if}

		<!-- 終点 -->
		<div class="route-row">
			<img src={finishpointLogo} alt="終点" />
			<div class="route-info">
				<div class="text-title">目的地</div>
				<div class="text-sub">{ctx.state.end.query}</div>
			</div>
		</div>
	</div>
	{/if}
			{/if}
						{#if ctx.state.appState === "menu-detail" || showSliders}
			<div class="slider-group" class:slider-popover={ctx.state.appState === "menu-result"}>
				{@render scoreSliders()}
			</div>
			{/if}
			{/snippet}
		</DetailPanel>
	</div>
{:else if ctx.state.appState === "boot"}
	<button
		type="button"
		class="boot"
		aria-label="スキップ"
		in:fade={{ duration: 300 }}
		out:fade={{ duration: 500 }}
	>
		<TitleScreen />
		<img
			class="splash-logo"
			src={widenaviLogo}
			alt="Wide Navi"
			in:fly={{ delay: 500, y: -600, duration: 958, easing: backOut }}
		/>
	</button>
{/if}

{#if error}
	<div class="error-banner" transition:fade={{ duration: 150 }}>{error}</div>
{/if}

<style>
	.menu-button {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 10;
	}

	.panel-layer {
		position: fixed;
		top: var(--wn-panel-top);
		left: var(--wn-panel-left);
		z-index: 20;
	}

	.error-banner {
		position: fixed;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 60;
		max-width: 70vw;
		padding: 8px 16px;
		border: 1px solid var(--wn-green-dark);
		border-radius: 4px;
		background: var(--wn-white);
		color: var(--wn-ink);
		font-family: var(--wn-font);
		font-size: 14px;
		box-shadow: var(--wn-shadow);
	}

	.boot {
		position: fixed;
		inset: 0;
		z-index: 100;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}
	.splash-logo {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
		z-index: 101;
	}

	.divider {
		position: absolute;
		left: 16px;
		width: 369px;
		height: 1px;
		background: var(--wn-divider);
	}

	/*経路探索結果のスクロール可能なコンテナ*/
		.route-scroll-container {
		position: absolute;
        top: 580px; /* 上部の出発点・終着点情報が収まる位置より下に配置 */
        left: 10px; /* 左側の余白を調整 */
        width: 95%;
        height: calc(100% - 580px); /* パネルの残り全体の高さに合わせる */
        overflow-y: auto;
        overflow-x: hidden;
}
/* 長い住所の表示。約2行分の高さに収め、はみ出した分はホイールでスクロールして読む */
.addr-scroll {
	position: absolute;
	left: 32px;
	width: 340px;
	font-size: 14px;
	line-height: 1.4;
	max-height: 2.8em;          /* 2行分。超えたらスクロールになる */
	overflow-y: auto;
	overflow-wrap: anywhere;    /* 区切りのない長い文字列も折り返す */
	overscroll-behavior: contain; /* 端まで行っても、外側の画面にスクロールが伝わらない */
	scrollbar-width: thin;
}

.route-scroll-container::-webkit-scrollbar {
    width: 6px;
}
.route-scroll-container::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
}

.route-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        background-color: var(--wn-white);
        border-bottom: 1px solid var(--wn-spinner-gray);
    }

    .route-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .text-title {
        font-size: 20px;
        font-weight: 500;
        color: var(--wn-ink);
    }

    .text-sub {
        font-size: 16px;
        color: var(--wn-spinner-gray);
    }


	/* スライダーグループのスタイル */
	.slider-group {
        display: flex;
        flex-direction: column; /* 縦向きに並べる */
        gap: 15px;              /* スライダー同士の隙間をあける */
        padding: 15px;
        background: white;
        border-radius: 8px;
		position: absolute;
        top: 400px; /* 画面の下から30pxの位置に配置 */
        left: 50px;   /* 画面の左から50pxの位置に配置 */
        z-index: 1000; /* 地図などの手前に表示させる */
    }
    .slider-item {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }
	.custom-slider {
        accent-color: #2f7731; /* 緑色にする例（好きなカラーコードや色名） */
		width: 250px;
    }
	.slider-popover {
		top: 575px;                      /* 開閉ボタン (542px) のすぐ下 */
		max-height: calc(100% - 590px);  /* 低い画面では、はみ出さずスクロールにする */
		overflow-y: auto;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}
	/* 結果画面の補足 (所要時間のただし書き、幅員データの網羅率) */
	.summary-note {
		font-size: 12px;
		color: var(--wn-spinner-gray);
	}
	.slider-toggle {
		background: #f0f0f0;
		border: 1px solid #ccc;
		padding: 4px 10px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
	}

</style>
