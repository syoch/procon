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
		error = null;
		hasSearched = true;
		pathResult = [];
		totalDistance = 0;
		totalIntersections = 0;
		sharpTurns = [];

		// 送るのは重みの数値だけ (プリセットの表示名などは含めない)
		const { lambda, mix_score_weight, view_score_weight, width_score_weight } = ctx.searchParameters;
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
</script>

<MapViewer bind:map bind:pathResult {sharpTurns} {onClick}></MapViewer>

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
						style="position: absolute; white-space: nowrap; left: 18.3px; top: 104px;"
						>出発点</span
					>
					<span
						style="position: absolute; white-space: nowrap; left: 30.7px; top: 146px;"
						>地名</span
					>
					<span
						style="position: absolute; white-space: nowrap; left: 32.8px; top: 196px;"
						>詳細等</span
					>
					<div class="divider" style="top: 253px;"></div>
					<span
						style="position: absolute; white-space: nowrap; left: 18.5px; top: 278.6px;"
						>終着点</span
					>
					<span
						style="position: absolute; white-space: nowrap; left: 32.7px; top: 320.2px;"
						>地点</span
					>
					<span style="position: absolute; white-space: nowrap; left: 34.8px; top: 367.6px;">
						総走行距離: {((totalDistance ?? 0) / 1000).toFixed(2)} km <br>
						総通過交差点数: {totalIntersections ?? 0} 個
					</span>
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
</style>
