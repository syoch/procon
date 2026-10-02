<script lang="ts">
  import type { RequestRecord } from "$lib/tracing";

  let {
    request,
  }: {
    request: RequestRecord;
  } = $props();

  let wholeTime = $derived(request.perf.end - request.perf.start);
</script>

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
      <td>{request.bootId}</td>
    </tr>
    <tr>
      <td>Requested At</td>
      <td>{request.requestedAt}</td>
    </tr>
    <tr>
      <td>Whole time</td>
      <td>{wholeTime.toFixed(2)} ms</td>
    </tr>
    {#each request.perf.entries as p}
      <tr>
        <td>{p.name}</td>
        <td
          >{(p.endTime - p.startTime).toFixed(2)} ms ({(
            ((p.endTime - p.startTime) / wholeTime) *
            100
          ).toFixed(2)}%)</td
        >
      </tr>
    {/each}
  </tbody>
</table>
