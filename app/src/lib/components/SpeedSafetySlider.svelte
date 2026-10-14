<script lang="ts">
	import { SPEED_SAFETY_CENTER, SPEED_SAFETY_MAX } from "$lib/speed_safety";

	let {
		value = $bindable(),
		onchange,
	}: {
		/** スライダーの位置 (0 = 速さ優先、50 = 標準、100 = 安全優先) */
		value: number;
		/** つまみを離したときに呼ぶ (キーボードでは 1 回動かすごと) */
		onchange?: () => void;
	} = $props();

	const uid = $props.id();

	const valueText = $derived(
		value === SPEED_SAFETY_CENTER
			? "標準"
			: value < SPEED_SAFETY_CENTER
				? "速さ優先"
				: "安全優先",
	);
</script>

<div class="speed-safety">
	<span class="end" aria-hidden="true">速さ</span>
	<input
		type="range"
		min="0"
		max={SPEED_SAFETY_MAX}
		step={SPEED_SAFETY_CENTER}
		bind:value
		{onchange}
		list="{uid}-ticks"
		aria-label="速さと安全のどちらを優先するか"
		aria-valuetext={valueText}
		title={valueText}
	/>
	<span class="end" aria-hidden="true">安全</span>

	<!-- 両端と中央 (標準) に目盛りを出す -->
	<datalist id="{uid}-ticks">
		<option value="0"></option>
		<option value={SPEED_SAFETY_CENTER}></option>
		<option value={SPEED_SAFETY_MAX}></option>
	</datalist>
</div>

<style>
	.speed-safety {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 24px;
		font-family: var(--wn-font);
		font-size: 16px;
		color: var(--wn-ink);
	}
	.end {
		flex: none;
		white-space: nowrap;
	}
	input {
		flex: 1;
		min-width: 0;
		margin: 0;
		accent-color: var(--wn-green);
		cursor: pointer;
	}
</style>
