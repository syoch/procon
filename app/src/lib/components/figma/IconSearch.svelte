<script lang="ts">
	let { size = 20 }: { size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 20 20"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
>
	<circle cx="7" cy="7" r="7" stroke="var(--wn-icon-stroke)" stroke-width="2" />
	<path
		d="M12.2 12.2L19 19"
		stroke="var(--wn-icon-stroke)"
		stroke-width="2"
		stroke-linecap="round"
	/>
</svg>
