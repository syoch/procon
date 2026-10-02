# POST /api/cache-refresh

OSM キャッシュの失効セルを再取得する

## 定期更新

`POST /api/cache-refresh` が `procon-cache-refresh.timer` から定期実行される。

### 返り値

| フィールド  | 意味                                                         |
| ----------- | ------------------------------------------------------------ |
| `scanned`   | 走査したセル数                                               |
| `expired`   | TTL を超えていたセル数                                       |
| `refreshed` | 更新できたセル数                                             |
| `failed`    | 取得または保存に失敗したセル数                               |
| `regions`   | 1 クエリに含まれた bbox 句の数（HTTP リクエストは常に 1 回） |

`expired === refreshed + failed` が常に成り立つ。

`failed` が 1 件でもあると HTTP 500 を返す。成功扱いにすると Overpass の障害が
気づけないまま進むため。
