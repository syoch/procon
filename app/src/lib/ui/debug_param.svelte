<script>
  import Slider from "@smui/slider";

  let param1 = $state(0.2);
  let param2 = $state(0.2);
  let param3 = $state(0.2);
  let param4 = $state(0.2);
</script>

(デバッグ用) パラメーター入力

<Slider min={0} max={1} step={0.01} bind:value={param1}></Slider>
<Slider min={0} max={1} step={0.01} bind:value={param2}></Slider>
<Slider min={0} max={1} step={0.01} bind:value={param3}></Slider>
<Slider min={0} max={1} step={0.01} bind:value={param4}></Slider>
