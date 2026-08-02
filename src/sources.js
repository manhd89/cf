// Danh sách nguồn mặc định (hosts / adblock format).
// Có thể override bằng cách ghi key "sources" (JSON array of URLs) vào KV BLOCKLIST_KV,
// worker sẽ ưu tiên đọc từ KV trước, nếu không có mới dùng danh sách này.
export const DEFAULT_SOURCES = [
  "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  "https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/BaseFilter/sections/adservers.txt",
  "https://easylist.to/easylist/easylist.txt",
];

// Domain "allowlist" cứng, luôn bị loại khỏi danh sách chặn dù nguồn có liệt kê.
export const HARD_ALLOWLIST = new Set([
  "localhost",
  "local",
]);
