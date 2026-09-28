<script lang="ts">
	import { fade } from "svelte/transition";
	import BackButton from "./BackButton.svelte";
	import SearchField from "./SearchField.svelte";
	import VehicleSelect from "./VehicleSelect.svelte";
	import GreenButton from "./GreenButton.svelte";
	import WideNaviLogo from "./WideNaviLogo.svelte";

	let {
		view = "search",
		onback,
		onsearch,
		onresearch,
	}: {
		view?: "search" | "result";
		onback?: (e: MouseEvent) => void;
		onsearch?: (e: MouseEvent) => void;
		onresearch?: (e: MouseEvent) => void;
	} = $props();
</script>

<div class="panel">
	<div class="back-layer">
		<BackButton onclick={onback} />
	</div>

	<div class="logo" transition:fade={{ duration: 140 }}><WideNaviLogo /></div>

	{#if view === "search"}
		<div class="field field-start" transition:fade={{ duration: 140 }}>
			<SearchField placeholder="始点を入力" target="begin" />
		</div>
		<div class="field field-end" transition:fade={{ duration: 140 }}>
			<SearchField placeholder="終点を入力" target="end" />
		</div>
		<div class="vehicle" transition:fade={{ duration: 140 }}>
			<VehicleSelect />
		</div>
		<div class="action" transition:fade={{ duration: 140 }}>
			<GreenButton label="検索" width={60} onclick={onsearch} />
		</div>
	{:else}
		<div class="result" transition:fade={{ duration: 140 }}>
			<span class="label" style="left: 18.3px; top: 104px;">出発点</span>
			<span class="value" style="left: 30.7px; top: 146px;">地名</span>
			<span class="value" style="left: 32.8px; top: 196px;">詳細等</span>
			<div class="divider" style="top: 253px;"></div>
			<span class="label" style="left: 18.5px; top: 278.6px;">終着点</span>
			<span class="value" style="left: 32.7px; top: 320.2px;">地点</span>
			<span class="value" style="left: 34.8px; top: 367.6px;">詳細等</span>
			<div class="divider" style="top: 425.5px;"></div>
			<div class="vehicle" style="position: absolute; left: 34px; top: 454.5px;">
				<VehicleSelect />
			</div>
			<div class="action" style="position: absolute; left: 283px; top: 453.5px;">
				<GreenButton label="再検索" width={80} onclick={onresearch} />
			</div>
		</div>
	{/if}
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

	/* 結果コンテンツ(.result)より前面に置き、確実にクリックできるようにする */
	.back-layer {
		position: absolute;
		top: 0;
		right: 0;
		width: 64px;
		height: 64px;
		z-index: 2;
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

	.vehicle {
		position: absolute;
		left: 44px;
		top: 312px;
	}

	.action {
		position: absolute;
		left: 289px;
		top: 312px;
	}

	.result {
		position: absolute;
		inset: 0;
		font-family: var(--wn-font);
		font-size: 20px;
		line-height: 1;
		color: var(--wn-ink);
	}
	.label,
	.value {
		position: absolute;
		white-space: nowrap;
	}
	.divider {
		position: absolute;
		left: 16px;
		width: 369px;
		height: 1px;
		background: var(--wn-divider);
	}
</style>
