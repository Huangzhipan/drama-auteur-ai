import http from "node:http";
import crypto from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PORT = Number(process.env.API_PORT || 8787);
const HOST = process.env.API_HOST || "0.0.0.0";
const ADMIN_DATA_FILE = resolve(process.env.ADMIN_DATA_FILE || "./data/admin.json");
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const activeAdminSessions = new Map();

loadEnv();

function loadEnv() {
  if (!existsSync(".env")) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, { ok: true, hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/track-visit") {
    try {
      const body = await readJson(req);
      recordVisit(req, body);
      writeJson(res, 200, { ok: true });
    } catch {
      writeJson(res, 200, { ok: true });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/redeem") {
    try {
      const body = await readJson(req);
      const result = redeemCode(String(body.code || ""));
      writeJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "兑换失败";
      writeJson(res, 400, { ok: false, error: message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/admin-api/login") {
    try {
      const body = await readJson(req);
      if (String(body.username || "") !== "admin" || String(body.password || "") !== getAdminPassword()) {
        writeJson(res, 401, { ok: false, error: "账号或密码错误" });
        return;
      }
      const token = createAdminSession();
      writeJson(res, 200, { ok: true, token });
    } catch {
      writeJson(res, 400, { ok: false, error: "登录失败" });
    }
    return;
  }

  if (req.url?.startsWith("/admin-api/")) {
    if (!isAdminRequest(req)) {
      writeJson(res, 401, { ok: false, error: "请先登录" });
      return;
    }

    if (req.method === "GET" && req.url === "/admin-api/summary") {
      const store = readAdminStore();
      writeJson(res, 200, buildAdminSummary(store));
      return;
    }

    if (req.method === "POST" && req.url === "/admin-api/codes") {
      try {
        const body = await readJson(req);
        const days = clampInt(body.days, 1, 365, 30);
        const count = clampInt(body.count, 1, 100, 1);
        const label = String(body.label || "").trim().slice(0, 80);
        const codes = createRedeemCodes({ days, count, label });
        writeJson(res, 200, { ok: true, codes });
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成失败";
        writeJson(res, 400, { ok: false, error: message });
      }
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/diagnose") {
    try {
      const body = await readJson(req);
      let report;
      if (process.env.GEMINI_API_KEY) {
        try {
          report = await diagnoseWithGemini(body);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Gemini 调用失败";
          report = createFallbackReport(body, `Gemini 暂时不可用，当前报告由本地 skill 规则生成。原因：${message.slice(0, 120)}`);
        }
      } else {
        report = createFallbackReport(body, "未检测到 GEMINI_API_KEY，当前报告由本地 skill 规则生成。");
      }
      writeJson(res, 200, report);
    } catch (error) {
      const message = error instanceof Error ? error.message : "诊断失败";
      writeJson(res, 500, { error: message });
    }
    return;
  }

  writeJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Diagnosis API listening on http://localhost:${PORT}`);
  console.log(`Diagnosis API address: ${JSON.stringify(server.address())}`);
  console.log(process.env.GEMINI_API_KEY ? "Gemini API enabled" : "Gemini API key missing; fallback mode enabled");
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function writeJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("剧本文本过长，请先提交前几集或故事大纲。"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("请求 JSON 格式错误。"));
      }
    });
    req.on("error", reject);
  });
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "change-me-now";
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  activeAdminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  return token;
}

function isAdminRequest(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expiresAt = activeAdminSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    activeAdminSessions.delete(token);
    return false;
  }
  activeAdminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  return true;
}

