<script lang="ts">
	import { fade } from "svelte/transition";
	import BackButton from "./BackButton.svelte";
	import SearchField from "./SearchField.svelte";

	let {
		view = "search",
		onback,
		onsearch,
	}: {
		view?: "search" | "result";
		onback?: (e: MouseEvent) => void;
		onsearch?: (e: MouseEvent) => void;
	} = $props();

	let start = $state("");
	let end = $state("");
</script>

<div class="panel">
	<BackButton onclick={onback} />

	<div class="divider"></div>

	{#if view === "search"}
		<div class="logo" transition:fade={{ duration: 140 }}>Wide Navi</div>
		<div class="field field-start" transition:fade={{ duration: 140 }}>
			<SearchField placeholder="始点を入力" bind:value={start} />
		</div>
		<div class="field field-end" transition:fade={{ duration: 140 }}>
			<SearchField placeholder="終点を入力" bind:value={end} />
		</div>
		<button
			type="button"
			class="search-button wn-pressable"
			onclick={onsearch}
			transition:fade={{ duration: 140 }}
		>
			探索開始
		</button>
	{:else}
		<div class="result-text" transition:fade={{ duration: 140 }}>
			<div>地点Aから地点B</div>
			<div class="coord">経度:37&nbsp;&nbsp;緯度:100</div>
		</div>
	{/if}
</div>

<style>
	.panel {
		position: relative;
		width: var(--wn-panel-width);
		height: var(--wn-panel-height);
		background: var(--wn-panel);
		box-shadow: var(--wn-shadow);
		overflow: hidden;
	}

	.divider {
		position: absolute;
		left: 16px;
		top: 289px;
		width: 369px;
		height: 2px;
		background: var(--wn-white);
	}

	.logo {
		position: absolute;
		left: 45px;
		top: 22px;
		font-family: var(--wn-font);
		font-size: 40px;
		line-height: 1;
		font-weight: 400;
		color: var(--wn-white);
		white-space: nowrap;
	}

	.field {
		position: absolute;
		left: 49px;
	}
	.field-start {
		top: 128px;
	}
	.field-end {
		top: 209px;
	}

	.search-button {
		position: absolute;
		left: 71px;
		top: 895px;
		width: 245px;
		height: 79px;
		border: none;
		background: var(--wn-main);
		color: var(--wn-black);
		font-family: var(--wn-font);
		font-size: 32px;
		font-weight: 400;
		cursor: pointer;
	}

	.result-text {
		position: absolute;
		left: 0;
		right: 0;
		top: 156px;
		text-align: center;
		font-family: var(--wn-font);
		font-size: 20px;
		line-height: 24px;
		color: var(--wn-black);
	}
	.result-text .coord {
		margin-top: 24px;
	}
</style>
