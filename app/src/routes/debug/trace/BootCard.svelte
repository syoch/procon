<script lang="ts">
  import type { BootRecord, RequestRecord } from "$lib/tracing";

  let {
    request,
    onclick,
  }: {
    request: BootRecord;
    onclick: () => void;
  } = $props();
</script>

<button {onclick} class="request-card">
  <span class="a">{request.bootedAt.toLocaleString()}</span>
  <span class="b">{request.headHash}</span>
  <span class="c">{request.id}</span>
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

  .a {
    position: absolute;
    right: 0;
    top: 0;
  }

  .b {
    text-align: right;
    width: 100px;

    position: absolute;
    left: 0;
    top: 0;
  }

  .c {
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
