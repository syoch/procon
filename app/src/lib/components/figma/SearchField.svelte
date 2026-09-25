<script lang="ts">
	import IconSearch from "./IconSearch.svelte";

	let {
		placeholder = "",
		value = $bindable(""),
	}: { placeholder?: string; value?: string } = $props();
</script>

<div class="field">
	<IconSearch />
	<input bind:value {placeholder} />
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
