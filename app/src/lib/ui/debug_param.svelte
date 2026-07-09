<script>
  import Slider from "@smui/slider";

  let param1 = $state(0.2);
</script>

(デバッグ用) パラメーター入力

<Slider min={0} max={1} step={0.01} bind:value={param1}></Slider>
<span>{param1}</span>
