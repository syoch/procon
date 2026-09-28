<script lang="ts">
	import IconMenu from "./IconMenu.svelte";

	let { onclick }: { onclick?: (e: MouseEvent) => void } = $props();
</script>

<button
	type="button"
	class="detail-button"
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
		background: var(--wn-white);
		box-shadow: var(--wn-shadow);
		cursor: pointer;
		display: grid;
		place-items: center;
		/* Figma 詳細ボタン: ホバー→バリアント2 (背景 #7ecdea, 100ms),
		   押下→バリアント3 (背景 #7ecdea / アイコン #adadad, 50ms) */
		color: #4b4b4b;
		transition:
			background-color 100ms cubic-bezier(0, 0, 0.58, 1),
			color 100ms cubic-bezier(0, 0, 0.58, 1);
	}
	.detail-button:hover {
		background: #7ecdea;
		color: #b9b9b9;
	}
	.detail-button:active {
		background: #7ecdea;
		color: #adadad;
		transition-duration: 50ms;
	}
</style>
