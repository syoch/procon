<script lang="ts">
	import IconMenu from "./IconMenu.svelte";

	let { onclick }: { onclick?: (e: MouseEvent) => void } = $props();
</script>

<button
	type="button"
	class="detail-button wn-pressable"
	aria-label="検索パネルを開く"
	{onclick}
>
	<IconMenu />
</button>

<style>
	.detail-button {
		width: 64px;
		height: 64px;
		padding: 0;
		border: none;
		background: var(--wn-panel);
		box-shadow: var(--wn-shadow);
		cursor: pointer;
		display: grid;
		place-items: center;
	}
</style>
