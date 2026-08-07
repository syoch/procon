<script lang="ts">
  import { Network } from "vis-network";

  let {
    mapData,
    startNode,
    endNode,
    travelingNodes,
  }: {
    mapData: App.GenericMap;
    startNode: App.NodeId[];
    endNode: App.NodeId[];
    travelingNodes: App.NodeId[];
  } = $props();

  let graphDivElement: HTMLDivElement | undefined = $state(undefined);
  let network: Network | undefined = $state(undefined);

  $effect(() => {
    if (!graphDivElement) {
      return;
    }
    network = new Network(
      graphDivElement,
      {
        nodes: Object.values(mapData.nodes).map((node, i) => ({
          id: node.id,
          label: node.id,
          color: travelingNodes.includes(node.id)
            ? "yellow"
            : startNode.includes(node.id)
              ? "green"
              : endNode.includes(node.id)
                ? "red"
                : "gray",
          x: (i % 10) * 100,
          y: Math.floor(i / 10) * 100,
        })),
        edges: Object.values(mapData.edges).map((edge) => ({
          from: edge.begin,
          to: edge.end,
          label: `${edge.id}\n${edge.type}`,
          color:
            edge.type === "FoldedEdge"
              ? "green"
              : edge.type === "MapVCrossEdge"
                ? "red"
                : edge.type === "ComputedEdge"
                  ? "blue"
                  : "gray",
        })),
      },
      {
        physics: {
          stabilization: { enabled: true },
        },
      },
    );

    return () => {
      network?.destroy();
      network = undefined;
    };
  });
</script>

<div id="graph" bind:this={graphDivElement}></div>

<style>
  #graph {
    width: 100%;
    height: 100%;
  }
</style>
