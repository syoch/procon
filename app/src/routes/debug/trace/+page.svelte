<script lang="ts">
    import {
        isRawBootRecord,
        isRawRequestRecord,
        type BootRecord,
        type RequestRecord,
    } from "$lib/tracing";
    import BootCard from "./BootCard.svelte";
    import RequestCard from "./RequestCard.svelte";
    import RequestDetail from "./RequestDetail.svelte";

    let boots = $state<BootRecord[] | Error>([]);
    let requestsBootId = $state<string | undefined>(undefined);
    let requests = $state<RequestRecord[] | Error>([]);
    let selectedRequest = $state<RequestRecord | undefined>(undefined);
    let sideView = $state<"boots" | "requests">("boots");

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
    <div class="sidebar">
        <div class="actions">
            <button
                class:active={sideView === "boots"}
                onclick={() => {
                    sideView = "boots";
                }}
            >
                Boots
            </button>
            <button
                class:active={sideView === "requests"}
                onclick={() => {
                    sideView = "requests";
                }}
            >
                Requests
            </button>
        </div>
        <div class="boot-list" class:active={sideView === "boots"}>
            {#if boots instanceof Error}
                <p>Error: {boots.message}</p>
            {:else if boots.length === 0}
                <p>No boots found.</p>
            {:else}
                {#each boots as boot}
                    <BootCard
                        request={boot}
                        onclick={() => {
                            requestsBootId = boot.id;
                            sideView = "requests";
                        }}
                    />
                {/each}
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

        <div class="req-list" class:active={sideView === "requests"}>
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
        .sidebar {
            display: flex;
            flex-direction: column;
            div.req-list,
            div.boot-list {
                display: none;
                flex-direction: column;
                gap: 0.5rem;
                width: 300px;
            }
            div.active {
                display: flex;
                background-color: #f0f0f0;
            }
        }
        .req-detail {
            margin-top: 1rem;
        }
    }
</style>
