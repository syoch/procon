<script lang="ts">
	import Spinner from "./Spinner.svelte";
</script>

<div class="searching-overlay">
	<Spinner variant="gray" dotRadius={7.16} ringRadius={64} duration={800} />
</div>

<style>
	.searching-overlay {
		position: fixed;
		inset: 0;
		background: var(--wn-scrim);
		display: grid;
		place-items: center;
		z-index: 50;
	}
</style>
