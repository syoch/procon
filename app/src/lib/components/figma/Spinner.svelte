<script lang="ts">
	let {
		variant = "gray",
		dotRadius = 7.16,
		ringRadius = 64,
		duration = 1000,
	}: {
		variant?: "green" | "gray";
		dotRadius?: number;
		ringRadius?: number;
		duration?: number;
	} = $props();

	const DOTS = 10;
	const dots = Array.from({ length: DOTS });
	const dotSize = $derived(dotRadius * 2);
	const size = $derived((ringRadius + dotRadius) * 2);
</script>

<div
	class="spinner"
	role="img"
	aria-label="読み込み中"
	data-variant={variant}
	style="--dot: {dotSize}px; --radius: {ringRadius}px; --size: {size}px; --dur: {duration}ms"
>
	{#each dots as _, i (i)}
		<span class="dot" style="--i: {i}"></span>
	{/each}
</div>

<style>
	.spinner {
		position: relative;
		width: var(--size);
		height: var(--size);
		/* 10分割で回転（Figma のバリアント巡回 = 100ms 相当） */
		animation: wn-spin var(--dur) steps(10) infinite;
	}

	.dot {
		position: absolute;
		top: 50%;
		left: 50%;
		width: var(--dot);
		height: var(--dot);
		margin: calc(var(--dot) / -2) 0 0 calc(var(--dot) / -2);
		border-radius: 50%;
		background: var(--wn-white);
		/* transform-origin は自身の中心 = コンテナ中心なので、
		   translateY で円周上に置いてから rotate で角度を割り当てる */
		transform: rotate(calc(var(--i) * 36deg)) translateY(calc(-1 * var(--radius)));
	}

	/* 先頭4つが尾(濃い色)。残りは白 */
	.spinner[data-variant="green"] .dot:nth-child(-n + 4) {
		background: var(--wn-spinner-green);
	}
	.spinner[data-variant="gray"] .dot:nth-child(-n + 4) {
		background: var(--wn-spinner-gray);
	}
	.dot:nth-child(1) {
		opacity: 1;
	}
	.dot:nth-child(2) {
		opacity: 0.7;
	}
	.dot:nth-child(3) {
		opacity: 0.4;
	}
	.dot:nth-child(4) {
		opacity: 0.1;
	}

	@keyframes wn-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: calc(var(--dur) * 3);
		}
	}
</style>
