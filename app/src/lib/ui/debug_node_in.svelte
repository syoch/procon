<script lang="ts">
  import Button from "@smui/button";

  interface SelectMarker {
    moveFrom(other: SelectMarker): void;
  }

  let {
    selected_node_id = $bindable(),
    begin_node_id = $bindable(),
    end_node_id = $bindable(),
  }: {
    selected_node_id: SelectMarker | null;
    begin_node_id: SelectMarker | null;
    end_node_id: SelectMarker | null;
  } = $props();
</script>

(デバッグ用) 始点/終点 <br />
{#if selected_node_id}
  選択されているノード: {selected_node_id} <br />
{/if}

<Button
  variant="outlined"
  onclick={() => {
    if (begin_node_id && selected_node_id) {
      begin_node_id.moveFrom(selected_node_id);
    }
  }}
>
  始点に設定
</Button>
<Button
  variant="outlined"
  onclick={() => {
    if (end_node_id && selected_node_id) {
      end_node_id.moveFrom(selected_node_id);
    }
  }}
>
  終点に設定
</Button>
