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
    import { queryParameters } from "sveltekit-search-params";

    let boots = $state<BootRecord[] | Error>([]);
    let requests = $state<RequestRecord[] | Error>([]);

    const sideview = () => ({
        encode: (value: "boots" | "requests") => value,
        decode: (value: string | null) => {
            if (value === "boots" || value === "requests") {
                return value;
            }
            return "boots";
        },
    });
    const optionalString = () => ({
        encode: (value: string | null) => value ?? "",
        decode: (value: string | null) => (value === null ? undefined : value),
    });
    let st = queryParameters(
        {
            bootId: optionalString(),
            requestId: optionalString(),
            sideView: sideview(),
        },
        {},
    );

    async function fetchBoots(): Promise<BootRecord[]> {
        const res = await fetch("/api/trace/boots?s=desc");
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
            st.bootId
                ? `/api/trace/requests?s=desc&b=${st.bootId}`
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

    let selectedRequest = $derived(
        requests instanceof Array && st.requestId
            ? requests.find((r) => r.id === st.requestId)
            : null,
    );
</script>

<div class="container">
    <div class="sidebar">
        <div class="actions">
            <button
                class:active={st.sideView === "boots"}
                onclick={() => {
                    st.sideView = "boots";
                }}
            >
                Boots
            </button>
            <button
                class:active={st.sideView === "requests"}
                onclick={() => {
                    st.sideView = "requests";
                }}
            >
                Requests
            </button>
        </div>
        <div class="boot-list" class:active={st.sideView === "boots"}>
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
            {#if boots instanceof Error}
                <p>Error: {boots.message}</p>
            {:else if boots.length === 0}
                <p>No boots found.</p>
            {:else}
                {#each boots as boot}
                    <BootCard
                        request={boot}
                        active={st.bootId === boot.id}
                        onclick={() => {
                            st.bootId = st.bootId == boot.id ? null : boot.id;
                            st.requestId = null;
                            st.sideView = "requests";
                        }}
                    />
                {/each}
            {/if}
        </div>

        <div class="req-list" class:active={st.sideView === "requests"}>
            <button
                onclick={async () => {
                    try {
                        requests = await fetchRequests();
                    } catch (error) {
                        requests = error as Error;
                    }
                }}
            >
                Update Requests
            </button>
            {#if requests instanceof Error}
                <p>Error: {requests.message}</p>
            {:else if requests.length === 0}
                <p>No requests found.</p>
            {:else}
                {#each requests as req}
                    <RequestCard
                        request={req}
                        active={st.requestId === req.id}
                        onclick={() => {
                            st.requestId =
                                st.requestId === req.id ? null : req.id;
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
