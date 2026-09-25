<script lang="ts">
	import IconBack from "./IconBack.svelte";

	let { onclick }: { onclick?: (e: MouseEvent) => void } = $props();
</script>

<button
	type="button"
	class="back-button wn-pressable"
	aria-label="戻る"
	{onclick}
>
	<IconBack />
</button>

<style>
	.back-button {
		position: absolute;
		top: 0;
		right: 0;
		width: 64px;
		height: 64px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		display: grid;
		place-items: center;
	}
</style>
