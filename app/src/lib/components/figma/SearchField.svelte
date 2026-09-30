<script lang="ts">
	import {
		MainAppContext,
		type LocationCandidate,
	} from "$lib/app_state.svelte";
	import IconSearch from "./IconSearch.svelte";
	import IconPin from "./IconPin.svelte";

	let {
		placeholder = "",
		target,
	}: { placeholder?: string; target: "begin" | "end" } = $props();

	const appCtx = MainAppContext.getInstance();
	const loc = $derived(
		target === "begin" ? appCtx.state.begin : appCtx.state.end,
	);
	const candidates = $derived(appCtx.state.locationCandidates ?? []);
	const open = $derived(
		appCtx.state.locationSelection === target && candidates.length > 0,
	);

	let debounce: ReturnType<typeof setTimeout> | undefined;

	async function runSearch(query: string) {
		const q = query.trim();
		if (q.length < 2) {
			appCtx.state.locationCandidates = null;
			return;
		}
		const results = await appCtx.locationResolver(q);
		// 入力が変わっていたら古い応答は破棄する
		if (loc.query.trim() !== q) return;
		appCtx.state.locationCandidates = results;
	}

	function onInput() {
		clearTimeout(debounce);
		debounce = setTimeout(() => runSearch(loc.query), 300);
	}

	function select(c: LocationCandidate) {
		loc.query = c.name;
		appCtx.state.setCoordinate(target, { lat: c.lat, lng: c.lon });
		loc.state = "confirmed";
		appCtx.state.locationCandidates = null;
		appCtx.state.locationSelection = null;
	}
</script>

<div
	class="wrapper"
	onfocusin={() => (appCtx.state.locationSelection = target)}
	onfocusout={() => {
		// 地図タッチ / 候補クリック時にフォーカスアウトが起きるため少し遅延させる
		setTimeout(() => {
			if (appCtx.state.locationSelection === target) {
				appCtx.state.locationSelection = null;
				appCtx.state.locationCandidates = null;
			}
		}, 200);
	}}
>
	<div class="field">
		<IconSearch />
		<input bind:value={loc.query} {placeholder} oninput={onInput} />
	</div>

	{#if open}
		<ul class="candidates">
			{#each candidates as c, i (i)}
				<li>
					<button
						type="button"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => select(c)}
					>
						<span class="avatar"><IconPin /></span>
						<span class="info">
							<span class="name">{c.name}</span>
							<span class="detail">{c.displayName}</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.wrapper {
		position: relative;
		width: 300px;
	}
	.field {
		width: 300px;
		height: 40px;
		box-sizing: border-box;
		border-radius: 20px;
		background: var(--wn-white);
		border: 1px solid var(--wn-placeholder);
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
		color: var(--wn-ink);
	}
	input::placeholder {
		color: var(--wn-placeholder);
		opacity: 1;
	}

	.candidates {
		position: absolute;
		top: 40px;
		left: 0;
		width: 300px;
		box-sizing: border-box;
		margin: 0;
		padding: 0;
		list-style: none;
		background: var(--wn-white);
		border: 2px solid var(--wn-placeholder);
		max-height: 240px;
		overflow-y: auto;
		z-index: 30;
	}
	.candidates li {
		border-bottom: 2px solid var(--wn-placeholder);
	}
	.candidates li:last-child {
		border-bottom: none;
	}
	.candidates button {
		display: flex;
		align-items: center;
		width: 100%;
		height: 48px;
		box-sizing: border-box;
		padding: 0 5px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-family: var(--wn-font);
	}
	.candidates button:hover,
	.candidates button:focus-visible {
		background: #f1f1f1;
		outline: none;
	}
	.avatar {
		flex: none;
		width: 40px;
		height: 40px;
		margin-right: 10.7px;
		border-radius: 50%;
		background: #d9d9d9;
		display: grid;
		place-items: center;
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: 20px;
		line-height: 1.2;
		color: #000;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 238px;
	}
	.detail {
		font-size: 10px;
		line-height: 1.2;
		color: #000;
		max-width: 238px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
