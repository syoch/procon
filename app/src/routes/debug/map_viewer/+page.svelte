<script lang="ts">
  import {
    debugMapCCMap,
    debugMapOSMMap,
    debugMapSearchMap,
  } from "$lib/mocks/debug_map";
  import DebugMapViewer from "$lib/ui/debug_map_viewer.svelte";
  import DebugGraphViewer from "$lib/ui/debug_graph_viewer.svelte";
  import Button from "@smui/button";

  let mapData: App.GenericMap = $state(debugMapSearchMap);

  let activeTab: string = $state("map");

  let customMapData: string = $state("");
  function loadMap(map: App.GenericMap) {
    mapData = map;
    customMapData = JSON.stringify(map);
  }
  function loadMapFromJSON(json: string) {
    try {
      mapData = JSON.parse(json) as App.GenericMap;
    } catch (e) {
      alert("Invalid JSON");
    }
  }

  let mapViewer: DebugMapViewer | undefined = $state(undefined);
</script>

{#if activeTab === "map"}
  <DebugMapViewer {mapData} bind:this={mapViewer} />
{:else if activeTab === "graph"}
  <DebugGraphViewer {mapData} startNode={[]} endNode={[]} travelingNodes={[]}
  ></DebugGraphViewer>
{/if}

<div id="float-actions">
  <Button onclick={() => loadMap(debugMapOSMMap)}>OSM Map</Button>
  <Button onclick={() => loadMap(debugMapCCMap)}>Cross Converted Map</Button>
  <Button onclick={() => loadMap(debugMapSearchMap)}>Search Map</Button>
  <input bind:value={customMapData} placeholder="マップ文字列" />
  <Button onclick={() => loadMapFromJSON(customMapData)}
    >マップ文字列読み込み</Button
  >
  <Button onclick={() => mapViewer?.clearMap()}>マップクリア</Button>
  <Button
    onclick={() => {
      activeTab = activeTab === "map" ? "graph" : "map";
    }}>toggle tab</Button
  >
</div>

<style>
  #float-actions {
    position: absolute;
    bottom: 10px;
    left: 10px;
    background-color: rgba(255, 255, 255, 0.7);
    border-radius: 10px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);

    display: flex;
    flex-direction: column;
  }
</style>
