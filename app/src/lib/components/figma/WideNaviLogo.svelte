<script lang="ts">
	let { size = 40 }: { size?: number } = $props();
</script>

<span class="logo" style="font-size: {size}px">
	<span class="wide">Wide</span> <span class="navi">Navi</span>
</span>

<style>
	.logo {
		font-family: var(--wn-font);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.5px;
		white-space: nowrap;
	}
	.wide {
		color: var(--wn-logo-dark);
	}
	.navi {
		color: var(--wn-green);
	}
</style>
