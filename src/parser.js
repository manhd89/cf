const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Rút domain hợp lệ từ 1 dòng, hỗ trợ các format phổ biến:
 *  - "0.0.0.0 example.com" / "127.0.0.1 example.com"  (hosts file)
 *  - "||example.com^"                                  (AdBlock / EasyList)
 *  - "example.com"                                     (plain)
 * Trả về null nếu dòng là comment, rule phức tạp (regex/path), hoặc không hợp lệ.
 */
export function extractDomain(rawLine) {
  let line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("!") || line.startsWith("//")) {
    return null;
  }

  // Format hosts: "IP domain [domain2 ...]" -> lấy token thứ 2
  const hostsMatch = line.match(/^(0\.0\.0\.0|127\.0\.0\.1|::1?)\s+(\S+)/);
  if (hostsMatch) {
    line = hostsMatch[2];
  }

  // Format AdBlock: ||domain.com^  hoặc  ||domain.com^$third-party
  const abpMatch = line.match(/^\|\|([a-z0-9.-]+)\^/i);
  if (abpMatch) {
    line = abpMatch[1];
  } else if (line.includes("/") || line.includes("*") || line.includes("$") || line.includes("^")) {
    // Rule phức tạp (path/regex/options) mà Gateway List (chỉ nhận domain thuần) không hỗ trợ
    return null;
  }

  line = line.replace(/^\|\|/, "").replace(/\^$/, "").toLowerCase().trim();

  if (!DOMAIN_RE.test(line)) return null;
  return line;
}

/**
 * Parse toàn bộ nội dung text (nhiều dòng) thành 1 Set domain đã dedupe & validate.
 */
export function parseDomains(text, allowlist = new Set()) {
  const domains = new Set();
  const lines = text.split("\n");
  for (const line of lines) {
    const d = extractDomain(line);
    if (d && !allowlist.has(d)) domains.add(d);
  }
  return domains;
}

/**
 * Chia 1 Set/Array domain thành nhiều chunk theo giới hạn size mỗi Gateway List.
 */
export function chunkDomains(domains, size) {
  const arr = Array.from(domains);
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
