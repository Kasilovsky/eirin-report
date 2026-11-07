# 竹林茶會 · 後端 (Cloudflare Worker)

匿名帳戶 + 留言板。前端在 `assets/discuss.js`，透過 `API_BASE` 指向本 Worker。

## 架構

```
瀏覽器 ──POST /api/register──▶ Worker ──▶ KV（user:<name>）
       ──POST /api/login─────▶ Worker ──▶ KV（驗證 token/密碼）
       ──GET  /api/messages──▶ Worker ──▶ KV（msg:* 列表）
       ──POST /api/messages──▶ Worker ──▶ KV（寫入新留言）
```

- 密碼：PBKDF2-SHA256（10 萬次）+ 隨機 salt，只存哈希
- token：32 bytes 隨機 → 64 位十六進制字串；KV 只存 SHA-256
- 隱私：不落庫明文、不記錄 IP（限流鍵用 IP 哈希並在一小時後過期）
- 限流：每 IP 每小時 20 次（註冊與發言各自計數）

## 部署（約 5 分鐘）

前置：Node 18+（本機已有）。

```bash
cd worker
npx wrangler login                          # 瀏覽器授權一次
npx wrangler kv namespace create EIRIN_KV   # 記下輸出的 id
```

把 id 填進 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "EIRIN_KV"
id = "貼上剛才的 id"
```

然後部署：

```bash
npx wrangler deploy
```

輸出會給一個 `https://eirin-discuss.<你的子域>.workers.dev`。

## 接通前端

打開 `assets/discuss.js`，把 `API_BASE` 改成上面的地址：

```js
const API_BASE = "https://eirin-discuss.xxxx.workers.dev";
```

沒有配置時留言板顯示「尚未開通」，公告區不受影響。

## 本地測試

```bash
npx wrangler dev
# 另開終端
curl http://127.0.0.1:8787/health
```

## 資料格式

| Key | 內容 |
|---|---|
| `user:<name>` | `{ name, salt, pwhash, tokenHash, createdAt }` |
| `token:<sha256(token)>` | `<name>` |
| `msg:<ISO 時間>:<id>` | `{ id, name, content, createdAt }` |
| `rl:<bucket>:<ip 哈希>:<小時>` | 計數，TTL 1 小時 |

## 已知限制

- KV 最終一致：發言後約 1 秒內可能在其他節點看不到（個人站可接受）
- KV 列表上限 1000 條 key，`/api/messages` 只取最近 200 條
- 沒有找回密碼（token 遺失只能重新註冊）
- 沒有敏感詞過濾，依賴讀者自律
