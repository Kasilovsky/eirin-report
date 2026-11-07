/**
 * 永遠亭 医療報告 · 竹林茶會 後端
 *
 * Cloudflare Worker + KV：匿名账户 + 留言板。
 *
 * API
 *   POST /api/register  { name, password }            -> { token }
 *   POST /api/login     { name, token } | { name, password } -> { ok, token? }
 *   GET  /api/messages  ?limit=50                     -> { messages: [...] }
 *   POST /api/messages  { content }  Authorization: Bearer <token> -> { ok, id }
 *
 * 存储（KV）
 *   user:<name>          { name, salt, pwhash, tokenHash, createdAt }
 *   token:<tokenHash>    <name>
 *   msg:<ts>:<id>        { id, name, content, createdAt }
 *   rl:<ip>:<hour>       计数（简单限流）
 *
 * 隐私：不记录 IP（限流用的哈希键在小时窗口后自然失效），不存明文密码，
 *       不存明文 token（只存 SHA-256）。
 */

const MAX_NAME = 24;
const MAX_CONTENT = 500;
const MAX_MESSAGES = 200;
const RATE_LIMIT_PER_HOUR = 20;

const encoder = new TextEncoder();

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return hex(new Uint8Array(digest));
}

async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return hex(new Uint8Array(bits));
}

function validName(name) {
  return typeof name === "string" && /^[\p{L}\p{N}_-]{2,24}$/u.test(name.trim());
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

async function rateLimit(env, ip, bucket) {
  const hour = new Date().toISOString().slice(0, 13);
  const key = `rl:${bucket}:${await sha256(ip)}:${hour}`;
  const current = Number(await env.EIRIN_KV.get(key)) || 0;
  if (current >= RATE_LIMIT_PER_HOUR) return false;
  await env.EIRIN_KV.put(key, String(current + 1), { expirationTtl: 3600 });
  return true;
}

/* ------------------------------------------------------------------ API --- */

async function register(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || !validName(body.name) || typeof body.password !== "string" || body.password.length < 8) {
    return json({ error: "名字需 2–24 个字符，密码至少 8 位" }, 400, cors);
  }

  const name = body.name.trim();
  const userKey = `user:${name}`;
  if (await env.EIRIN_KV.get(userKey)) {
    return json({ error: "这个名字已被注册" }, 409, cors);
  }

  const salt = randomToken().slice(0, 32);
  const token = randomToken();
  const record = {
    name,
    salt,
    pwhash: await hashPassword(body.password, salt),
    tokenHash: await sha256(token),
    createdAt: new Date().toISOString(),
  };

  await env.EIRIN_KV.put(userKey, JSON.stringify(record));
  await env.EIRIN_KV.put(`token:${record.tokenHash}`, name);
  return json({ ok: true, name, token }, 200, cors);
}

async function login(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string") {
    return json({ error: "参数不全" }, 400, cors);
  }
  const name = body.name.trim();
  const user = await env.EIRIN_KV.get(`user:${name}`, "json");
  if (!user) return json({ error: "用户不存在" }, 404, cors);

  if (typeof body.token === "string" && body.token) {
    const hash = await sha256(body.token);
    return hash === user.tokenHash
      ? json({ ok: true, name }, 200, cors)
      : json({ error: "凭证无效" }, 401, cors);
  }

  if (typeof body.password === "string" && body.password) {
    const hash = await hashPassword(body.password, user.salt);
    if (hash !== user.pwhash) return json({ error: "密码错误" }, 401, cors);
    /* 用密码登录时轮换 token，旧 token 立即失效 */
    const token = randomToken();
    user.tokenHash = await sha256(token);
    await env.EIRIN_KV.put(`user:${name}`, JSON.stringify(user));
    await env.EIRIN_KV.put(`token:${user.tokenHash}`, name);
    return json({ ok: true, name, token }, 200, cors);
  }

  return json({ error: "需要 token 或密码" }, 400, cors);
}

async function auth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const hash = await sha256(token);
  const name = await env.EIRIN_KV.get(`token:${hash}`);
  return name ? { name, tokenHash: hash } : null;
}

async function listMessages(request, env, cors) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, MAX_MESSAGES);
  const listed = await env.EIRIN_KV.list({ prefix: "msg:", limit: MAX_MESSAGES });
  const keys = listed.keys.map((k) => k.name).sort().reverse().slice(0, limit);

  const messages = [];
  for (const key of keys) {
    const item = await env.EIRIN_KV.get(key, "json");
    if (item) messages.push(item);
  }
  return json({ messages }, 200, cors);
}

async function postMessage(request, env, cors) {
  const user = await auth(request, env);
  if (!user) return json({ error: "请先登录" }, 401, cors);

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > MAX_CONTENT) {
    return json({ error: `内容需 1–${MAX_CONTENT} 字` }, 400, cors);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(env, ip, "post"))) {
    return json({ error: "发得太频繁，请稍后再试" }, 429, cors);
  }

  const id = randomToken().slice(0, 12);
  const now = new Date().toISOString();
  const message = { id, name: user.name, content, createdAt: now };
  await env.EIRIN_KV.put(`msg:${now}:${id}`, JSON.stringify(message));
  return json({ ok: true, message }, 200, cors);
}

/* --------------------------------------------------------------- 入口 --- */

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    try {
      if (url.pathname === "/api/register" && request.method === "POST") {
        if (!(await rateLimit(env, ip, "register"))) {
          return json({ error: "注册过于频繁" }, 429, cors);
        }
        return await register(request, env, cors);
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        return await login(request, env, cors);
      }

      if (url.pathname === "/api/messages" && request.method === "GET") {
        return await listMessages(request, env, cors);
      }

      if (url.pathname === "/api/messages" && request.method === "POST") {
        return await postMessage(request, env, cors);
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, service: "eirin-discuss", version: 1 }, 200, cors);
      }

      return json({ error: "Not Found" }, 404, cors);
    } catch (error) {
      return json({ error: "服务器错误", detail: String(error?.message || error) }, 500, cors);
    }
  },
};
