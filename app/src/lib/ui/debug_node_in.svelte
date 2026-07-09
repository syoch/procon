<script lang="ts">
  import Button from "@smui/button";
  let {
    selected_node_id,
    begin_node_id,
    end_node_id,
  }: {
    selected_node_id: string | null;
    begin_node_id: string | null;
    end_node_id: string | null;
  } = $props();
</script>

(デバッグ用) 始点/終点指定 <br />
選択されているノード: {selected_node_id} <br />
{begin_node_id} -&gt; {end_node_id} <br />

<Button
  variant="outlined"
  onclick={() => {
    if (selected_node_id) {
      begin_node_id = selected_node_id;
    }
  }}
>
  始点に設定
</Button>
<Button
  variant="outlined"
  onclick={() => {
    if (selected_node_id) {
      end_node_id = selected_node_id;
    }
  }}
>
  終点に設定
</Button>
