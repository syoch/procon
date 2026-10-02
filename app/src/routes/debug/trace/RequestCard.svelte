<script lang="ts">
  import type { RequestRecord } from "$lib/tracing";

  let {
    request,
    onclick,
  }: {
    request: RequestRecord;
    onclick: () => void;
  } = $props();

  let durationMs = $derived(
    `${(request.perf.end - request.perf.start).toFixed(2)} ms`,
  );
</script>

<button {onclick} class="request-card">
  <span class="digest"
    >{request.method} {request.requestedAt.toLocaleString()}</span
  >
  <span class="duration">{durationMs}</span>
  <span class="url"
    >{request.url.replace(/http(s?):\/\//, "").replace(location.host, "")}</span
  >
</button>

<style>
  .request-card {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    height: 3rem;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background-color: #f9f9f9;
    cursor: pointer;

    position: relative;

    * {
      margin: 0.1rem;
    }
  }

  .request-card:hover {
    background-color: #e6e6e6;
  }

  .digest {
    position: absolute;
    right: 0;
    top: 0;
  }

  .duration {
    text-align: right;
    width: 100px;

    position: absolute;
    left: 0;
    top: 0;
  }

  .url {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    width: 100%;

    position: absolute;
    right: 0;
    bottom: 0;
  }
</style>
