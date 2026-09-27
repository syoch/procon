<script lang="ts">
	import { MainAppContext } from "$lib/app_state.svelte";
	import IconSearch from "./IconSearch.svelte";

	let {
		placeholder = "",
		target,
	}: { placeholder?: string; target: "begin" | "end" } = $props();

	const appCtx = MainAppContext.getInstance();
	const loc = $derived(
		target === "begin" ? appCtx.state.begin : appCtx.state.end,
	);
</script>

<div
	class="field"
	onfocusin={() => (appCtx.state.locationSelection = target)}
	onfocusout={() => {
		// 地図タッチによる選択時にフォーカスアウトが発生するため、少し遅延させてから解除する
		setTimeout(() => {
			appCtx.state.locationSelection = null;
		}, 2000);
	}}
>
	<IconSearch />

	<input bind:value={loc.query} {placeholder} />
</div>

<style>
	.field {
		width: 300px;
		height: 40px;
		box-sizing: border-box;
		border-radius: 20px;
		background: var(--wn-white);
		box-shadow: var(--wn-shadow);
		display: flex;
		align-items: center;
		padding-left: 14px;
	}
	input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		padding-left: 16px;
		font-family: var(--wn-font);
		font-size: 20px;
		color: var(--wn-black);
	}
	input::placeholder {
		color: var(--wn-placeholder);
		opacity: 1;
	}
</style>
