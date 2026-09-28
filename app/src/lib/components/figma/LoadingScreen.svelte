<script lang="ts">
	import Spinner from "./Spinner.svelte";
</script>

<div class="loading-screen">
	<Spinner variant="green" dotRadius={10.72} ringRadius={64} />
</div>

<style>
	.loading-screen {
		position: fixed;
		inset: 0;
		background: var(--wn-green);
		display: grid;
		place-items: center;
		z-index: 100;
	}
</style>