function readAdminStore() {
  if (!existsSync(ADMIN_DATA_FILE)) {
    return { codes: [], visits: {}, events: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(ADMIN_DATA_FILE, "utf8"));
    return {
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      visits: parsed.visits && typeof parsed.visits === "object" ? parsed.visits : {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { codes: [], visits: {}, events: [] };
  }
}

function writeAdminStore(store) {
  mkdirSync(dirname(ADMIN_DATA_FILE), { recursive: true });
  writeFileSync(ADMIN_DATA_FILE, JSON.stringify(store, null, 2));
}

function todayKey(offset = 0) {
  const date = new Date(Date.now() + offset * 86400000);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function getClientFingerprint(req, body = {}) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket.remoteAddress || "";
  const ua = String(req.headers["user-agent"] || "");
  const visitorId = String(body.visitorId || "").slice(0, 160);
  return crypto.createHash("sha256").update(`${visitorId}|${ip}|${ua}`).digest("hex");
}

function recordVisit(req, body) {
  const store = readAdminStore();
  const day = todayKey();
  const fingerprint = getClientFingerprint(req, body);
  if (!store.visits[day]) store.visits[day] = {};
  store.visits[day][fingerprint] = Date.now();
  writeAdminStore(store);
}

function createRedeemCodes({ days, count, label }) {
  const store = readAdminStore();
  const now = Date.now();
  const expiresAt = now + days * 86400000;
  const created = Array.from({ length: count }, () => ({
    code: randomCode(),
    label,
    createdAt: now,
    expiresAt,
    redeemedAt: null,
    status: "active",
  }));
  store.codes.unshift(...created);
  writeAdminStore(store);
  return created;
}

function redeemCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "请输入兑换码" };
  const store = readAdminStore();
  const item = store.codes.find((entry) => normalizeCode(entry.code) === code);
  if (!item) return { ok: false, error: "兑换码不存在" };
  if (item.status !== "active") return { ok: false, error: "兑换码不可用" };
  if (item.redeemedAt) return { ok: false, error: "兑换码已被使用" };
  if (Number(item.expiresAt || 0) < Date.now()) return { ok: false, error: "兑换码已过期" };
  item.redeemedAt = Date.now();
  item.status = "redeemed";
  store.events.unshift({ type: "redeem", code: item.code, at: item.redeemedAt });
  store.events = store.events.slice(0, 300);
  writeAdminStore(store);
  return { ok: true, code: item.code, expiresAt: item.expiresAt };
}

function buildAdminSummary(store) {
  const days = Array.from({ length: 14 }, (_, index) => todayKey(-index)).map((day) => ({
    day,
    visitors: Object.keys(store.visits[day] || {}).length,
  }));
  const codes = store.codes.map((item) => ({
    code: item.code,
    label: item.label || "",
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    redeemedAt: item.redeemedAt || null,
    status: Number(item.expiresAt || 0) < Date.now() && !item.redeemedAt ? "expired" : item.status,
  }));
  return {
    ok: true,
    todayVisitors: days[0]?.visitors || 0,
    totalCodes: codes.length,
    activeCodes: codes.filter((item) => item.status === "active").length,
    redeemedCodes: codes.filter((item) => item.status === "redeemed").length,
    days,
    codes: codes.slice(0, 200),
  };
}

function normalizeCode(code) {
  return String(code || "").trim().replace(/\s+/g, "").toUpperCase();
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "XC-";
  for (let i = 0; i < 10; i += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i === 4) result += "-";
  }
  return result;
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

async function diagnoseWithGemini(input) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const prompt = buildDiagnosisPrompt(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GEMINI_TIMEOUT_MS || 160_000));
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        responseMimeType: "application/json",
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini 调用失败：${response.status} ${detail.slice(0, 400)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text.trim()) throw new Error("Gemini 未返回诊断内容。");

  const parsed = JSON.parse(stripJsonFence(text));
  return normalizeReport(parsed, input);
}

