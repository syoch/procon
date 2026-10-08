<script lang="ts">
	import L from "leaflet";
	import { fade, fly } from "svelte/transition";
	import { cubicOut, backOut } from "svelte/easing";

	import { findNearestEdge } from "$lib/transient-split";
	import { CrossConvert } from "$lib/cross_transform";
	import { fold2DegreeEdges } from "$lib/fold2degree";
	import { assertGraph } from "$lib/utils/graph";
	import { loadOSMMap } from "$lib/map_loader/osm";
	import MapViewer from "$lib/components/MapViewer.svelte";
	import type { SharpTurn } from "$lib/sharp_turn";
	import type { PathFindResult } from "./api/path-find/pathFind";
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
	

	let map: L.Map | undefined = $state(undefined);
	let error: string | null = $state(null);
	let beginMarker: SelectMarker | null = $state(null);
	let endMarker: SelectMarker | null = $state(null);

	let pathResult: App.Coordinate[] = $state([]);
	let sharpTurns: SharpTurn[] = $state([]);
	let totalDistance = $state<number | undefined>(undefined);
	let totalIntersections = $state<number | undefined>(undefined);
	/** 手動・自動を問わず検索を実行済みか（$state ではない） */
	let hasSearched = false;
	let informationGraph=$state<App.InformationGraph>({ type: [], distance: [], tags: [] ,crossingRoadNames: []});

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
		locationState.query = `${lat}, ${lng}`;
		locationState.displayName = undefined;
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
		showSliders = false;
		error = null;
		hasSearched = true;
		pathResult = [];
		totalDistance = 0;
		totalIntersections = 0;
		sharpTurns = [];
		informationGraph = { type: [], distance: [], tags: [], crossingRoadNames: []};

		const totalSlider = slider1 + slider2 + slider3;

		const params: App.SearchParameters = {
			...ctx.searchParameters,
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

		if (!res.ok) {
			error = `/api/path-find API エラー: ${res.status}`;
			return false;
		}

		try {
			const resObj: PathFindResult = await res.json();

			if (!resObj.found) {
				// 到達できない理由 (目的地の近くに通れる道が無い など) をそのまま表示する
				error = resObj.message ?? "経路が見つかりませんでした。";
				return false;
			}

			pathResult = resObj.coords;
			totalDistance = resObj.totalDistance;
			totalIntersections = resObj.totalIntersections;
			sharpTurns = resObj.sharpTurns ?? [];
			informationGraph = resObj.infoGraph;
			ctx.state.appState = "menu-result";
		} catch (e) {
			error = "サーバー応答の読み取りエラーが発生しました";
			return false;
		}
		return true;
	}
	async function loadMap() {
		const bounds = map?.getBounds();
		if (!bounds) {
			console.error("Failed to load map (bounds is falsy)");
			return;
		}
		const minLat = bounds.getSouth();
		const minLng = bounds.getWest();
		const maxLat = bounds.getNorth();
		const maxLng = bounds.getEast();

		try {
			await fetch("/api/preload-osm", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
			  minLat,
			  minLng,
			  maxLat,
			  maxLng
			}),
  		});

		} catch (e) {
			console.error("Error loading map:", e);
		} finally {
			
		}
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
		ctx.state.bindMap(map, loadMap);
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

	$effect(()=> { 
		const params = ctx.state.parameterVariants[
	  		ctx.state.selectedVariantIndex
		];
		slider1 = params.mix_score_weight * 100;
		slider2 = params.view_score_weight * 100;
		slider3 = params.width_score_weight * 100;
	});

	/*交差する道路の名前をソートして比較する関数*/
	function isSameCrossing(
		str1: string | null | undefined, 
		str2: string | null | undefined
	): boolean {
		// どちらかが null や undefined、空文字なら単純比較
		if (!str1 || !str2) return str1 === str2;

		// カンマなどで複数の道路名が入っている場合を考慮し、
		// 分割してソート（五十音順に並び替え）してから比較する
		const sorted1 = str1.split(",").sort().join(",");
		const sorted2 = str2.split(",").sort().join(",");

		return sorted1 === sorted2;
	}

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

				{:else}
					<span
						style="position: absolute; white-space: nowrap; left: 18.3px; top: 100px;"
						>始点</span
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
						>終点</span
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
					<span style="position: absolute; white-space: nowrap; left: 32.8px; top: 375px;">
						総走行距離: {((totalDistance ?? 0) / 1000).toFixed(2)} km
					</span>
					<!--<span style="position: absolute; white-space: nowrap; left: 32.8px; top: 390px;">
						総通過交差点数: {totalIntersections ?? 0} 個
					</span>-->
					<div class="divider" style="top: 425.5px;"></div>
					<div
						style="position: absolute; top: 454.5px; display: flex;"
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
					

 
	

