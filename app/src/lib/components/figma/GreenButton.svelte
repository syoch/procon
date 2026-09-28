<script lang="ts">
	let {
		label,
		onclick,
		width = 60,
		height = 40,
	}: {
		label: string;
		onclick?: (e: MouseEvent) => void;
		width?: number;
		height?: number;
	} = $props();
</script>

<button
	type="button"
	class="green-button"
	style="width: {width}px; height: {height}px"
	{onclick}
>
	{label}
</button>

<style>
	.green-button {
		box-sizing: border-box;
		border: 1px solid var(--wn-green-dark);
		background: var(--wn-green);
		color: var(--wn-white);
		font-family: var(--wn-font);
		font-size: 20px;
		font-weight: 400;
		cursor: pointer;
	}
</style>
