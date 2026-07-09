// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		type NodeId = string;
		type EdgeId = string;
		type Coordinate = {
			lng: number,
			lat: number
		};
		type MapNode = {
			type: "MapNode",
			id: NodeId,
			coordinate: Coordinate,
			edges: EdgeId[]
		};
		type MapVCrossNode = {
			type: "MapVCrossNode",
			id: NodeId,
			coordinate: Coordinate,
			edges: EdgeId[],
			group_nodes: NodeId[]
		};
		type OSMEdge = {
			type: "OSMEdge",
			id: EdgeId;
			begin: NodeId;
			end: NodeId;

			highway: string;
			width: number;
			sidewalk: string;
		};
		type ComputedEdge = {
			type: "ComputedEdge",
			id: EdgeId;
			begin: NodeId;
			end: NodeId;

			width_score: number;
			view_score: number;
			mix_score: number;
		};

		type OSMGraph = {
			nodes: { [key: NodeId]: MapNode };
			edges: { [key: EdgeId]: OSMEdge };
		};

		type SearchGraph = {
			nodes: { [key: NodeId]: MapVCrossNode };
			edges: { [key: EdgeId]: OSMEdge | ComputedEdge };
		};
	}
}

export { };
