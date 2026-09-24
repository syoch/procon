<script lang="ts">
    import { CrossConvert } from "$lib/cross_transform";
    import { fold2DegreeEdges } from "$lib/fold2degree";
    import { debugMapCCMap, debugMapOSMMap, debugMapSearchMap } from "$lib/mocks/debug_map";
    import DebugGraphViewer from "$lib/ui/debug_graph_viewer.svelte";
    import Button from "@smui/button";
    let map: App.GenericMap = $state(debugMapOSMMap);

    function loadMap(newMap: App.GenericMap | Error) {
        if (newMap instanceof Error) {
            console.error("loadMap failed with error", newMap);
            return;
        }
        console.group("Updating map information");
        console.log(map);
        console.log(newMap);
        console.groupEnd();
        map = newMap;
    }
</script>

<DebugGraphViewer mapData={map} startNode={[]} endNode={[]} travelingNodes={[]}
></DebugGraphViewer>
<div id="float-actions">
    <Button onclick={() => loadMap(debugMapOSMMap)}>OSM Map</Button>
    <Button onclick={() => loadMap(debugMapCCMap)}>Cross Converted Map</Button>
    <Button onclick={() => loadMap(debugMapSearchMap)}>Search Map</Button>
    <Button
        onclick={() => loadMap(CrossConvert(map as App.OSMGraph))}>Cross Convert</Button
    >
    <Button
        onclick={() => loadMap(fold2DegreeEdges(map as App.CrossConvertedGraph))}>fold2deg</Button
    >
</div>

<div id="info">info</div>

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
    div#info {
        position: absolute;
        bottom: 10px;
        right: 10px;
        background-color: rgba(255, 255, 255, 0.7);
        border-radius: 10px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        padding: 10px;
        font-size: 14px;
        line-height: 1.5;
    }
</style>
