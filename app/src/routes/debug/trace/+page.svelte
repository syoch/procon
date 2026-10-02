<script lang="ts">
    import { isRawBootRecord, isRawRequestRecord, type RequestRecord } from "$lib/tracing";

    let boots = $state<
        {
            id: string;
            bootedAt: Date;
            headHash: string;
        }[]
    >([]);
    let requestsBootId = $state<string | undefined>(undefined);
    let requests = $state<RequestRecord[]>([]);
    let selectedRequest = $state<RequestRecord | undefined>(undefined);

    async function updateBoots() {
        const res = await fetch("/api/trace/boots");
        const resultObject = await res.json();
        if (!(resultObject instanceof Array)) {
            throw new Error("/api/trace/boots response must be array");
        }
        boots = resultObject.map((entry) => {
            if (!isRawBootRecord(entry)) {
                throw new Error("/api/trace/boots response[] must be RawBootRecord");
            }

            return {...entry, bootedAt: new Date(entry.bootedAt)};
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
                if (!isRawRequestRecord(entry)) {
                    console.log(entry)
                    throw new Error(
                        "/api/trace/boots response[] must be RawRequestInfo",
                    );
                }

                return {
                    id: entry.id,
                    requestedAt: new Date(entry.requestedAt),
                    bootId: entry.bootId,
                    method: entry.method,
                    url: entry.url,
                    perf: entry.perf,
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

<table>
    <thead>
        <tr>
            <th>booted_at</th>
            <th>head_hash</th>
        </tr>
    </thead>
    <tbody>
        {#each boots as boot}
            <tr>
                <td>{boot.bootedAt.toISOString()}</td>
                <td>{boot.headHash}</td>
            </tr>
        {/each}
    </tbody>
</table>
<button onclick={updateBoots}> Update Boots </button>

<table>
    <thead>
        <tr>
            <th>requestedAt</th>
            <th>method</th>
            <th>url</th>
            <th>whole time</th>
        </tr>
    </thead>
    <tbody>
        {#each requests as req}
            <tr>
                <td>
                    <button
                        onclick={() => {
                            selectedRequest = req;
                        }}
                    >
                        {req.requestedAt.toISOString()}
                    </button>
                </td>
                <td>{req.method}</td>
                <td>{req.url}</td>
                <td
                    >{(req.perf.end - req.perf.start).toFixed(2)} ms</td
                >
            </tr>
        {/each}
    </tbody>
</table>

{#if selectedRequest}
    <section>
        <h2>Request - {selectedRequest.id}</h2>
        <table>
            <thead>
                <tr>
                    <th>label</th>
                    <th>value</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Boot ID</td>
                    <td>{selectedRequest.bootId}</td>
                </tr>
                <tr>
                    <td>Requested At</td>
                    <td>{selectedRequest.requestedAt}</td>
                </tr>
                <tr>
                    <td>Whole time</td>
                    <td
                        >{(
                            selectedRequest.perf.end -
                            selectedRequest.perf.start
                        ).toFixed(2)} ms</td
                    >
                </tr>
                {#each selectedRequest.perf.entries as p}
                    <tr>
                        <td>{p.name}</td>
                        <td>{(p.endTime - p.startTime).toFixed(2)} ms</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </section>
{/if}
