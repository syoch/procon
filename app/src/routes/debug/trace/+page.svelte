<script lang="ts">
    let boots = $state<
        {
            id: string;
            bootedAt: Date;
            headHash: string;
        }[]
    >([]);
    let requestsBootId = $state<string | undefined>(undefined);
    let requests = $state<
        {
            id: string;
            requestedAt: Date;
            bootId: string;
            method: string;
            url: string;
            performance: object;
        }[]
    >([]);

    async function updateBoots() {
        const res = await fetch("/api/trace/boots");
        const resultObject = await res.json();
        if (!(resultObject instanceof Array)) {
            throw new Error("/api/trace/boots response must be array");
        }
        boots = resultObject.map((entry) => {
            if (typeof entry !== "object") {
                throw new Error("/api/trace/boots response[] must be object");
            }
            const id = entry.id;
            if (typeof id !== "string") {
                throw new Error(
                    "/api/trace/boots response[].id must be string",
                );
            }
            const headHash = entry.headHash;
            if (typeof headHash !== "string") {
                throw new Error(
                    "/api/trace/boots response[].headHash must be string",
                );
            }
            const bootedAt = entry.bootedAt;
            if (typeof bootedAt !== "number") {
                throw new Error(
                    "/api/trace/boots response[].bootedAt must be number",
                );
            }

            return { id, headHash: headHash, bootedAt: new Date(bootedAt) };
        });
    }

    $effect(() => {
        (async () => {
            const res = await fetch(
                requestsBootId
                    ? `/api/trace/requests?b=${requestsBootId}`
                    : "/api/trace/requests",
            );
            const resultObject = await res.json();
            if (!(resultObject instanceof Array)) {
                throw new Error("/api/trace/boots response must be array");
            }
            requests = resultObject.map((entry) => {
                if (typeof entry !== "object") {
                    throw new Error(
                        "/api/trace/boots response[] must be object",
                    );
                }
                const id = entry.id;
                if (typeof id !== "string") {
                    throw new Error(
                        "/api/trace/boots response[].id must be string",
                    );
                }
                const requestedAt = entry.requestedAt;
                if (typeof requestedAt !== "number") {
                    throw new Error(
                        "/api/trace/boots response[].requestedAt must be number",
                    );
                }

                const bootId = entry.bootId;
                if (typeof bootId !== "string") {
                    throw new Error(
                        "/api/trace/boots response[].bootId must be string",
                    );
                }
                const method = entry.method;
                if (typeof method !== "string") {
                    throw new Error(
                        "/api/trace/boots response[].method must be string",
                    );
                }
                const url = entry.url;
                if (typeof url !== "string") {
                    throw new Error(
                        "/api/trace/boots response[].url must be string",
                    );
                }
                const perf = entry.perf as object;
                if (typeof perf !== "object") {
                    throw new Error(
                        "/api/trace/boots response[].perf must be object",
                    );
                }

                return {
                    id: id,
                    requestedAt: new Date(requestedAt),
                    bootId: bootId,
                    method: method,
                    url: url,
                    performance: perf,
                };
            });
        })();
    });

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
                <td>{boot.bootedAt.toISOString()}</td>
                <td>{boot.headHash}</td>
            </tr>
        {/each}
    </tbody>
</table>
<table>
    <thead>
        <tr>
            <th>id</th>
            <th>requestedAt</th>
            <th>bootId</th>
            <th>method</th>
            <th>url</th>
            <th>performance</th>
        </tr>
    </thead>
    <tbody>
        {#each requests as req}
            <tr>
                <td>{req.id}</td>
                <td>{req.requestedAt.toISOString()}</td>
                <td>{req.bootId}</td>
                <td>{req.method}</td>
                <td>{req.url}</td>
                <td>{req.performance}</td>
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

<button onclick={updateBoots}> Update Boots </button>
