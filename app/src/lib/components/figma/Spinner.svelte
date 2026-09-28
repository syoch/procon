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

	const N = 10;
	const base = $derived(
		variant === "green" ? "var(--wn-spinner-green)" : "var(--wn-spinner-gray)",
	);
	const opacities = [1, 0.7, 0.4, 0.1, 1, 1, 1, 1, 1, 1];
	const dots = $derived(
		Array.from({ length: N }, (_, i) => {
			const a = ((-90 + i * 36) * Math.PI) / 180;
			return {
				x: ringRadius * Math.cos(a),
				y: ringRadius * Math.sin(a),
				color: i < 4 ? base : "var(--wn-white)",
				opacity: opacities[i],
			};
		}),
	);
	const span = $derived((ringRadius + dotRadius) * 2);
</script>

<svg
	class="spinner"
	viewBox="{-(span / 2)} {-(span / 2)} {span} {span}"
	width={span}
	height={span}
	style="--dur: {duration}ms"
	aria-label="読み込み中"
	role="img"
>
	<g>
		{#each dots as d}
			<circle cx={d.x} cy={d.y} r={dotRadius} fill={d.color} fill-opacity={d.opacity} />
		{/each}
	</g>
</svg>

<style>
	.spinner {
		animation: wn-spin var(--dur) steps(10) infinite;
		transform-origin: center;
	}
	@keyframes wn-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 3s;
		}
	}
</style>