function buildDiagnosisPrompt(input) {
  const rawScript = String(input.scriptText || "");
  const script =
    rawScript.length > 24000
      ? `${rawScript.slice(0, 20000)}\n\n【中间内容已省略，以下为结尾片段】\n${rawScript.slice(-4000)}`
      : rawScript;
  return `
你是短剧承制公司的“剧本商业诊断”专家。用户只会上传剧本正文、故事梗概或前几集内容，你必须基于文本本身完成判断，不依赖用户额外填写目标受众、预算或集数。

请完全按本地 skill 的商业短剧结构逻辑做深度诊断，而不是只做泛泛评分。你的判断要接近专业短剧制片人/编剧统筹/AI制片人的综合评审。

必须覆盖以下逻辑：
1. 故事核：一句话卖点、主角困境、观众为什么继续看。
2. 前期留存：开场、前三分钟、前几场是否有强冲突、信息差、爆点、虐点或爽点。
3. 主线清晰度：是否单线推进，是否支线太多、理解成本太高。
4. 付费卡点：判断哪些位置适合做假兑现、反转打断、身份揭露、关系背叛。
5. 人设商业价值：主角、反派、关键关系是否有记忆点、讨论度和二创传播点。
6. 受众判断：从题材、冲突和情绪类型自动推断核心用户，不要要求用户填写。
7. 承制可行性：判断哪些人物、场景、道具适合优先资产化，哪些内容会增加成本。
8. 风险修复：每个风险必须给明确改法，不要泛泛而谈。

输出口径要求：
- 专业、克制、短句，不要宣传腔。
- 不要写“百万数据模型”“行业第一”等无法证明的话。
- 不要编造剧本中不存在的人物、事件、场景。
- 如果文本信息不足，要降低置信度，并在风险或建议里说明需要补充什么。
- score、marketFit、retention、characterValue 必须是 0-100 的整数。
- roi 不要写具体金额，写“谨慎看好”“可推进试拍”“需复核”“不建议直接推进”等判断。
- 结论必须具体，允许尖锐指出问题。不要为了好看而平均夸奖。
- 如果是男频、女频、仙侠、战神、重生、甜宠、复仇、家庭伦理等类型，必须明确类型和对应商业套路。
- AI视频适配度必须单独判断，重点看多人、打斗、法术、拥抱拉扯、长OS、复杂特效、场景切换、肢体接触等制作风险。

剧本名称：${input.title || "未命名剧本"}

剧本/梗概：
${script || "用户未提供正文，请基于项目信息输出低置信度初步诊断。"}

只返回 JSON，不要 Markdown，不要解释。JSON 结构必须完全如下：
{
  "title": "剧本名",
  "score": 88,
  "marketFit": 92,
  "retention": 86,
  "characterValue": 84,
  "roi": "谨慎看好",
  "payback": "需结合预算复核",
  "risk": "中",
  "basicJudgement": {
    "type": "题材/类型判断，例如：男频 / 仙尊重生 / 都市修仙 / 赘婿打脸",
    "audience": "目标受众判断，例如：25-45岁男性，下沉市场，追求力量碾压和反差爽感",
    "commercialFit": "8/10，并用一句话说明",
    "aiVideoFit": "3/10，并用一句话说明",
    "payPotential": "8/10，并用一句话说明",
    "oneLine": "一句话总评，必须指出最大优势和最大问题"
  },
  "storyCore": {
    "summary": "一句话故事核",
    "appeal": ["为什么有吸引力1", "为什么有吸引力2", "为什么有吸引力3"]
  },
  "hiddenLine": {
    "arc": "被X定义为Y → 用Y的方式Z → 发现真正要夺回的是W",
    "growth": ["主角真正成长1", "主角真正成长2"]
  },
  "goldenStructure": [
    {"episodes": "第1集", "currentFunction": "当前功能", "qualified": "合格/勉强合格/不合格/缺失", "suggestion": "具体优化建议"},
    {"episodes": "第2集", "currentFunction": "当前功能", "qualified": "合格/勉强合格/不合格/缺失", "suggestion": "具体优化建议"},
    {"episodes": "第3-4集", "currentFunction": "当前功能或推测缺失", "qualified": "合格/勉强合格/不合格/缺失", "suggestion": "具体优化建议"},
    {"episodes": "第5-8集", "currentFunction": "当前功能或推测缺失", "qualified": "合格/勉强合格/不合格/缺失", "suggestion": "具体优化建议"},
    {"episodes": "第9-10集", "currentFunction": "当前功能或推测缺失", "qualified": "合格/勉强合格/不合格/缺失", "suggestion": "具体优化建议"}
  ],
  "payPoints": [
    {"name": "首次卡点", "episode": "第10集", "type": "命运巨变/打脸/身份揭露/关系破裂等", "scene": "应该卡在哪里", "reason": "为什么观众会付费"},
    {"name": "二次卡点", "episode": "第30集", "type": "卡点类型", "scene": "应该卡在哪里", "reason": "为什么观众会付费"},
    {"name": "中期卡点", "episode": "第50集", "type": "卡点类型", "scene": "应该卡在哪里", "reason": "为什么观众会付费"},
    {"name": "后期卡点", "episode": "第70集", "type": "卡点类型", "scene": "应该卡在哪里", "reason": "为什么观众会付费"},
    {"name": "收尾卡点", "episode": "第90集", "type": "卡点类型", "scene": "应该卡在哪里", "reason": "为什么观众会付费"}
  ],
  "emotionCurve": {
    "strong": ["强爽点/强虐点/强爆点"],
    "weak": ["弱爽点或问题"],
    "frontload": ["应该前置的爽点或情绪"],
    "curve": "情绪曲线，例如：悲壮死亡 -> 屈辱重生 -> 前女友羞辱 -> 未婚妻空降"
  },
  "infoGaps": [
    {"gap": "信息差名称", "current": "当前剧本有没有", "suggestion": "优化建议"}
  ],
  "aiProductionRisks": [
    {"title": "人物风险/场景风险/台词风险/分镜风险/敏感词风险", "level": "极高/高/中/低", "note": "具体问题", "fix": "具体AI制片改法"}
  ],
  "revisionSuggestions": [
    {"title": "具体修改方向", "content": "详细修改建议"}
  ],
  "sampleEpisodes": [
    {"episode": "第1集", "reason": "为什么适合优先制作样片"},
    {"episode": "第3集", "reason": "为什么适合优先制作样片"},
    {"episode": "第10集", "reason": "为什么适合优先制作样片"}
  ],
  "audience": [
    {"name": "核心付费用户", "fit": 90, "note": "一句话原因"},
    {"name": "大众短剧用户", "fit": 75, "note": "一句话原因"},
    {"name": "泛娱乐轻度用户", "fit": 50, "note": "一句话原因"}
  ],
  "characters": [
    {"name": "主角", "tag": "高转化属性", "value": "高", "note": "一句话判断"},
    {"name": "反派", "tag": "讨论度属性", "value": "中", "note": "一句话判断"},
    {"name": "关键关系", "tag": "留存属性", "value": "中", "note": "一句话判断"}
  ],
  "risks": [
    {"title": "风险标题", "level": "高/中/低", "note": "问题描述", "fix": "修复建议"}
  ],
  "suggestions": [
    {"title": "建议标题", "content": "具体建议"}
  ],
  "commercialHooks": ["可包装卖点1", "可包装卖点2", "可包装卖点3"]
}
`;
}

