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
	import { fade, fly } from "svelte/transition";
	import { MainAppContext } from "$lib/app_state.svelte";

	class SelectMarker {
		public point = $state<App.Coordinate | null>(null);
		public projectedPoint = $state<App.Coordinate | null>(null);
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

	const ctx = MainAppContext.create(async (q) => {
		console.log(q);
		return [];
	});

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

	function doFindPath() {
		assertGraph("doFindPath top", mapData);
		if (!beginMarker || !endMarker) {
			console.error("Begin or end marker is not set");
			return;
		}
		if (!beginMarker.projectedPoint || !endMarker.projectedPoint) {
			console.error("Begin or end marker projected point is not set");
			return;
		}
		if (
			beginMarker.projectedPoint.lat === 0 &&
			beginMarker.projectedPoint.lng === 0
		) {
			console.error("Begin marker is not set");
			return;
		}
		if (
			endMarker.projectedPoint.lat === 0 &&
			endMarker.projectedPoint.lng === 0
		) {
			console.error("End marker is not set");
			return;
		}

		const beginNodeId = transientSplit(mapData, beginMarker.projectedPoint);
		const endNodeId = transientSplit(mapData, endMarker.projectedPoint);

		console.time("pathFind"); //parms
		const result = pathFind(mapData, params, [beginNodeId], [endNodeId]);
		console.timeEnd("pathFind");

		pathResult = result
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
	let params = $state<App.SearchParameters>({
		lambda: 1,
		mix_score_weight: 0.3,
		view_score_weight: 0.3,
		width_score_weight: 0.3,
	});

	$effect(() => {
		if (map) {
			beginMarker = new SelectMarker(map);
			endMarker = new SelectMarker(map);
		}
	});

	let view: "map" | "search" | "result" = $state("search");
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
		transition:fly={{ x: -40, duration: 220, opacity: 0 }}
	>
		<DetailPanel
			{view}
			onback={() => {
				view = view === "result" ? "search" : "map";
			}}
			onsearch={() => (view = "result")}
		/>
	</div>
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
</style>
