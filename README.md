# zt-adblock-sync

Cloudflare Worker tự động tải, xử lý và đồng bộ danh sách chặn quảng cáo vào
**Cloudflare Zero Trust → Gateway** (DNS Lists + Policies), lưu trữ bằng **R2** (snapshot file)
và **KV** (cấu hình nguồn + trạng thái chạy).

## Kiến trúc

```
Cron Trigger (mỗi ngày)
   │
   ▼
Worker (src/index.js)
   ├─ Tải raw list từ các nguồn (hosts / AdBlock format) qua fetch()
   ├─ Parse + dedupe + validate domain (src/parser.js)
   ├─ Lưu snapshot .txt vào R2            → BLOCKLIST_BUCKET
   ├─ Chia domain thành chunk ≤1000       → tạo Gateway List mới (Cloudflare API)
   ├─ Cập nhật Gateway Policy trỏ tới các list mới
   └─ Xoá các Gateway List cũ (dọn rác)
```

Tạo list mới **trước** rồi mới xoá list cũ, để Gateway Policy không bao giờ bị rỗng
trong lúc đồng bộ.

## Deploy nhanh

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/manhd89/cf)

Nút Deploy sẽ tự tạo Worker + hỏi bạn tạo R2 bucket / KV namespace tương ứng trong `wrangler.toml`.
Sau khi deploy xong, làm thêm 2 bước bên dưới (**bắt buộc**) trước khi Worker chạy được.

## Setup thủ công (nếu deploy bằng CLI thay vì nút)

```bash
npm install
npx wrangler r2 bucket create zt-adblock-lists
npx wrangler kv namespace create BLOCKLIST_KV
# copy "id" trả về vào wrangler.toml (mục [[kv_namespaces]])
```

## 1. Tạo Cloudflare API Token

Vào **My Profile → API Tokens → Create Token**, cấp quyền:
- **Account → Zero Trust → Edit** (để tạo/sửa/xoá Gateway Lists & Rules)

Copy token, rồi set secret:

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put TRIGGER_SECRET   # tuỳ chọn, dùng để gọi /run thủ công qua HTTP
```

`CF_ACCOUNT_ID` lấy ở sidebar phải trong Cloudflare Dashboard (bất kỳ domain nào).

## 2. Tuỳ chỉnh nguồn danh sách (tuỳ chọn)

Mặc định worker dùng các nguồn trong `src/sources.js`. Muốn đổi mà không deploy lại code,
ghi đè bằng KV:

```bash
npx wrangler kv key put --binding=BLOCKLIST_KV "sources" \
  '["https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"]'
```

## Sử dụng

- **Tự động**: worker chạy theo lịch cron trong `wrangler.toml` (mặc định 03:00 UTC hằng ngày).
- **Chạy tay**:
  ```bash
  curl -X POST https://<worker-url>/run -H "Authorization: Bearer <TRIGGER_SECRET>"
  ```
- **Xem trạng thái lần chạy gần nhất**:
  ```bash
  curl https://<worker-url>/status
  ```

## Giới hạn cần lưu ý (gói Cloudflare miễn phí)

| Giới hạn | Giá trị |
|---|---|
| Số Gateway List tối đa | 300 (block + allow) |
| Domain / list | 1.000 |
| Tổng domain tối đa | ~300.000 |

Worker tự cắt bớt domain nếu vượt `MAX_TOTAL_LISTS × MAX_DOMAINS_PER_LIST` (đặt trong `wrangler.toml`).

## Bật lọc theo SNI (chặn thêm ở tầng TLS)

Set `ENABLE_SNI_RULE = "true"` trong `wrangler.toml` để worker tạo thêm 1 policy dùng
`net.sni.domains` — giúp chặn cả các client cố né DNS bằng DoH/DoT.

## Cấu trúc thư mục

```
src/
  index.js         # entrypoint: scheduled() + fetch() handler
  parser.js         # parse hosts/adblock format -> domain hợp lệ
  cloudflareApi.js   # wrapper gọi Gateway Lists / Rules API
  sources.js         # danh sách nguồn mặc định + allowlist cứng
wrangler.toml
```