<div style="position: absolute; left: 50px; top: 500px;">
	<button type="button" class="slider-toggle" onclick={() => (showSliders = !showSliders)}>
		{showSliders ? "▲ スコア調整を閉じる" : "▼ スコアを調整する"}
	</button>
</div>


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
				/*交差点数のカウントは，前回曲がった交差点から何個目の交差点かを示している。*/
				const aggregated = [];
				let accumDist = 0;
				let accumCross = 0;
				/*Uターン判定用*/
				let isUTurn = 0;
				let prev_n = "";
				let distFromPrevCross = 999;

				for (let i = 0; i < informationGraph.type.length; i++) {
					const type = informationGraph.type[i];
					const distance = informationGraph.distance[i];
					const name = informationGraph.tags[i - 1]?.name ?? "";
					const next_name = informationGraph.tags[i + 1]?.name ?? "";
					const crossingRoad = informationGraph.crossingRoadNames[i] ?? "";
					const prev_crossingRoad = informationGraph.crossingRoadNames[i-2] ?? "";

					accumDist += distance;
					distFromPrevCross += distance;

					//走行距離(accumDist)が21m以上になったら、Uターン待ちを解除
    				if (isUTurn === 1 && accumDist > 21) {
						accumCross=0;
        				isUTurn = 0;
    				}

					if (type === "start" || type === "segments") {
						continue;
					}

					/*名前タグのない道路でd<21mだとUターンにしてしまうのを防ぐ処理*/
					/*実際に同じ道でUターンする場合は，informationGraphの段階でtype="uturn"となっていることを考慮している*/
					if(isUTurn===1&&accumDist<21&&type==="right"&&next_name===""){
						isUTurn=0;
					}

					/*中央分離帯のある道路から右折したとき，交差点数が+1されてしまう問題を解決する処理*/
					if(isUTurn===1 && accumDist<21 && type!=="right" && name!==""){
						accumCross--;
						isUTurn=0;
					}

					/*中央分離帯のある道路を横切るとき，交差点が+1されてしまうのを防ぐ処理(21m以下の小さい道路の交差点を配慮)*/
					if(distFromPrevCross<21){
						if (crossingRoad!=="" && prev_crossingRoad!=="" && isSameCrossing(crossingRoad, prev_crossingRoad) ) {
                            accumCross--;
                        }
					}

					if (type === "straight") {
						distFromPrevCross=0;
						accumCross++;
					}else if(type==="right"){
						if(isUTurn===0){/*1回目の右折は通常と同じ判定*/
							if (Math.round(accumDist) > 0) {
						 		aggregated.push({
									type: "straight",
									distance: Math.round(accumDist),
									cross: accumCross,
									name: name,
									nextname: next_name,
								});

								aggregated.push({
									type: type,
									distance: 0,
									cross: accumCross + 1,
									name: name,
									nextname: informationGraph.tags[i + 3]?.name ?? "",/*中央分離帯がある可能性を考慮*/
								});
							} else if (Math.round(accumDist) === 0) {//0mだったとき
								aggregated.push({ 
								type: type,
								distance: 0,
								cross: accumCross+1,
								name: name,
								nextname: next_name,
								});				
							}
							accumDist = 0;
							distFromPrevCross=0;
							isUTurn++;
							prev_n=informationGraph.tags[i - 1]?.name ?? "";
						}else if(isUTurn===1){
							/*同じ名前の交差点で2回右折かつ距離が短い場合はUターンと判定*/
							if(prev_n===next_name&&accumDist<21){
								/*前に入れた右折を削除*/
								aggregated.pop();
								/*Uターンとして追加*/
								aggregated.push({
									type: "uturn",
									distance: 0,
									cross: accumCross + 2,/*中央分離帯のある道路を横切るとき，交差点が+1されてしまうのを防ぐ処理に必ず入るので+2*/
									name: name,
									nextname: next_name,
								});
								
							}else{
								/*Uターンではない場合は通常の右折として追加*/
								if (Math.round(accumDist) > 0) {
							 		aggregated.push({
										type: "straight",
										distance: Math.round(accumDist),
										cross: accumCross,
										name: name,
										nextname: next_name,
									});
									aggregated.push({
										type: type,
										distance: 0,
										cross: accumCross + 1,
										name: name,
										nextname: informationGraph.tags[i + 1],
									});
								} else if (Math.round(accumDist) === 0) {//0mだったとき
									aggregated.push({ 
									type: type,
									distance: 0,
									cross: accumCross+1,
									name: name,
									nextname: next_name,
									});
								} 
							}
							accumDist = 0;
							accumCross = 0;
							isUTurn=0;
							distFromPrevCross=0;
						}
						
					}else if (type === "left"|| type === "uturn") {
						// transientSplit が長さ0のエッジを拒否するため、現実の道路網データではここに到達しない。
						// 万が一到達した場合は意図的に無視する（UIに距離0の案内を出さないため）。
						if (Math.round(accumDist) > 0) {
					 		aggregated.push({
								type: "straight",
								distance: Math.round(accumDist),
								cross: accumCross,
								name: name,
								nextname: next_name,
							});

							aggregated.push({
								type: type,
								distance: 0,
								cross: accumCross + 1,
								name: name,
								nextname: next_name,
							});
						} else if (Math.round(accumDist) === 0) {//0mだったとき
							aggregated.push({ 
								type: type,
								distance: 0,
								cross: accumCross+1,
								name: name,
								nextname: next_name,
							});
							
						}
						accumDist = 0;
						accumCross = 0;
						isUTurn=0;
						distFromPrevCross = 0;
					}else if (i === informationGraph.type.length - 1) {
						if (accumDist > 0 || accumCross > 0) {
							aggregated.push({
								type: "finish",
								distance: Math.round(accumDist),
								cross: accumCross,
								name: name,
								nextname: next_name,
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


						<!--後で道路名を表示させるかも-->
						<div class="text-sub">
							{#if step.type === "straight"}
								{step.name}
							{:else if step.type === "finish"}
								{step.name}
							{/if}

							{#if (step.type === "right" || step.type === "left") && step.nextname !== ""}
           							{step.nextname}へ
							{:else if step.name !== step.nextname && step.name!=="" && step.nextname!==""}
								{#if step.type === "right" || step.type === "left"}
									{step.name}から{step.nextname}へ
								{/if}

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
				<div class="text-title">終点</div>
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
		top: 550px; /* 上部の出発点・終着点情報が収まる位置より下に配置 */
		left: 10px; /* 左側の余白を調整 */
		width: 95%;
		height: calc(100% - 550px); /* パネルの残り全体の高さに合わせる */
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
		top: 535px;                      /* 開閉ボタン (500px) のすぐ下 */
		max-height: calc(100% - 550px);  /* 低い画面では、はみ出さずスクロールにする */
		overflow-y: auto;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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
