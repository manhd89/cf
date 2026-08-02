import { DEFAULT_SOURCES, HARD_ALLOWLIST } from "./sources.js";
import { parseDomains, chunkDomains } from "./parser.js";
import {
  listGatewayLists,
  createGatewayList,
  deleteGatewayList,
  listGatewayRules,
  upsertGatewayRule,
} from "./cloudflareApi.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/run" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.TRIGGER_SECRET}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const result = await runSync(env);
      return Response.json(result);
    }

    if (url.pathname === "/status") {
      const status = await env.BLOCKLIST_KV.get("last_run", "json");
      return Response.json(status || { message: "Chưa chạy lần nào" });
    }

    return new Response(
      "zt-adblock-sync worker\n\nPOST /run (auth) - chạy đồng bộ thủ công\nGET /status - xem trạng thái lần chạy gần nhất",
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  },
};

async function runSync(env) {
  const startedAt = new Date().toISOString();
  const log = [];
  const push = (msg) => {
    console.log(msg);
    log.push(msg);
  };

  try {
    // 1. Lấy danh sách nguồn (ưu tiên KV, fallback default)
    const sources = (await env.BLOCKLIST_KV.get("sources", "json")) || DEFAULT_SOURCES;
    push(`Nguồn: ${sources.length} danh sách`);

    // 2. Tải & gộp toàn bộ domain
    let rawTextCombined = "";
    for (const src of sources) {
      try {
        const res = await fetch(src, { cf: { cacheTtl: 0 } });
        if (!res.ok) {
          push(`⚠️ Bỏ qua nguồn lỗi (${res.status}): ${src}`);
          continue;
        }
        rawTextCombined += "\n" + (await res.text());
      } catch (e) {
        push(`⚠️ Lỗi tải nguồn ${src}: ${e.message}`);
      }
    }

    const domains = parseDomains(rawTextCombined, HARD_ALLOWLIST);
    push(`Đã parse ${domains.size} domain hợp lệ (sau dedupe/validate)`);

    const maxTotal = Number(env.MAX_TOTAL_LISTS || 290) * Number(env.MAX_DOMAINS_PER_LIST || 1000);
    let finalDomains = domains;
    if (domains.size > maxTotal) {
      push(`⚠️ Vượt giới hạn (${domains.size} > ${maxTotal}), cắt bớt để vừa gói hiện tại`);
      finalDomains = new Set(Array.from(domains).slice(0, maxTotal));
    }

    // 3. Lưu snapshot vào R2 (backup + audit trail)
    const timestamp = startedAt.replace(/[:.]/g, "-");
    const bodyText = Array.from(finalDomains).sort().join("\n");
    await env.BLOCKLIST_BUCKET.put(`snapshots/${timestamp}.txt`, bodyText);
    await env.BLOCKLIST_BUCKET.put("latest.txt", bodyText);
    push(`Đã lưu snapshot vào R2 (latest.txt + snapshots/${timestamp}.txt)`);

    // 4. Tạo Gateway List mới trước (để không có khoảng trống policy)
    const prefix = env.LIST_NAME_PREFIX || "auto-adblock";
    const chunkSize = Number(env.MAX_DOMAINS_PER_LIST || 1000);
    const chunks = chunkDomains(finalDomains, chunkSize);
    push(`Chia thành ${chunks.length} Gateway List (tối đa ${chunkSize} domain/list)`);

    const newLists = [];
    for (let i = 0; i < chunks.length; i++) {
      const name = `${prefix}-${String(i + 1).padStart(3, "0")}-${timestamp}`;
      const created = await createGatewayList(env, name, chunks[i]);
      newLists.push(created);
      push(`✅ Tạo list ${name} (${chunks[i].length} domain)`);
    }

    // 5. Cập nhật (hoặc tạo) Gateway Policy trỏ tới các list mới
    const policyName = env.GATEWAY_POLICY_NAME || "Auto AdBlock (Worker)";
    const traffic = newLists
      .map((l) => `any(dns.domains[*] in $${l.id})`)
      .join(" or ");

    const existingRules = await listGatewayRules(env);
    const existingRule = existingRules.find((r) => r.name === policyName);

    await upsertGatewayRule(env, {
      name: policyName,
      existingRuleId: existingRule?.id,
      traffic,
      action: "block",
    });
    push(`✅ Đã ${existingRule ? "cập nhật" : "tạo"} policy "${policyName}"`);

    // 5b. (Tuỳ chọn) Policy chặn theo SNI để giảm né qua DoH/DoT của trình duyệt
    if ((env.ENABLE_SNI_RULE || "false").toLowerCase() === "true") {
      const sniPolicyName = `${policyName} (SNI)`;
      const sniTraffic = newLists
        .map((l) => `any(net.sni.domains[*] in $${l.id})`)
        .join(" or ");
      const existingSniRule = existingRules.find((r) => r.name === sniPolicyName);
      await upsertGatewayRule(env, {
        name: sniPolicyName,
        existingRuleId: existingSniRule?.id,
        traffic: sniTraffic,
        action: "block",
      });
      push(`✅ Đã ${existingSniRule ? "cập nhật" : "tạo"} policy SNI "${sniPolicyName}"`);
    }

    // 6. Xoá các list cũ (thuộc prefix, không nằm trong đợt vừa tạo)
    const allLists = await listGatewayLists(env);
    const newListIds = new Set(newLists.map((l) => l.id));
    const oldLists = allLists.filter((l) => l.name.startsWith(`${prefix}-`) && !newListIds.has(l.id));

    for (const old of oldLists) {
      try {
        await deleteGatewayList(env, old.id);
        push(`🗑️ Xoá list cũ ${old.name}`);
      } catch (e) {
        push(`⚠️ Không xoá được list cũ ${old.name}: ${e.message}`);
      }
    }

    const result = {
      success: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalDomains: finalDomains.size,
      listsCreated: newLists.length,
      oldListsRemoved: oldLists.length,
      log,
    };
    await env.BLOCKLIST_KV.put("last_run", JSON.stringify(result));
    return result;
  } catch (err) {
    const result = {
      success: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: err.message,
      log,
    };
    await env.BLOCKLIST_KV.put("last_run", JSON.stringify(result));
    push(`❌ Lỗi: ${err.message}`);
    return result;
  }
}
