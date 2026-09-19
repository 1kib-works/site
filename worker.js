/**
 * 1kib.fyi — サーバー側
 *
 * 静的ファイルは Cloudflare の assets が自動で返す。
 * ここでは /api/ で始まるリクエストだけを処理する。
 *
 * 不正対策の考え方：
 *  - タイムはブラウザの申告を信用せず、サーバーが開始時刻を記録して計算する
 *  - 判定1件ごとに /api/kessai/step を叩かせ、回数と整合しない記録は拒否する
 *  - 人間に不可能な速度は拒否する
 *  完全には防げないが、コンソールから数値を書き換えるだけの改ざんは通らない。
 */

const GOAL = 8;
const MIN_MS_PER_JUDGE = 250;      // 1件あたりこれより速いのは人間ではない
const MAX_SESSION_MS = 30 * 60 * 1000;
const NAME_MAX = 12;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // 静的ファイルへ
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === "/api/kessai/start" && request.method === "POST") {
        return await start(env);
      }
      if (url.pathname === "/api/kessai/step" && request.method === "POST") {
        return await step(request, env);
      }
      if (url.pathname === "/api/kessai/finish" && request.method === "POST") {
        return await finish(request, env);
      }
      if (url.pathname === "/api/kessai/ranking" && request.method === "GET") {
        return await ranking(url, env);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error" }, 500);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/* ── 開始：サーバー側で時刻を記録する ── */
async function start(env) {
  const token = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token, started_at) VALUES (?, ?)"
  ).bind(token, now).run();
  return json({ token });
}

/* ── 1件判定するたびに呼ぶ ── */
async function step(request, env) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  const correct = !!body.correct;
  const loss = Math.max(0, Math.min(99999999, parseInt(body.loss, 10) || 0));

  const s = await env.DB.prepare(
    "SELECT * FROM sessions WHERE token = ?"
  ).bind(token).first();

  if (!s) return json({ error: "no session" }, 400);
  if (s.done) return json({ error: "already finished" }, 400);
  if (Date.now() - s.started_at > MAX_SESSION_MS) {
    return json({ error: "expired" }, 400);
  }

  const ok = correct ? s.ok + 1 : 0;
  const fails = correct ? s.fails : s.fails + 1;
  const newLoss = s.loss + (correct ? 0 : loss);

  await env.DB.prepare(
    "UPDATE sessions SET ok = ?, fails = ?, loss = ?, processed = processed + 1 WHERE token = ?"
  ).bind(ok, fails, newLoss, token).run();

  return json({ ok });
}

/* ── クリア時 ── */
async function finish(request, env) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  let name = String(body.name || "").trim().slice(0, NAME_MAX);
  if (!name) name = "名無し";

  const s = await env.DB.prepare(
    "SELECT * FROM sessions WHERE token = ?"
  ).bind(token).first();

  if (!s) return json({ error: "no session" }, 400);
  if (s.done) return json({ error: "already finished" }, 400);
  if (s.ok < GOAL) return json({ error: "not cleared" }, 400);

  const ms = Date.now() - s.started_at;

  // 人間に不可能な速度は拒否
  if (ms < s.processed * MIN_MS_PER_JUDGE) {
    await env.DB.prepare("UPDATE sessions SET done = 1 WHERE token = ?").bind(token).run();
    return json({ error: "too fast", rejected: true }, 400);
  }
  if (ms > MAX_SESSION_MS) {
    await env.DB.prepare("UPDATE sessions SET done = 1 WHERE token = ?").bind(token).run();
    return json({ error: "expired" }, 400);
  }

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO scores (name, ms, fails, loss, processed, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(name, ms, s.fails, s.loss, s.processed, Math.floor(Date.now() / 1000)),
    env.DB.prepare("UPDATE sessions SET done = 1 WHERE token = ?").bind(token)
  ]);

  // 順位を返す
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM scores WHERE ms < ?"
  ).bind(ms).first();

  return json({ ms, fails: s.fails, loss: s.loss, rank: (r?.c ?? 0) + 1 });
}

/* ── ランキング取得 ── */
async function ranking(url, env) {
  const mode = url.searchParams.get("mode") === "clean" ? "clean" : "fast";

  const sql = mode === "clean"
    ? `SELECT name, ms, fails, loss, created_at FROM scores
       WHERE fails = 0 AND loss = 0
       ORDER BY ms ASC LIMIT 20`
    : `SELECT name, ms, fails, loss, created_at FROM scores
       ORDER BY ms ASC LIMIT 20`;

  const { results } = await env.DB.prepare(sql).all();
  const total = await env.DB.prepare("SELECT COUNT(*) AS c FROM scores").first();

  return json({ mode, total: total?.c ?? 0, rows: results ?? [] });
}
