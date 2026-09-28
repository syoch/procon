<script lang="ts">
	import L from "leaflet";
	import { fade, fly } from "svelte/transition";
	import { cubicOut, backOut } from "svelte/easing";

	import { findNearestEdge, transientSplit } from "$lib/transient-split";
	import { CrossConvert } from "$lib/cross_transform";
	import { fold2DegreeEdges } from "$lib/fold2degree";
	import { pathFind } from "$lib/path_finder";
	import { assertGraph } from "$lib/utils/graph";
	import { loadOSMMap } from "$lib/map_loader/osm";
	import MapViewer from "$lib/components/MapViewer.svelte";
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
	import VehicleSelect from "$lib/components/figma/VehicleSelect.svelte";
	import GreenButton from "$lib/components/figma/GreenButton.svelte";
	import SearchField from "$lib/components/figma/SearchField.svelte";

	let map: L.Map | undefined = $state(undefined);
	let error: string | null = $state(null);
	let beginMarker: SelectMarker | null = $state(null);
	let endMarker: SelectMarker | null = $state(null);

	let mapData = $state<App.SearchGraph>({ edges: {}, nodes: {} });
	let pathResult: App.Coordinate[] = $state([]);
	let isLoading = $state(false);

	const parameterVariants: ParameterVariant[] = [
		{
			name: "徒歩",
			lambda: 1,
			mix_score_weight: 0.3,
			view_score_weight: 0.5,
			width_score_weight: 0.2,
		},
		{
			name: "自転車",
			lambda: 1,
			mix_score_weight: 0.3,
			view_score_weight: 0.4,
			width_score_weight: 0.3,
		},
		{
			name: "車",
			lambda: 1,
			mix_score_weight: 0.3,
			view_score_weight: 0.2,
			width_score_weight: 0.5,
		},
	];
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

	const ctx = MainAppContext.create(locationProvider, parameterVariants, 2);

	function onClick(lat: number, lng: number) {
		console.debug("Clicked at", lat, lng);
		const res = findNearestEdge(mapData, { lat, lng });
		if (!res) {
			console.error("No edge found");
			return;
		}

		if (!ctx.state.locationSelection) {
			return; // no selection mode
		}

		let locationState =
			ctx.state.locationSelection === "begin"
				? ctx.state.begin
				: ctx.state.end;
		locationState.state = "confirmed";
		locationState.query = `${res.projection.lat}, ${res.projection.lng}`;
		locationState.coordinate = res.projection;
	}

	$effect(() => {
		const coordinate = ctx.state.begin.coordinate;
		if (coordinate) {
			beginMarker?.setCoordinate(coordinate);
		}
	});
	$effect(() => {
		const coordinate = ctx.state.end.coordinate;
		if (coordinate) {
			endMarker?.setCoordinate(coordinate);
		}
	});

	function pathToCoordinates(edgeIds: App.EdgeId[]): App.Coordinate[] {
		return edgeIds
			.map((x) => {
				const edge = mapData.edges[x];
				const beginNode = mapData.nodes[edge.begin];
				const endNode = mapData.nodes[edge.end];
				if (!beginNode || !endNode) {
					console.warn(
						`Edge ${edge.id} has missing nodes: begin=${edge.begin}, end=${edge.end}`,
					);
					return [];
				}
				if (edge.type === "FoldedEdge") {
					return [
						beginNode.coordinate,
						...edge.segments
							.map((s) => [s.begin_coordinate, s.end_coordinate])
							.flat(),
						endNode.coordinate,
					].filter(Boolean);
				}
				return [beginNode.coordinate, endNode.coordinate];
			})
			.flat()
			.filter(Boolean);
	}

	async function startSearch() {
		const begin = ctx.state.begin.coordinate;
		const end = ctx.state.end.coordinate;
		if (!begin || !end) {
			error = "始点と終点を指定してください";
			console.error("[startSearch]", error);
			return;
		}
		if (Object.keys(mapData.edges).length === 0) {
			error = "地図データを読み込み中です。少し待って再度お試しください";
			console.error("[startSearch]", error);
			return;
		}

		error = null;
		isLoading = true;
		// オーバーレイを描画してから重い計算に入る
		await new Promise((resolve) => setTimeout(resolve, 0));

		try {
			assertGraph("startSearch", mapData);

			const beginNodeId = transientSplit(mapData, begin);
			const endNodeId = transientSplit(mapData, end);

			console.time("pathFind");
			const result = pathFind(
				mapData,
				ctx.searchParameters,
				[beginNodeId],
				[endNodeId],
			);
			console.timeEnd("pathFind");

			pathResult = pathToCoordinates(result);
			ctx.state.appState = "menu-result";
		} catch (e) {
			console.error("[startSearch] 経路探索に失敗", e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}
	const doLoadMap = async (
		minLat: number,
		minLng: number,
		maxLat: number,
		maxLng: number,
	) => {
		const osmGraph = await loadOSMMap(minLat, minLng, maxLat, maxLng);
		if (osmGraph instanceof Error) {
			throw new Error(osmGraph.message, { cause: osmGraph });
		}
		assertGraph("Retrieved OSM graph", osmGraph);

		console.time("CrossConvert");
		const ccGraph = CrossConvert(osmGraph);
		console.timeEnd("CrossConvert");
		if (ccGraph instanceof Error) {
			throw new Error(ccGraph.message, { cause: ccGraph });
		}
		assertGraph("CrossConverted graph", ccGraph);

		console.time("fold2DegreeEdges");
		const foldGraph = fold2DegreeEdges(ccGraph);
		console.timeEnd("fold2DegreeEdges");
		if (foldGraph instanceof Error) {
			throw new Error(foldGraph.message, { cause: foldGraph });
		}
		assertGraph("Folded graph", foldGraph);

		return foldGraph;
	};
	let latestCallId = 0;
	async function loadMap() {
		const callId = latestCallId + 1;
		latestCallId += 1;

		const bounds = map?.getBounds();
		if (!bounds) {
			console.error("Failed to load map (bounds is falsy)");
			return;
		}
		const minLat = bounds.getSouth();
		const minLng = bounds.getWest();
		const maxLat = bounds.getNorth();
		const maxLng = bounds.getEast();
		console.log(minLat, minLng, maxLat, maxLng);
		isLoading = true;
		try {
			const foldGraph = await doLoadMap(minLat, minLng, maxLat, maxLng);

			// 古い応答が返ってきた場合無視する
			if (latestCallId != callId) {
				return;
			}
			mapData = foldGraph;
		} catch (e) {
			console.error("Error loading map:", e);
		} finally {
			// 最新のリクエストのみ読み込み完了として扱う
			if (latestCallId == callId) {
				isLoading = false;
			}
		}
	}

	// タイトル表示後、0.1s でロゴを降下
	$effect(() => {
		(async () => {
			ctx.state.appState = "boot";
			await new Promise((resolve) => setTimeout(resolve, 1500));
			ctx.state.appState = "menu-detail";
		})();

		return;
	});
	// Leaflet.Map オブジェクトが生成された後の処理
	$effect(() => {
		if (!map) return;

		beginMarker = new SelectMarker(map);
		endMarker = new SelectMarker(map);
		map.whenReady(loadMap);
		map.on("moveend", loadMap);
	});
</script>

<MapViewer bind:map bind:pathResult {onClick}></MapViewer>

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
					<span style="position: absolute; white-space: nowrap; left: 18.3px; top: 104px;"
						>出発点</span
					>
					<span style="position: absolute; white-space: nowrap; left: 30.7px; top: 146px;"
						>地名</span
					>
					<span style="position: absolute; white-space: nowrap; left: 32.8px; top: 196px;"
						>詳細等</span
					>
					<div class="divider" style="top: 253px;"></div>
					<span style="position: absolute; white-space: nowrap; left: 18.5px; top: 278.6px;"
						>終着点</span
					>
					<span style="position: absolute; white-space: nowrap; left: 32.7px; top: 320.2px;"
						>地点</span
					>
					<span style="position: absolute; white-space: nowrap; left: 34.8px; top: 367.6px;"
						>詳細等</span
					>
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

{#if isLoading}
	<SearchingOverlay />
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