function stripJsonFence(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
}

function normalizeReport(report, input) {
  const fallback = createFallbackReport(input, "");
  return {
    ...fallback,
    ...report,
    title: report.title || input.title || fallback.title,
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    score: clampNumber(report.score, fallback.score),
    marketFit: clampNumber(report.marketFit, fallback.marketFit),
    retention: clampNumber(report.retention, fallback.retention),
    characterValue: clampNumber(report.characterValue, fallback.characterValue),
    audience: normalizeArray(report.audience, fallback.audience),
    characters: normalizeArray(report.characters, fallback.characters),
    risks: normalizeArray(report.risks, fallback.risks),
    suggestions: normalizeArray(report.suggestions, fallback.suggestions),
    commercialHooks: normalizeArray(report.commercialHooks, fallback.commercialHooks),
    basicJudgement: report.basicJudgement || fallback.basicJudgement,
    storyCore: report.storyCore || fallback.storyCore,
    hiddenLine: report.hiddenLine || fallback.hiddenLine,
    goldenStructure: normalizeArray(report.goldenStructure, fallback.goldenStructure),
    payPoints: normalizeArray(report.payPoints, fallback.payPoints),
    emotionCurve: report.emotionCurve || fallback.emotionCurve,
    infoGaps: normalizeArray(report.infoGaps, fallback.infoGaps),
    aiProductionRisks: normalizeArray(report.aiProductionRisks, fallback.aiProductionRisks),
    revisionSuggestions: normalizeArray(report.revisionSuggestions, fallback.revisionSuggestions),
    sampleEpisodes: normalizeArray(report.sampleEpisodes, fallback.sampleEpisodes),
    source: "gemini",
  };
}

function normalizeArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function clampNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function createFallbackReport(input, note) {
  const script = String(input.scriptText || "");
  const hasHook = /失踪|秘密|真相|反派|调查|复仇|身份|妹妹|死亡|背叛|重生|离婚|认亲/.test(script);
  const score = hasHook ? 86 : 78;
  return {
    title: input.title || "未命名剧本",
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    score,
    marketFit: score + 4,
    retention: hasHook ? 88 : 72,
    characterValue: hasHook ? 84 : 76,
    roi: hasHook ? "谨慎看好" : "需复核",
    payback: "需结合预算复核",
    risk: hasHook ? "中" : "偏高",
    audience: [
      { name: "核心付费用户", fit: hasHook ? 90 : 75, note: "强冲突和信息差越早出现，付费转化越稳定。" },
      { name: "大众短剧用户", fit: hasHook ? 78 : 66, note: "题材理解成本可控，但需要明确前三集钩子。" },
      { name: "泛娱乐轻度用户", fit: hasHook ? 55 : 42, note: "需要更直观的情绪爽点承接传播。" },
    ],
    characters: [
      { name: "主角", tag: "高转化属性", value: "中高", note: "需要明确受压、反击和阶段性目标。" },
      { name: "反派", tag: "讨论度属性", value: "中", note: "建议强化可被观众识别的欲望和压迫行为。" },
      { name: "关键关系", tag: "留存属性", value: "中", note: "亲密关系的误会、保护或背叛可提升追更。" },
    ],
    risks: [
      { title: "前期钩子密度", level: "中", note: "如果第一集未快速出现危机和信息差，容易影响留存。", fix: "开场直接进入冲突现场，三分钟内抛出核心秘密。" },
      { title: "付费点结构", level: "中", note: "当前需要进一步明确第一个付费卡点。", fix: "在总集数约10%的位置设置真相即将公开但被打断的节点。" },
    ],
    suggestions: [
      { title: "优先优化前三集", content: "把故事核、主角目标、反派压迫和第一个悬念集中到前三集。" },
      { title: "提炼甲方沟通卖点", content: "用一句话概括项目商业优势，例如身份反差、旧案追凶、亲密关系背叛。" },
      { title: "承制前置建议", content: "先确认核心角色、关键场景和高频道具，降低后续资产试错成本。" },
    ],
    commercialHooks: ["前三分钟强危机", "身份差或真相差", "第一个付费卡点", "可视化核心道具"],
    basicJudgement: {
      type: "自动识别题材，需结合完整剧本复核",
      audience: "核心短剧付费用户，偏好强冲突、强反转和低理解成本",
      commercialFit: hasHook ? "8/10，具备悬念和情绪转化基础" : "6/10，商业类型还不够明确",
      aiVideoFit: "6/10，需避开复杂多人动作和高难度特效",
      payPotential: hasHook ? "8/10，具备卡点开发空间" : "6/10，需要更明确的付费钩子",
      oneLine: hasHook
        ? "故事有商业钩子，但需要把前三分钟危机和第一个付费点做得更尖锐。"
        : "当前文本可做初步判断，但故事核、主角目标和付费点还需要补强。",
    },
    storyCore: {
      summary: "主角在强压迫和秘密差中被迫行动，通过反击逐步夺回主动权。",
      appeal: ["低位受压能制造代入", "秘密差能制造追看", "反击节点适合做付费卡点"],
    },
    hiddenLine: {
      arc: "被外界定义为弱者 → 在压迫中寻找反击方式 → 夺回身份、尊严或核心关系",
      growth: ["从被动承受转为主动布局", "从追求外部认可转为掌握主动权"],
    },
    goldenStructure: [
      { episodes: "第1集", currentFunction: "建立危机和主角低位", qualified: hasHook ? "勉强合格" : "不合格", suggestion: "开场直接进入危机现场，减少背景铺垫。" },
      { episodes: "第2集", currentFunction: "延续压迫并抛出第一个目标", qualified: "缺失", suggestion: "让主角产生明确行动目标，不要只被动挨打。" },
      { episodes: "第3-4集", currentFunction: "建立小目标和第一层信息差", qualified: "缺失", suggestion: "设置可在几集内兑现的小反击，稳住追看。" },
      { episodes: "第5-8集", currentFunction: "多方施压，强化矛盾", qualified: "缺失", suggestion: "引入更具压迫感的反派或关键关系阻碍。" },
      { episodes: "第9-10集", currentFunction: "假付费点与首次正式卡点", qualified: "缺失", suggestion: "把真相即将公开、身份即将揭露或反击即将发生卡在集末。" },
    ],
    payPoints: [
      { name: "首次卡点", episode: "第10集", type: "反转打脸", scene: "主角即将被彻底压垮时掌握关键证据或力量", reason: "前面积压情绪后，观众急需看到第一次反击。" },
      { name: "二次卡点", episode: "第30集", type: "身份/关系揭露", scene: "关键人物站队或背叛，主角被迫公开部分底牌", reason: "关系变化会推动二次付费。" },
      { name: "中期卡点", episode: "第50集", type: "阶段目标达成后反转", scene: "目标刚达成，出现更大的幕后黑手", reason: "阶段兑现后必须立刻制造新期待。" },
      { name: "后期卡点", episode: "第70集", type: "生死危机", scene: "核心关系或主角命运出现不可逆代价", reason: "高情绪危机会提高追更黏性。" },
      { name: "收尾卡点", episode: "第90集", type: "终极真相", scene: "终极反派身份或最大秘密揭露", reason: "呼应开场核心悬念，推动完结付费。" },
    ],
    emotionCurve: {
      strong: ["危机压迫", "秘密差", "反击期待"],
      weak: ["如果只靠旁白交代，情绪会变钝"],
      frontload: ["主角低位受辱", "反派明确压迫", "关键秘密露出一角"],
      curve: "危机进入 -> 低位受压 -> 发现秘密 -> 反击期待",
    },
    infoGaps: [
      { gap: "主角知道/配角不知道", current: "部分具备", suggestion: "让观众提前知道主角掌握底牌，等待配角被打脸。" },
      { gap: "观众知道/主角不知道", current: "不足", suggestion: "适当给观众一个反派阴谋信息，制造替主角着急的情绪。" },
    ],
    aiProductionRisks: [
      { title: "人物风险", level: "中", note: "多人同框和复杂互动会增加脸崩、位置漂移概率。", fix: "关键场面控制在1-2个主体，群演做虚化背景。" },
      { title: "动作风险", level: "高", note: "拉扯、打斗、拥抱等肢体接触容易穿模。", fix: "拆成手部特写、反应镜头和结果镜头。" },
      { title: "台词风险", level: "中", note: "长OS会拖慢画面。", fix: "用闪回、道具和表情替代大段解释。" },
    ],
    revisionSuggestions: [
      { title: "重构开场", content: "第一场直接进入危机，用结果先钩住观众，再补原因。" },
      { title: "具象化金手指或秘密", content: "给主角一个可反复出现的视觉锚点，方便AI视频和后续宣发。" },
      { title: "明确首次付费点", content: "在第9-10集设置一次假兑现和一次强反转，避免前期只有铺垫。" },
    ],
    sampleEpisodes: [
      { episode: "第1集", reason: "最适合验证开场钩子和人物压迫关系。" },
      { episode: "第3集", reason: "适合验证主角小反击和信息差是否成立。" },
      { episode: "第10集", reason: "适合验证首次付费卡点和情绪爆发。" },
    ],
    source: "fallback",
    note,
  };
}
