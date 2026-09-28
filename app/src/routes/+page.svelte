<script lang="ts">
	import L from "leaflet";
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
	import LoadingScreen from "$lib/components/figma/LoadingScreen.svelte";
	import SearchingOverlay from "$lib/components/figma/SearchingOverlay.svelte";
	import { fade } from "svelte/transition";
	import { onMount } from "svelte";
	import { MainAppContext, type ParameterVariant } from "$lib/app_state.svelte";

	class SelectMarker {
		private point = $state<App.Coordinate | null>(null);
		private projectedPoint = $state<App.Coordinate | null>(null);
		private marker: L.Marker | null = null;

		constructor(map: L.Map) {
			$effect(() => {
				if (!this.projectedPoint) {
					return;
				}
				if (this.marker) {
					this.marker.remove();
				}
				this.marker = L.marker([
					this.projectedPoint.lat,
					this.projectedPoint.lng,
				])
					.setLatLng([this.projectedPoint.lat, this.projectedPoint.lng])
					.addTo(map)
					.bindPopup(
						`Projected Node at ${this.projectedPoint.lat}, ${this.projectedPoint.lng}`,
					);
			});
		}

		public setCoordinate(
			point: App.Coordinate,
			projectedPoint: App.Coordinate,
		) {
			this.point = point;
			this.projectedPoint = projectedPoint;
		}

		public moveFrom(other: SelectMarker) {
			if (this.marker) {
				this.marker.remove();
			}

			this.point = other.point;
			this.projectedPoint = other.projectedPoint;
			this.marker = other.marker;

			other.marker = null;
			other.point = null;
			other.projectedPoint = null;
		}
	}

	// 車種ごとの探索パラメータ(重み)。+page.svelte 側で定義し AppState に渡す。
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

	const ctx = MainAppContext.create(async (q) => {
		const res = await fetch(`/api/location?q=${encodeURIComponent(q)}&limit=5`);
		if (!res.ok) return [];
		const data = (await res.json()) as {
			candidates?: import("$lib/app_state.svelte").LocationCandidate[];
		};
		return data.candidates ?? [];
	}, parameterVariants);

	let map: L.Map | undefined = $state(undefined);
	let error: string | null = $state(null);

	let beginMarker: SelectMarker | null = $state(null);
	let endMarker: SelectMarker | null = $state(null);
	let mapData = $state<App.SearchGraph>({ edges: {}, nodes: {} });
	let pathResult: App.Coordinate[] = $state([]);

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

		if (ctx.state.locationSelection === "begin") {
			ctx.state.begin.state = "confirmed";
			ctx.state.begin.query = `${res.projection.lat}, ${res.projection.lng}`;
			ctx.state.begin.coordinate = res.projection;
		} else {
			ctx.state.end.state = "confirmed";
			ctx.state.end.query = `${res.projection.lat}, ${res.projection.lng}`;
			ctx.state.end.coordinate = res.projection;
		}
	}

	$effect(() => {
		console.log("app locationSelection", ctx.state.locationSelection);
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

	/**
	 * 始点/終点から経路を探索する。
	 * - 選択中の座標は MainAppContext (候補選択 or 地図タッチ) から取得
	 * - 計算中は SearchingOverlay を表示し、完了後に検索結果へ切り替える
	 */
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
		searching = true;
		// オーバーレイを描画してから重い計算に入る
		await new Promise((resolve) => setTimeout(resolve, 0));

		try {
			assertGraph("startSearch", mapData);

			const beginNodeId = transientSplit(mapData, begin);
			const endNodeId = transientSplit(mapData, end);

			console.time("pathFind");
			const result = pathFind(mapData, params, [beginNodeId], [endNodeId]);
			console.timeEnd("pathFind");

			pathResult = pathToCoordinates(result);
			view = "result";
		} catch (e) {
			console.error("[startSearch] 経路探索に失敗", e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			searching = false;
		}
	}
	// 選択中の車種(パラメータプリセット)から探索パラメータを生成する
	const params = $derived.by<App.SearchParameters>(() => {
		const variant: ParameterVariant = ctx.selectedVariant ?? {
			name: "デフォルト",
			lambda: 1,
			mix_score_weight: 0.3,
			view_score_weight: 0.3,
			width_score_weight: 0.3,
		};
		return {
			lambda: variant.lambda,
			mix_score_weight: variant.mix_score_weight,
			view_score_weight: variant.view_score_weight,
			width_score_weight: variant.width_score_weight,
		};
	});

	$effect(() => {
		if (map) {
			beginMarker = new SelectMarker(map);
			endMarker = new SelectMarker(map);
		}
	});

	// 選択中の始点/終点を地図上にピン表示する
	$effect(() => {
		const coordinate = ctx.state.begin.coordinate;
		if (coordinate && beginMarker) {
			beginMarker.setCoordinate(coordinate, coordinate);
		}
	});
	$effect(() => {
		const coordinate = ctx.state.end.coordinate;
		if (coordinate && endMarker) {
			endMarker.setCoordinate(coordinate, coordinate);
		}
	});

	let view: "map" | "search" | "result" = $state("search");
	let splash: "title" | "loading" | null = $state("title");
	let searching = $state(false);

	onMount(() => {
		const toLoading = setTimeout(() => (splash = "loading"), 900);
		const toDone = setTimeout(() => (splash = null), 2200);
		return () => {
			clearTimeout(toLoading);
			clearTimeout(toDone);
		};
	});
</script>

<MapViewer
	bind:map
	bind:mapData
	bind:pathResult
	bind:error
	{onClick}
	doLoadMap={async (
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
	}}
></MapViewer>

{#if view === "map"}
	<div class="menu-button" transition:fade={{ duration: 120 }}>
		<DetailButton onclick={() => (view = "search")} />
	</div>
{/if}

{#if view !== "map"}
	<div
		class="panel-layer"
		transition:fade={{ duration: 300 }}
	>
		<DetailPanel
			{view}
			onback={() => {
				view = view === "result" ? "search" : "map";
			}}
			onsearch={startSearch}
			onresearch={startSearch}
		/>
	</div>
{/if}

{#if searching}
	<SearchingOverlay />
{/if}

{#if error}
	<div class="error-banner" transition:fade={{ duration: 150 }}>{error}</div>
{/if}

{#if splash === "title"}
	<div class="splash" transition:fade={{ duration: 300 }}><TitleScreen /></div>
{:else if splash === "loading"}
	<div class="splash" transition:fade={{ duration: 300 }}><LoadingScreen /></div>
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
</style>
