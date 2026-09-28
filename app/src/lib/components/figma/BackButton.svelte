<script lang="ts">
	import IconBack from "./IconBack.svelte";

	let { onclick }: { onclick?: (e: MouseEvent) => void } = $props();
</script>

<button
	type="button"
	class="back-button"
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
		/* Figma 戻るボタン: デフォルト/バリアント2=#b9b9b9/バリアント3=#4b4b4b
		   ホバー→バリアント2, 押下→バリアント3 (ディゾルブ 50ms ease-out-cubic) */
		color: #4b4b4b;
		transition: color 50ms cubic-bezier(0, 0, 0.58, 1);
	}
	.back-button:hover {
		color: #b9b9b9;
	}
	.back-button:active {
		color: #4b4b4b;
	}
</style>
