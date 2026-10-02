<script lang="ts">
    import {
        isRawBootRecord,
        isRawRequestRecord,
        type BootRecord,
        type RequestRecord,
    } from "$lib/tracing";
    import RequestCard from "./RequestCard.svelte";
    import RequestDetail from "./RequestDetail.svelte";

    let boots = $state<BootRecord[] | Error>([]);
    let requestsBootId = $state<string | undefined>(undefined);
    let requests = $state<RequestRecord[] | Error>([]);
    let selectedRequest = $state<RequestRecord | undefined>(undefined);

    async function fetchBoots(): Promise<BootRecord[]> {
        const res = await fetch("/api/trace/boots");
        const resultObject = await res.json();
        if (!(resultObject instanceof Array)) {
            throw new Error("/api/trace/boots response must be array");
        }
        return resultObject.map((entry) => {
            if (!isRawBootRecord(entry)) {
                throw new Error(
                    "/api/trace/boots response[] must be RawBootRecord",
                );
            }

            return { ...entry, bootedAt: new Date(entry.bootedAt) };
        });
    }

    async function fetchRequests(): Promise<RequestRecord[]> {
        const res = await fetch(
            requestsBootId
                ? `/api/trace/requests?b=${requestsBootId}&s=desc`
                : "/api/trace/requests?s=desc",
        );
        const resultObject = await res.json();
        if (!(resultObject instanceof Array)) {
            throw new Error("/api/trace/requests response must be array");
        }
        return resultObject.map((entry) => {
            if (!isRawRequestRecord(entry)) {
                throw new Error(
                    "/api/trace/requests response[] must be RawRequestInfo",
                );
            }

            return { ...entry, requestedAt: new Date(entry.requestedAt) };
        });
    }

    $effect(() => {
        (async () => {
            try {
                boots = await fetchBoots();
            } catch (error) {
                boots = error as Error;
            }
        })();
    });

    $effect(() => {
        (async () => {
            try {
                requests = await fetchRequests();
            } catch (error) {
                requests = error as Error;
            }
        })();
    });
</script>

<div class="container">
    <div class="boot-list" style="display: none">
        {#if boots instanceof Error}
            <p>Error: {boots.message}</p>
        {:else if boots.length === 0}
            <p>No boots found.</p>
        {:else}
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
        {/if}
        <button
            onclick={async () => {
                try {
                    boots = await fetchBoots();
                } catch (error) {
                    boots = error as Error;
                }
            }}
        >
            Update Boots
        </button>
    </div>

    <div class="req-list">
        {#if requests instanceof Error}
            <p>Error: {requests.message}</p>
        {:else if requests.length === 0}
            <p>No requests found.</p>
        {:else}
            {#each requests as req}
                <RequestCard
                    request={req}
                    onclick={() => {
                        selectedRequest = req;
                    }}
                />
            {/each}
        {/if}
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
