<script lang="ts">
    let boots = $state<
        {
            id: string;
            booted_at: Date;
            head_hash: string;
        }[]
    >([]);

    async function updateBoots() {
        const res = await fetch("/api/trace/boots");
        boots = await res.json();
    }

    $effect(() => {
        (async () => {
            await updateBoots();
        })();
    });
</script>

<h1>Monitor</h1>

<table>
    <thead>
        <tr>
            <th>id</th>
            <th>booted_at</th>
            <th>head_hash</th>
        </tr>
    </thead>
    <tbody>
        {#each boots as boot}
            <tr>
                <td>{boot.id}</td>
                <td>{boot.booted_at}</td>
                <td>{boot.head_hash}</td>
            </tr>
        {/each}
    </tbody>
</table>

<button
    onclick={() => {
        fetch("/api/path-find", {
            body: '{"begin":{"lat":37.53301,"lng":138.90753},"end":{"lat":37.44543,"lng":138.85706},"parameters":{"lambda":1,"mix_score_weight":0.3,"view_score_weight":0.2,"width_score_weight":0.5},"mode":"car"}',
            method: "POST",
        });
    }}>Request path-find</button
>

<button
    onclick={() => {
        fetch("/api/preload-osm", {
            body: '{"minLat":37.265856413757696,"minLng":138.68865966796878,"maxLat":37.694687703235914,"maxLng":138.97361755371097}',
            method: "POST",
        });
    }}
>
    Request Preload
</button>

<button onclick={updateBoots}>
    Update Boots
</button>