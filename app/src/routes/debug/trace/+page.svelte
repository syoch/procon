<script lang="ts">
    import {
        isRawBootRecord,
        isRawRequestRecord,
        type RequestRecord,
    } from "$lib/tracing";
    import RequestCard from "./RequestCard.svelte";
    import RequestDetail from "./RequestDetail.svelte";

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
                throw new Error(
                    "/api/trace/boots response[] must be RawBootRecord",
                );
            }

            return { ...entry, bootedAt: new Date(entry.bootedAt) };
        });
    }

    $effect(() => {
        (async () => {
            const res = await fetch(
                requestsBootId
                    ? `/api/trace/requests?b=${requestsBootId}&s=desc`
                    : "/api/trace/requests?s=desc",
            );
            const resultObject = await res.json();
            if (!(resultObject instanceof Array)) {
                throw new Error("/api/trace/boots response must be array");
            }
            requests = resultObject.map((entry) => {
                if (!isRawRequestRecord(entry)) {
                    console.log(entry);
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

<div class="container">
    <div class="boot-list" style="display: none">
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
    </div>

    <div class="req-list">
        {#each requests as req}
            <RequestCard
                request={req}
                onclick={() => {
                    selectedRequest = req;
                }}
            />
        {/each}
    </div>

    {#if selectedRequest}
        <div class="req-detail">
            <RequestDetail request={selectedRequest} />
        </div>
    {/if}
</div>

<style>
    .container {
        display: flex;
        flex-direction: row;
        gap: 1rem;
        margin: 10px;
        .req-list {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            width: 300px;
        }
        .req-detail {
            margin-top: 1rem;
        }
    }
</style>
