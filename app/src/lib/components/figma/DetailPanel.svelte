<script lang="ts">
	import { fade } from "svelte/transition";
	import BackButton from "./BackButton.svelte";
	import WideNaviLogo from "./WideNaviLogo.svelte";
    import type { Snippet} from "svelte";

	let {
		onback,
		content
	}: {
		onback?: (e: MouseEvent) => void;
		content: Snippet<[]>
	} = $props();
</script>

<div class="panel">
	<div class="back-layer">
		<BackButton onclick={onback} />
	</div>

	<div class="logo" transition:fade={{ duration: 140 }}><WideNaviLogo /></div>

	{@render content()}
</div>

<style>
	.panel {
		position: relative;
		width: var(--wn-panel-width);
		height: var(--wn-panel-height);
		background: var(--wn-white);
		box-shadow: var(--wn-shadow);
		overflow: hidden;
	}

	.logo {
		position: absolute;
		left: 44.7px;
		top: 32px;
	}

	.back-layer {
		position: absolute;
		top: 0;
		right: 0;
		width: 64px;
		height: 64px;
	}	
</style>
