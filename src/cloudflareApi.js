const API_BASE = "https://api.cloudflare.com/client/v4";

async function cfRequest(env, path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}/accounts/${env.CF_ACCOUNT_ID}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok || json.success === false) {
    const errMsg = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`Cloudflare API ${method} ${path} failed (${res.status}): ${errMsg || res.statusText}`);
  }
  return json.result;
}

// ---- Gateway Lists ----

export async function listGatewayLists(env) {
  // API trả tối đa theo page; danh sách account thường < vài trăm items nên 1 trang là đủ,
  // nhưng vẫn phân trang cho an toàn.
  let page = 1;
  const all = [];
  while (true) {
    const result = await cfRequest(env, `/gateway/lists?page=${page}&per_page=100`);
    if (!result || result.length === 0) break;
    all.push(...result);
    if (result.length < 100) break;
    page++;
  }
  return all;
}

export async function createGatewayList(env, name, domains) {
  return cfRequest(env, "/gateway/lists", {
    method: "POST",
    body: {
      name,
      type: "DOMAIN",
      description: "Auto-managed by zt-adblock-sync worker",
      items: domains.map((value) => ({ value })),
    },
  });
}

export async function deleteGatewayList(env, listId) {
  return cfRequest(env, `/gateway/lists/${listId}`, { method: "DELETE" });
}

// ---- Gateway Rules (Policies) ----

export async function listGatewayRules(env) {
  return cfRequest(env, "/gateway/rules");
}

export async function upsertGatewayRule(env, { name, existingRuleId, traffic, action = "block" }) {
  const body = {
    name,
    description: "Auto-managed by zt-adblock-sync worker",
    enabled: true,
    action,
    filters: ["dns"],
    traffic,
  };

  if (existingRuleId) {
    return cfRequest(env, `/gateway/rules/${existingRuleId}`, { method: "PUT", body });
  }
  return cfRequest(env, "/gateway/rules", { method: "POST", body });
}
