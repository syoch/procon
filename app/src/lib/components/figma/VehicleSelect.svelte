<script lang="ts">
	import { MainAppContext } from "$lib/app_state.svelte";

	const appCtx = MainAppContext.getInstance();
	const variants = $derived(appCtx.state.parameterVariants);
	const selectedValue = $derived(appCtx.state.selectedVariantIndex);

	function onchange(event: Event) {
		const variantIndex = (event.currentTarget as HTMLSelectElement).value;
		try {
			appCtx.state.selectedVariantIndex = parseInt(variantIndex);
		} catch (e) {
			throw e
		}
	}
</script>

<div class="vehicle">
	<select
		value={selectedValue}
		onchange={onchange}
		aria-label="車種を選択"
		required
	>
		<option value="" disabled>車種を選択</option>
		{#each variants as variant, idx (variant.name)}
			<option value={idx}>{variant.name}</option>
		{/each}
	</select>
	<svg class="caret" viewBox="0 0 10 8" width="9" height="7.5" aria-hidden="true">
		<path d="M1 1L5 6L9 1" fill="none" stroke="var(--wn-caret)" stroke-width="2" />
	</svg>
</div>

<style>
	.vehicle {
		width: 220px;
		height: 40px;
		box-sizing: border-box;
		background: var(--wn-white);
		border: 1px solid var(--wn-placeholder);
		box-shadow: var(--wn-shadow);
		display: flex;
		align-items: center;
		position: relative;
	}
	select {
		flex: 1;
		height: 100%;
		border: none;
		outline: none;
		background: transparent;
		appearance: none;
		text-align: center;
		text-align-last: center;
		font-family: var(--wn-font);
		font-size: 20px;
		color: var(--wn-placeholder);
		cursor: pointer;
		padding: 0 22px 0 8px;
	}
	select:valid {
		color: var(--wn-ink);
	}
	.caret {
		position: absolute;
		right: 12px;
		pointer-events: none;
	}
</style>
