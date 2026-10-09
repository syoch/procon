<script>
	import favicon from "$lib/assets/favicon.svg";
	import "leaflet/dist/leaflet.css";
	import "svelte-material-ui/bare.css";
	import "$lib/styles/tokens.css";

	import L from "leaflet";

	import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
	import markerIcon from "leaflet/dist/images/marker-icon.png";
	import markerShadow from "leaflet/dist/images/marker-shadow.png";

	let { children } = $props();

	L.Icon.Default.mergeOptions({
		iconUrl: markerIcon,
		iconRetinaUrl: markerIcon2x,
		shadowUrl: markerShadow,
	});
	// Leaflet の Icon.Default は imagePath を画像 URL の前に無条件で付ける。
	// Vite は小さな画像を data URI にインライン化するので、imagePath が付くと
	// "https://<host>data:image/png;base64,..." のような壊れた URL になる。
	// 空文字にすると前置されない (typeof が string なので自動検出も走らない)。
	L.Icon.Default.imagePath = "";
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
	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		width: 100%;
		height: 100%;
	}
</style>
