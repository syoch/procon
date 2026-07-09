<script>
	import favicon from "$lib/assets/favicon.svg";
	import "leaflet/dist/leaflet.css";
	import "svelte-material-ui/bare.css";

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap");

	:global(body) {
		font-family: "Noto Sans JP", sans-serif;
	}
</style>
