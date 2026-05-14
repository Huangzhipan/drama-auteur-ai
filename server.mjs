import http from "node:http";
import crypto from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ExcelJS from "exceljs";

const PORT = Number(process.env.API_PORT || 8787);
const HOST = process.env.API_HOST || "0.0.0.0";
const ADMIN_DATA_FILE = resolve(process.env.ADMIN_DATA_FILE || "./data/admin.json");
const ADMIN_PAGE_FILE = resolve(process.env.ADMIN_PAGE_FILE || "./public/xingchi-admin.html");
const ADMIN_PAGE_FALLBACK_FILE = resolve("./dist/xingchi-admin.html");
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SUPER_REDEEM_CODE = "2388285";
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

  if (req.method === "GET" && req.url === "/admin") {
    const adminPage = existsSync(ADMIN_PAGE_FILE) ? ADMIN_PAGE_FILE : ADMIN_PAGE_FALLBACK_FILE;
    if (existsSync(adminPage)) {
      const html = readFileSync(adminPage, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }
    writeJson(res, 404, { error: "Admin page not found" });
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

  if (req.method === "POST" && req.url === "/api/assets") {
    try {
      const body = await readJson(req);
      let assetPackage;
      if (process.env.GEMINI_API_KEY) {
        try {
          assetPackage = await buildAssetsWithGemini(body);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Gemini 资产分析失败";
          assetPackage = createFallbackAssetPackage(body, `Gemini 暂时不可用，当前资产清单由本地规则生成。原因：${message.slice(0, 120)}`);
        }
      } else {
        assetPackage = createFallbackAssetPackage(body, "未检测到 GEMINI_API_KEY，当前资产清单由本地规则生成。");
      }
      if (shouldGenerateImages(body)) {
        assetPackage = await attachReferenceImages(assetPackage);
      }
      writeJson(res, 200, assetPackage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "资产生成失败";
      writeJson(res, 500, { error: message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/assets/image") {
    try {
      const body = await readJson(req);
      if (!process.env.GEMINI_API_KEY) {
        writeJson(res, 400, { ok: false, error: "未检测到 GEMINI_API_KEY，无法生成资产参考图。" });
        return;
      }
      const prompt = String(body.prompt || body.promptEn || body.visualAnchor || "").trim();
      if (!prompt) {
        writeJson(res, 400, { ok: false, error: "缺少生图提示词。" });
        return;
      }
      const result = await generateGeminiReferenceImage(prompt, {
        modelChoice: body.imageModel,
        imageStyle: body.imageStyle,
      });
      writeJson(res, 200, {
        ok: true,
        referenceImage: result.image,
        imageModel: result.model,
        imageStatus: "已生成",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "生图失败";
      writeJson(res, 500, { ok: false, error: message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/assets/export") {
    try {
      const body = await readJson(req, {
        maxBytes: 80_000_000,
        tooLargeMessage: "导出内容过大，请先减少生成图片数量，或分批导出资产表。",
      });
      const buffer = await buildAssetsWorkbook(body.assetPackage || body);
      const filename = encodeURIComponent(`${sanitizeFilename(body?.assetPackage?.title || body?.title || "短剧")}_AI视觉资产清单_客户版.xlsx`);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Content-Length": buffer.length,
      });
      res.end(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Excel 导出失败";
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

function readJson(req, options = {}) {
  const maxBytes = options.maxBytes || 2_000_000;
  const tooLargeMessage = options.tooLargeMessage || "剧本文本过长，请先提交前几集或故事大纲。";
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      raw += chunk;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        rejected = true;
        reject(new Error(tooLargeMessage));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (rejected) return;
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
  if (code === SUPER_REDEEM_CODE) {
    return { ok: true, code: SUPER_REDEEM_CODE, expiresAt: null, unlimited: true };
  }
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

async function buildAssetsWithGemini(input) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const prompt = buildAssetsPrompt(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GEMINI_TIMEOUT_MS || 160_000));
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.28,
        responseMimeType: "application/json",
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini 资产分析失败：${response.status} ${detail.slice(0, 400)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text.trim()) throw new Error("Gemini 未返回资产内容。");
  const parsed = JSON.parse(stripJsonFence(text));
  return normalizeAssetPackage(parsed, input, "gemini");
}

function shouldGenerateImages(input) {
  const value = input?.generateImages;
  if (value === true) return true;
  const text = String(value || "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

function buildAssetsPrompt(input) {
  const rawScript = String(input.scriptText || "");
  const script =
    rawScript.length > 24000
      ? `${rawScript.slice(0, 20000)}\n\n【中间内容已省略，以下为结尾片段】\n${rawScript.slice(-4000)}`
      : rawScript;

  return `
你是AI真人短剧承制公司的“短剧人物资产与美术资产执行层 Agent”。你的任务不是总结剧情、不是商业诊断、不是写分镜；你的任务是读取短剧剧本，识别稳定可复用的视觉资产，并生成可直接用于图片生成、客户审核 Excel 和后续样片制作的结构化资产数据。请严格参考以下制片逻辑：

一、业务流程
剧本输入 → 提取基础资产 → 判断衍生资产 → 生成英文定妆/生图提示词 → 风险检查 → 导出客户审核 Excel → 客户确认后进入样片制作。

二、资产判断规则
1. 基础资产只包括稳定复用的人物、场景、道具、可复用片段，不要把瞬时动作、表情、眼泪、手部特写当成资产。
2. 衍生资产是父资产的视觉状态变体，例如服装变体、战损状态、场景雨夜版、道具激活/破损版。
3. 角色衍生只保留两类：服装变体、结构性外观变化。表情和情绪不建资产。
4. 场景衍生只保留时间、天气、破坏、氛围状态变化。
5. 道具衍生只保留激活、损坏、展开、发光、碎裂等可复用状态。
6. 每个父资产最多 1-5 个衍生，宁缺勿滥。
7. 对AI视频高风险内容要在风险检查里说明如何规避，例如多人同框、打斗、拥抱拉扯、巨兽、复杂法术、群像混乱。
8. 角色必须尽量完整：凡是剧本里具名、反复出现、有台词/动作/关系功能的人物，都要进入 baseAssets 的 role；不要只提取主角。
9. baseAssets 建议顺序：主要角色 → 重要配角/反派 → 核心场景 → 关键道具。
10. derivedAssets 不能空泛；只要剧本出现稳定复用的服装变化、受伤/战损、雨夜/白天、破损/激活等状态，就必须挂到对应父资产。
11. 角色默认父资产只代表“人物身份基准”，剧本中明确出现常服、校服、礼服、病号服、婚纱、盔甲、战斗服、长期伤残/异化时，应优先建立对应衍生资产。
12. 每个基础资产必须能在剧本中找到依据。不要为了“好看”凭空创造新角色、新地点、新武器。信息不足时写“待补充”，但不要乱编。

三、输出风格
- 面向客户审核，专业、清晰、可落地。
- 不要编造剧本没有的人物关系；如果信息不足，要用“待补充”说明。
- 英文提示词必须适合真人短剧视觉参考图生成，竖屏 9:16，写实、定妆、无水印、无文字；现代题材默认中国真人短剧质感，古装/仙侠题材默认中国真人古装/仙侠剧质感。
- 人物提示词必须包含：年龄段、性别、市场适配、面部识别锚点、发型、身材气质、服装、情绪基调、画面风格、禁止项。
- 场景提示词必须包含：场景名称、时间/天气/状态、空间层次、光影方向、氛围、禁止文字/水印/logo。
- 道具提示词必须包含：道具名称、材质、状态、可见细节、使用场景、光影、禁止项。
- 每个 imagePrompt/promptEn 必须只服务当前资产，必须写清对应 name、defaultState/状态、visualAnchor，不允许写成泛泛的“主角/场景参考图”。
- 角色资产必须生成 threeViewPrompt；非角色资产 threeViewPrompt 为空字符串。
- assetChecklist 必须覆盖每一个 baseAssets 默认态和每一个 derivedAssets 衍生态，数量必须等于 baseAssets.length + derivedAssets.length。
- 所有 ID 必须稳定，英文小写加下划线，例如 role_yang_xuan、scene_crayfish_stall、tool_dragon_slayer_blade、clip_family_banquet_reversal。
- 输出要像制片流水线，不像剧情摘要。资产名称、状态、提示词、Excel 行必须一一对应。

剧本名称：${input.title || "未命名剧本"}

剧本正文：
${script || "用户未提供正文，请输出低置信度资产框架。"}

只返回 JSON，不要 Markdown。JSON 结构必须完全如下：
{
  "projectName": "剧本名",
  "title": "剧本名",
  "summary": "一句话说明本次资产提取口径",
  "executionJudgement": {
    "needDerivedAssets": true,
    "derivedAssetCount": 0,
    "mainReason": "为什么需要/不需要衍生资产",
    "riskNote": "最大资产执行风险"
  },
  "baseAssets": [
    {
      "assetsId": "role_xxx",
      "assetCode": "R_01/S_01/T_01/C_01",
      "name": "资产名称",
      "type": "role/scene/tool/clip",
      "function": "剧情功能",
      "visualAnchor": "核心视觉锚点，用 / 分隔",
      "consistencyRisk": "一致性风险",
      "defaultState": "默认状态",
      "imagePrompt": "英文定妆/生图提示词",
      "threeViewPrompt": "角色三视图英文提示词，非角色为空",
      "promptEn": "同 imagePrompt"
    }
  ],
  "derivedAssets": [
    {
      "assetsId": "父资产ID",
      "parentAssetsId": "父资产ID",
      "assetCode": "R_01_D1/S_01_D1/T_01_D1/C_01_D1",
      "id": null,
      "name": "2-6字状态名",
      "desc": "与默认态差异 · 视觉特征",
      "type": "role/scene/tool/clip",
      "reason": "为什么需要作为衍生资产",
      "reuseScenes": "复用场景",
      "imagePrompt": "英文定妆/生图提示词",
      "threeViewPrompt": "角色衍生三视图英文提示词，非角色为空",
      "promptEn": "同 imagePrompt"
    }
  ],
  "addDeriveAssetCalls": [
    {
      "assetsId": "父资产ID",
      "id": null,
      "name": "状态名",
      "desc": "与默认态差异 · 视觉特征",
      "type": "role/scene/tool/clip"
    }
  ],
  "scenePrompts": [
    {
      "assetCode": "S_01",
      "name": "场景名",
      "state": "状态",
      "prompt": "英文场景提示词"
    }
  ],
  "toolPrompts": [
    {
      "assetCode": "T_01",
      "name": "道具名",
      "state": "状态",
      "prompt": "英文道具提示词"
    }
  ],
  "doNotExtract": [
    {
      "content": "不应资产化的内容",
      "reason": "为什么不提取"
    }
  ],
  "assetChecklist": [
    {
      "category": "角色/场景/道具",
      "assetNo": "R_01 或 R_01_D1 或 S_01 或 T_01",
      "name": "角色/资产名称",
      "state": "资产状态",
      "visualAnchor": "核心视觉锚点",
      "imageStatus": "待生成/已生成/需人工补图",
      "threeViewStatus": "待生成/不需要",
      "imagePrompt": "英文定妆/生图提示词",
      "threeViewPrompt": "三视图提示词",
      "promptEn": "英文定妆/生图提示词",
      "sourceAssetsId": "对应基础资产ID"
    }
  ],
  "riskChecks": [
    {
      "content": "风险内容",
      "judgement": "判断/修正"
    }
  ]
}
`;
}

function normalizeAssetPackage(pkg, input, source) {
  const fallback = createFallbackAssetPackage(input, "");
  const baseAssets = supplementCharacterAssets(
    normalizeAssetsArray(pkg.baseAssets, fallback.baseAssets),
    String(input.scriptText || ""),
  ).slice(0, 30);
  const derivedAssets = supplementDerivedAssets(
    normalizeDerivedArray(pkg.derivedAssets, fallback.derivedAssets),
    baseAssets,
    String(input.scriptText || ""),
  ).slice(0, 60);
  const assetChecklist = normalizeChecklistArray(pkg.assetChecklist, baseAssets, derivedAssets).slice(0, 90);
  const executionJudgement = normalizeExecutionJudgement(pkg.executionJudgement, derivedAssets, assetChecklist);
  return {
    projectName: String(pkg.projectName || pkg.title || input.title || fallback.title || "未命名剧本"),
    title: String(pkg.title || pkg.projectName || input.title || fallback.title || "未命名剧本"),
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    summary: String(pkg.summary || fallback.summary),
    source,
    note: pkg.note || "",
    executionJudgement,
    baseAssets,
    derivedAssets,
    addDeriveAssetCalls: buildAddDeriveAssetCalls(derivedAssets),
    scenePrompts: buildTypedPrompts(assetChecklist, "场景"),
    toolPrompts: buildTypedPrompts(assetChecklist, "道具"),
    doNotExtract: normalizeDoNotExtract(pkg.doNotExtract),
    assetChecklist,
    riskChecks: normalizeRiskChecks(pkg.riskChecks, fallback.riskChecks),
  };
}

function normalizeAssetsArray(value, fallback) {
  const rows = Array.isArray(value) && value.length ? value : fallback;
  return rows.map((item, index) => {
    const type = normalizeAssetType(item.type);
    const imagePrompt = String(item.imagePrompt || item.promptEn || buildDefaultAssetPrompt(item.name, type, item.visualAnchor, item.defaultState));
    return {
      assetsId: item.assetsId || `${type}_${slug(`${item.name || index + 1}`)}`,
      assetCode: String(item.assetCode || ""),
      name: String(item.name || `资产${index + 1}`),
      type,
      function: String(item.function || "待补充剧情功能"),
      visualAnchor: String(item.visualAnchor || "待补充视觉锚点"),
      consistencyRisk: String(item.consistencyRisk || "需在样片阶段复核一致性"),
      defaultState: String(item.defaultState || "默认态"),
      imagePrompt,
      threeViewPrompt: type === "role" ? String(item.threeViewPrompt || buildThreeViewPrompt(item.name, item.visualAnchor, item.defaultState)) : "",
      promptEn: imagePrompt,
    };
  });
}

function normalizeDerivedArray(value, fallback) {
  const rows = Array.isArray(value) && value.length ? value : fallback;
  return rows.map((item, index) => {
    const type = normalizeAssetType(item.type);
    const imagePrompt = String(item.imagePrompt || item.promptEn || buildDefaultAssetPrompt(item.name, type, item.desc));
    return {
      assetsId: String(item.assetsId || item.parentAssetsId || ""),
      parentAssetsId: String(item.parentAssetsId || item.assetsId || ""),
      assetCode: String(item.assetCode || ""),
      id: item.id ?? null,
      name: String(item.name || `衍生${index + 1}`).slice(0, 12),
      desc: String(item.desc || "与默认态差异 · 待补充视觉特征"),
      type,
      reason: String(item.reason || "该状态影响后续镜头一致性，需要单独固定。"),
      reuseScenes: String(item.reuseScenes || "样片关键镜头"),
      imagePrompt,
      threeViewPrompt: type === "role" ? String(item.threeViewPrompt || buildThreeViewPrompt(item.name, item.desc, "衍生状态")) : "",
      promptEn: imagePrompt,
    };
  });
}

function supplementCharacterAssets(baseAssets, script) {
  const existing = new Set(baseAssets.filter((item) => item.type === "role").map((item) => item.name));
  const names = extractLikelyCharacterNames(script)
    .filter((name) => !existing.has(name))
    .slice(0, Math.max(0, 12 - existing.size));
  const supplements = names.map((name) => ({
    assetsId: `role_${slug(name)}`,
    assetCode: "",
    name,
    type: "role",
    function: "剧本具名人物；需进入客户审核资产，避免样片阶段临时补脸。",
    visualAnchor: "中国真人短剧人物 / 年龄身份待从剧本细化 / 脸型发型服装需固定 / 与其他角色区分明显",
    consistencyRisk: "Gemini 未完整展开该角色，需在客户审核时补充年龄、身份和服装参考。",
    defaultState: "默认定妆",
    imagePrompt: buildDefaultAssetPrompt(name, "role", "Chinese live-action short drama named character, realistic actor casting reference, distinct face, practical wardrobe, consistent identity", "默认定妆"),
    threeViewPrompt: buildThreeViewPrompt(name, "Chinese live-action short drama named character, practical wardrobe, distinct face", "默认定妆"),
    promptEn: buildDefaultAssetPrompt(name, "role", "Chinese live-action short drama named character, realistic actor casting reference, distinct face, practical wardrobe, consistent identity", "默认定妆"),
  }));
  return [...baseAssets, ...supplements];
}

function supplementDerivedAssets(derivedAssets, baseAssets, script) {
  const existingKeys = new Set(derivedAssets.map((item) => `${item.assetsId}:${item.name}`));
  const additions = [];
  const lead = baseAssets.find((item) => item.type === "role");
  if (lead && /受伤|流血|战损|狼狈|昏迷|断腿|断臂|残废|被打|羞辱|围堵|追杀/.test(script)) {
    additions.push({
      assetsId: lead.assetsId,
      id: null,
      name: "受压态",
      desc: "与默认态差异 · 服装略凌乱，带轻微伤痕或压迫痕迹，眼神仍保持反击感",
      type: "role",
      reason: "主角高压状态会反复用于开场压迫和反击前情绪铺垫，需要单独固定。",
      reuseScenes: "开场冲突；被压迫段落；反击前镜头",
      imagePrompt: buildDefaultAssetPrompt(lead.name, "role", "same face identity, slightly messy practical wardrobe, subtle injury marks, restrained anger, live-action short drama reference", "受压态"),
      threeViewPrompt: buildThreeViewPrompt(lead.name, "same face identity, slightly messy practical wardrobe, subtle injury marks", "受压态"),
      promptEn: buildDefaultAssetPrompt(lead.name, "role", "same face identity, slightly messy practical wardrobe, subtle injury marks, restrained anger, live-action short drama reference", "受压态"),
    });
  }

  for (const scene of baseAssets.filter((item) => item.type === "scene")) {
    if (/雨夜|暴雨|下雨|雨中/.test(`${script}\n${scene.name}\n${scene.visualAnchor}`)) {
      additions.push({
        assetsId: scene.assetsId,
        id: null,
        name: "雨夜版",
        desc: "与默认态差异 · 夜色雨水、湿地反光、冷色环境光，空间结构保持一致",
        type: "scene",
        reason: "雨夜场景会明显改变光线和空间质感，需作为可复用场景状态。",
        reuseScenes: "雨夜冲突；追逐；压迫或反转镜头",
        imagePrompt: buildDefaultAssetPrompt(scene.name, "scene", "same location layout, rainy night, wet reflections, cold realistic lighting, live-action short drama scene reference", "雨夜版"),
        threeViewPrompt: "",
        promptEn: buildDefaultAssetPrompt(scene.name, "scene", "same location layout, rainy night, wet reflections, cold realistic lighting, live-action short drama scene reference", "雨夜版"),
      });
    }
  }

  for (const tool of baseAssets.filter((item) => item.type === "tool")) {
    if (/破损|碎裂|染血|激活|发光|展开|启动/.test(`${script}\n${tool.name}\n${tool.visualAnchor}`)) {
      additions.push({
        assetsId: tool.assetsId,
        id: null,
        name: "关键态",
        desc: "与默认态差异 · 道具进入激活、破损或高光特写状态，材质和形状保持一致",
        type: "tool",
        reason: "关键道具状态会承担反转证据或能力展示，需要客户提前确认。",
        reuseScenes: "证据揭露；反转镜头；特写镜头",
        imagePrompt: buildDefaultAssetPrompt(tool.name, "tool", "same prop design, activated or damaged key state, realistic close-up reference", "关键态"),
        threeViewPrompt: "",
        promptEn: buildDefaultAssetPrompt(tool.name, "tool", "same prop design, activated or damaged key state, realistic close-up reference", "关键态"),
      });
    }
  }

  for (const item of additions) {
    const key = `${item.assetsId}:${item.name}`;
    if (!existingKeys.has(key)) {
      derivedAssets.push(item);
      existingKeys.add(key);
    }
  }
  return derivedAssets;
}

function normalizeChecklistArray(value, baseAssets, derivedAssets) {
  const counters = { role: 0, scene: 0, tool: 0, clip: 0 };
  const baseRows = baseAssets.map((item) => {
    counters[item.type] = (counters[item.type] || 0) + 1;
    const prefix = assetPrefix(item.type);
    const assetNo = item.assetCode || `${prefix}_${String(counters[item.type]).padStart(2, "0")}`;
    const prompt = buildChecklistPrompt(item.imagePrompt || item.promptEn, item.name, `${item.defaultState || "默认"} (默认)`, item.visualAnchor, item.type);
    return {
      category: normalizeCategory(item.type),
      assetNo,
      name: item.name,
      state: `${item.defaultState || "默认"} (默认)`,
      visualAnchor: item.visualAnchor,
      imageStatus: "待生成",
      threeViewStatus: item.type === "role" ? "待生成" : "不需要",
      imagePrompt: prompt,
      threeViewPrompt: item.type === "role" ? item.threeViewPrompt : "",
      promptEn: prompt,
      sourceAssetsId: item.assetsId,
      referenceImage: "",
      imageModel: "",
    };
  });

  const byParent = new Map();
  for (const row of baseRows) byParent.set(row.sourceAssetsId, { baseNo: row.assetNo, count: 0, category: row.category });
  const derivedRows = derivedAssets.map((item) => {
    const parent = byParent.get(item.assetsId) || { baseNo: `${assetPrefix(item.type)}_00`, count: 0, category: normalizeCategory(item.type) };
    parent.count += 1;
    byParent.set(item.assetsId, parent);
    const base = baseAssets.find((asset) => asset.assetsId === item.assetsId);
    const prompt = buildChecklistPrompt(item.imagePrompt || item.promptEn, base?.name || item.assetsId || "衍生资产", `${item.name} (衍生)`, item.desc.replace(/^与默认态差异\s*·\s*/, ""), item.type);
    return {
      category: parent.category,
      assetNo: item.assetCode || `${parent.baseNo}_D${parent.count}`,
      name: base?.name || item.assetsId || "衍生资产",
      state: `${item.name} (衍生)`,
      visualAnchor: item.desc.replace(/^与默认态差异\s*·\s*/, ""),
      imageStatus: "待生成",
      threeViewStatus: item.type === "role" ? "待生成" : "不需要",
      imagePrompt: prompt,
      threeViewPrompt: item.type === "role" ? item.threeViewPrompt : "",
      promptEn: prompt,
      sourceAssetsId: item.assetsId,
      referenceImage: "",
      imageModel: "",
    };
  });
  const canonicalRows = [...baseRows, ...derivedRows];
  return mergeChecklistRuntimeState(canonicalRows, value);
}

function mergeChecklistRuntimeState(canonicalRows, value) {
  if (!Array.isArray(value) || !value.length) return canonicalRows;
  const suppliedRows = value.map((item) => ({
    assetNo: String(item.assetNo || ""),
    state: String(item.state || "默认"),
    name: String(item.name || ""),
    sourceAssetsId: String(item.sourceAssetsId || ""),
    imageStatus: String(item.imageStatus || ""),
    threeViewStatus: String(item.threeViewStatus || ""),
    referenceImage: item.referenceImage || "",
    imageModel: item.imageModel || "",
  }));
  return canonicalRows.map((row) => {
    const supplied = suppliedRows.find((item) => (
      (item.assetNo && item.assetNo === row.assetNo)
      || (item.sourceAssetsId && item.sourceAssetsId === row.sourceAssetsId && item.state === row.state)
      || (item.name === row.name && item.state === row.state)
    ));
    if (!supplied) return row;
    return {
      ...row,
      imageStatus: supplied.imageStatus || row.imageStatus,
      threeViewStatus: supplied.threeViewStatus || row.threeViewStatus,
      referenceImage: supplied.referenceImage || row.referenceImage,
      imageModel: supplied.imageModel || row.imageModel,
    };
  });
}

function buildChecklistPrompt(prompt, name, state, visualAnchor, type) {
  const subject = type === "scene" ? "scene/location asset" : type === "tool" ? "prop asset" : "character casting asset";
  return `${prompt || buildDefaultAssetPrompt(name, type, visualAnchor)}

Exact asset row: ${subject}. Asset name: ${name}. Required state: ${state}. Required visual anchors: ${visualAnchor}. Generate only this asset row, not another character, not another scene, not a mixed poster.`;
}

function normalizeRiskChecks(value, fallback) {
  const rows = Array.isArray(value) && value.length ? value : fallback;
  return rows.slice(0, 20).map((item) => ({
    content: String(item.content || "待检查内容"),
    judgement: String(item.judgement || "待补充判断"),
  }));
}

function normalizeExecutionJudgement(value, derivedAssets, assetChecklist) {
  return {
    needDerivedAssets: derivedAssets.length > 0,
    derivedAssetCount: derivedAssets.length,
    mainReason: String(value?.mainReason || (derivedAssets.length ? "剧本存在服装、场景状态或道具状态变化，需要拆成可复用资产。" : "当前剧本未出现明显稳定视觉状态变体。")),
    riskNote: String(value?.riskNote || (assetChecklist.some((item) => item.category === "角色") ? "人物脸、服装和状态需要优先固定，否则后续样片容易漂移。" : "需在样片阶段复核资产与剧本场景的一致性。")),
  };
}

function buildAddDeriveAssetCalls(derivedAssets) {
  return derivedAssets.map((item) => ({
    assetsId: item.assetsId,
    id: null,
    name: item.name,
    desc: item.desc,
    type: item.type,
  }));
}

function buildTypedPrompts(assetChecklist, category) {
  return assetChecklist
    .filter((item) => item.category === category)
    .map((item) => ({
      assetCode: item.assetNo,
      name: item.name,
      state: item.state,
      prompt: item.imagePrompt || item.promptEn,
    }));
}

function normalizeDoNotExtract(value) {
  const rows = Array.isArray(value) ? value : [];
  const defaults = [
    { content: "瞬时表情、眼泪、眼神变化", reason: "属于镜头表演或分镜描述，不是稳定可复用资产。" },
    { content: "手部特写、局部伤口、单镜头姿态", reason: "属于镜头级细节，放入分镜或视频提示词，不进入客户资产表。" },
  ];
  return (rows.length ? rows : defaults).slice(0, 12).map((item) => ({
    content: String(item.content || "不资产化内容"),
    reason: String(item.reason || "不属于稳定可复用视觉资产。"),
  }));
}

function normalizeAssetType(type) {
  const raw = String(type || "").toLowerCase();
  if (raw.includes("scene") || raw.includes("场景")) return "scene";
  if (raw.includes("tool") || raw.includes("prop") || raw.includes("道具")) return "tool";
  if (raw.includes("clip") || raw.includes("片段")) return "clip";
  return "role";
}

function normalizeCategory(category) {
  const type = normalizeAssetType(category);
  if (type === "scene") return "场景";
  if (type === "tool") return "道具";
  if (type === "clip") return "片段";
  return "角色";
}

function assetPrefix(type) {
  if (type === "scene") return "S";
  if (type === "tool") return "T";
  if (type === "clip") return "C";
  return "R";
}

async function attachReferenceImages(assetPackage) {
  const limit = Math.max(0, Math.min(12, Number(process.env.ASSET_IMAGE_LIMIT || 4)));
  if (!process.env.GEMINI_API_KEY || !limit) {
    for (const row of assetPackage.assetChecklist || []) {
      row.imageStatus = !process.env.GEMINI_API_KEY ? "未配置生图 API" : "未开启生图";
    }
    return assetPackage;
  }
  const rows = assetPackage.assetChecklist.slice(0, limit);
  for (const row of rows) {
    try {
      const image = await generateGeminiReferenceImage(row.promptEn || row.visualAnchor);
      if (image) {
        row.referenceImage = image.image;
        row.imageModel = image.model;
        row.imageStatus = "已生成";
      } else {
        row.imageStatus = "生图未返回图片";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "生图失败";
      row.imageStatus = `生图失败：${message.slice(0, 36)}`;
    }
  }
  return assetPackage;
}

async function generateGeminiReferenceImage(prompt, options = {}) {
  const modelChoice = String(options.modelChoice || "auto");
  const preferredModel = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
  const models = pickImageModels(modelChoice, preferredModel);
  const finalPrompt = buildImagePrompt(prompt, options.imageStyle);
  const errors = [];
  for (const model of models) {
    try {
      const result = await requestGeminiReferenceImage(model, finalPrompt);
      if (result?.image) return result;
      errors.push(`${model}: no image`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`${model}: ${message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

function pickImageModels(modelChoice, preferredModel) {
  const allowed = new Set(["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"]);
  if (allowed.has(modelChoice)) return [modelChoice];
  return [preferredModel, "gemini-2.5-flash-image"].filter((model, index, array) => model && array.indexOf(model) === index);
}

function buildImagePrompt(prompt, imageStyle) {
  const style = String(imageStyle || "real_short_drama");
  const base = String(prompt || "").replace(/\b(anime|cartoon|illustration|concept art|digital painting|3d render|game character)\b/gi, "");
  if (style === "anime_concept") {
    return `${base}

Style: high quality anime concept art for short drama pre-production, clean character design, coherent costume, no text, no watermark.`;
  }
  if (style === "ancient_real") {
    return `${base}

Style: photorealistic Chinese live-action costume drama production still, real human actor, natural skin texture, real fabric, practical costume and props, realistic lens photography, vertical 9:16.
Strictly avoid anime, manga, illustration, game concept art, CGI render, plastic skin, sci-fi armor unless explicitly required by the script.`;
  }
  if (style === "cinematic_real") {
    return `${base}

Style: cinematic photoreal live-action production still, real actor or real location, natural human face, believable wardrobe, realistic camera lens, grounded lighting, vertical 9:16.
Strictly avoid anime, manga, illustration, game character design, 3D render, concept art, exaggerated fantasy armor, plastic skin, text, watermark.`;
  }
  return `${base}

Style: Chinese真人短剧定妆照 / live-action short drama asset reference, real Chinese actor look, natural skin texture, realistic street-level wardrobe, practical production design, grounded modern drama lighting, vertical 9:16.
Strictly avoid anime, manga, illustration, digital painting, game character, 3D render, concept art, sci-fi armor, superhero costume, plastic skin, text, watermark.`;
}

async function requestGeminiReferenceImage(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GEMINI_IMAGE_TIMEOUT_MS || 90_000));
  const body = {
    contents: [{ role: "user", parts: [{ text: `${prompt}\n\nGenerate one clean vertical 9:16 visual reference image for production review. No text, no watermark.` }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  };
  if (model.includes("3.1")) {
    body.tools = [{ googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } }];
    body.generationConfig = {
      responseModalities: ["IMAGE"],
    };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify(body),
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${compactErrorText(detail).slice(0, 220)}`);
  }
  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part?.inlineData?.data);
  if (!imagePart) return "";
  const mime = imagePart.inlineData.mimeType || "image/png";
  return {
    image: `data:${mime};base64,${imagePart.inlineData.data}`,
    model,
  };
}

function compactErrorText(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || text;
  } catch {
    return String(text || "").replace(/\s+/g, " ");
  }
}

function createFallbackAssetPackage(input, note) {
  const title = input.title || "未命名剧本";
  const script = String(input.scriptText || "");
  const isXianxia = /龙|仙|魔|宗门|灵力|刀气|秘境|战袍|龙/.test(script);
  const isUrban = /豪门|千金|总裁|DNA|医院|公司|酒会|婚约/.test(script);
  const leadName = extractLikelyName(script) || "主角";
  const antagonist = /光头|混混|反派|恶霸/.test(script) ? "压迫者" : "反派";
  const mainScene = isXianxia ? "关键战场" : isUrban ? "公开冲突场" : "核心冲突场";

  let baseAssets = [
    {
      assetsId: `role_${slug(leadName)}`,
      assetCode: "",
      name: leadName,
      type: "role",
      function: "主角；承担开场代入、受压和反击主线。",
      visualAnchor: "中国真人短剧主角 / 25-35岁 / 五官清晰 / 眼神有压迫感 / 服装与题材一致",
      consistencyRisk: "主角出镜频率高，脸、发型和主场服装必须优先固定。",
      defaultState: isXianxia ? "现代常服" : "主场常服",
      imagePrompt: buildDefaultAssetPrompt(leadName, "role", "Chinese live-action short drama protagonist, sharp realistic face, consistent identity, main costume", isXianxia ? "现代常服" : "主场常服"),
      threeViewPrompt: buildThreeViewPrompt(leadName, "Chinese live-action short drama protagonist, sharp realistic face, consistent identity, main costume", isXianxia ? "现代常服" : "主场常服"),
      promptEn: buildDefaultAssetPrompt(leadName, "role", "Chinese live-action short drama protagonist, sharp realistic face, consistent identity, main costume", isXianxia ? "现代常服" : "主场常服"),
    },
    {
      assetsId: `role_${slug(antagonist)}`,
      assetCode: "",
      name: antagonist,
      type: "role",
      function: "制造压迫和第一轮冲突，推动主角反击。",
      visualAnchor: "中国真人短剧反派 / 清晰压迫感 / 服装和身份一眼可辨",
      consistencyRisk: "容易生成成普通路人，需要强化反派识别点。",
      defaultState: "主场服装",
      imagePrompt: buildDefaultAssetPrompt(antagonist, "role", "Chinese live-action short drama antagonist, recognizable oppressive presence", "主场服装"),
      threeViewPrompt: buildThreeViewPrompt(antagonist, "Chinese live-action short drama antagonist, recognizable oppressive presence", "主场服装"),
      promptEn: buildDefaultAssetPrompt(antagonist, "role", "Chinese live-action short drama antagonist, recognizable oppressive presence", "主场服装"),
    },
    {
      assetsId: `scene_${slug(mainScene)}`,
      assetCode: "",
      name: mainScene,
      type: "scene",
      function: "承载样片主冲突和客户审核视觉风格。",
      visualAnchor: isXianxia ? "海面/礁石/雷暴/巨物压迫/冷暖对比" : "现代中国空间/围观压力/强冲突动线/真实光线",
      consistencyRisk: "空间层次和人物站位需要固定，避免镜头切换后场景漂移。",
      defaultState: "主场版",
      imagePrompt: buildDefaultAssetPrompt(mainScene, "scene", isXianxia ? "storm ocean fantasy battlefield" : "modern Chinese conflict scene", "主场版"),
      threeViewPrompt: "",
      promptEn: buildDefaultAssetPrompt(mainScene, "scene", isXianxia ? "storm ocean fantasy battlefield" : "modern Chinese conflict scene", "主场版"),
    },
    {
      assetsId: "tool_key_evidence",
      assetCode: "",
      name: isXianxia ? "核心武器" : "关键证据道具",
      type: "tool",
      function: "推动反转或战力展示，是样片可视化记忆点。",
      visualAnchor: isXianxia ? "厚重长刀/能量纹路/高光状态" : "文件/戒指/录音/照片/可特写",
      consistencyRisk: "道具形态容易漂移，需要固定大小、材质和特写方式。",
      defaultState: "默认态",
      imagePrompt: buildDefaultAssetPrompt(isXianxia ? "核心武器" : "关键证据道具", "tool", isXianxia ? "ancient heavy blade with energy patterns" : "realistic evidence prop for short drama close-up", "默认态"),
      threeViewPrompt: "",
      promptEn: buildDefaultAssetPrompt(isXianxia ? "核心武器" : "关键证据道具", "tool", isXianxia ? "ancient heavy blade with energy patterns" : "realistic evidence prop for short drama close-up", "默认态"),
    },
  ];
  let derivedAssets = [
    {
      assetsId: baseAssets[0].assetsId,
      id: null,
      name: isXianxia ? "战斗态" : "高压态",
      desc: isXianxia ? "与默认态差异 · 深色战斗服，衣摆被风掀起，能量光效围绕身体" : "与默认态差异 · 服装略凌乱，承压但眼神坚定，适合开场冲突",
      type: "role",
      reason: "主角默认态与样片高冲突状态差异明显，需要固定。",
      reuseScenes: "第一集开场冲突；后续反击高光",
      imagePrompt: buildDefaultAssetPrompt(leadName, "role", "same face identity, high-conflict production reference", isXianxia ? "战斗态" : "高压态"),
      threeViewPrompt: buildThreeViewPrompt(leadName, "same face identity, high-conflict production reference", isXianxia ? "战斗态" : "高压态"),
      promptEn: buildDefaultAssetPrompt(leadName, "role", "same face identity, high-conflict production reference", isXianxia ? "战斗态" : "高压态"),
    },
    {
      assetsId: baseAssets[2].assetsId,
      id: null,
      name: isXianxia ? "风暴版" : "围堵版",
      desc: isXianxia ? "与默认态差异 · 乌云压顶，冷光雷暴，地面或海面被战斗气流撕开" : "与默认态差异 · 围观人群压缩空间，主角处于低位，背景压暗",
      type: "scene",
      reason: "主场景情绪氛围影响整段视觉统一，需要作为样片参考。",
      reuseScenes: "样片开场；第一轮冲突",
      imagePrompt: buildDefaultAssetPrompt(mainScene, "scene", "cinematic high-pressure atmosphere", isXianxia ? "风暴版" : "围堵版"),
      threeViewPrompt: "",
      promptEn: buildDefaultAssetPrompt(mainScene, "scene", "cinematic high-pressure atmosphere", isXianxia ? "风暴版" : "围堵版"),
    },
  ];
  baseAssets = supplementCharacterAssets(baseAssets, script).slice(0, 30);
  derivedAssets = supplementDerivedAssets(derivedAssets, baseAssets, script).slice(0, 60);
  const assetChecklist = normalizeChecklistArray([], baseAssets, derivedAssets);
  const riskChecks = [
    { content: "多人同框、群体围堵或战斗群像", judgement: "高风险；客户审核阶段先固定主角、反派和主场景，正片多用1-3人同框。" },
    { content: "表情、眼泪、手部特写", judgement: "不单独资产化；放入分镜提示词，避免资产表膨胀。" },
    { content: "服装变化和场景天气变化", judgement: "需要作为衍生资产固定，否则样片前后容易漂移。" },
  ];
  return {
    title,
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    summary: "按AI真人短剧样片制作口径提取基础资产、衍生资产和客户审核提示词。",
    source: "local",
    note,
    executionJudgement: normalizeExecutionJudgement({}, derivedAssets, assetChecklist),
    baseAssets,
    derivedAssets,
    addDeriveAssetCalls: buildAddDeriveAssetCalls(derivedAssets),
    scenePrompts: buildTypedPrompts(assetChecklist, "场景"),
    toolPrompts: buildTypedPrompts(assetChecklist, "道具"),
    doNotExtract: normalizeDoNotExtract([]),
    assetChecklist,
    riskChecks,
  };
}

function buildDefaultAssetPrompt(name, type, visual, state = "默认状态") {
  const normalizedType = normalizeAssetType(type);
  const targetName = name || "asset";
  const anchor = visual || "clear visual anchor from the script";
  const baseNegative = "no cartoon, no anime, no illustration, no 3D render, no game concept art, no plastic skin, no deformed hands, no extra fingers, no watermark, no text, no logo";
  if (normalizedType === "scene") {
    return `Ultra photorealistic vertical 9:16 Chinese live-action short drama scene reference, asset name: ${targetName}, required state: ${state}, script-accurate location design, ${anchor}, clear spatial layers, foreground middle ground background separation, realistic practical lighting direction, cinematic but grounded atmosphere, empty scene without main characters unless the script explicitly requires crowd silhouettes, ${baseNegative}.`;
  }
  if (normalizedType === "tool") {
    return `Ultra photorealistic vertical 9:16 Chinese live-action short drama prop reference, asset name: ${targetName}, required state: ${state}, script-accurate prop design, ${anchor}, clear material texture, visible construction details, production-ready close-up composition, realistic lighting, clean background, ${baseNegative}.`;
  }
  if (normalizedType === "clip") {
    return `Ultra photorealistic vertical 9:16 Chinese live-action short drama reusable visual clip keyframe, clip name: ${targetName}, required state: ${state}, ${anchor}, one clear production keyframe, readable action geography, realistic actors or environment only when required by the script, cinematic lighting, grounded drama texture, ${baseNegative}.`;
  }
  return `Ultra photorealistic vertical 9:16 AI short drama character reference, asset name: ${targetName}, required state: ${state}, Chinese live-action casting look, ${anchor}, realistic face, consistent facial identity, clear face shape, recognizable hairstyle, believable age range and gender, natural skin texture, natural hair strands, practical wardrobe from the script, grounded short-drama styling, restrained emotion baseline, cinematic lighting, high contrast but clear facial details, full-body or three-quarter body composition, ${baseNegative}.`;
}

function buildThreeViewPrompt(name, visual, state = "默认状态") {
  return `Generate one single image containing a clean three-view character turnaround reference for ${name || "character"}, required state: ${state}. One vertical 9:16 image with three full-body views of the same realistic Chinese live-action short drama character standing side by side: front view, side view, back view. Same face identity, same height, same body proportions, same hairstyle, same clothing and props across all three views. Visual anchors: ${visual || "script-accurate face, hair, wardrobe and body type"}. Clean light gray studio background, neutral bright studio lighting, no text labels, no watermark, no cartoon, no anime, no illustration, no deformed hands, no extra fingers.`;
}

function extractLikelyName(script) {
  const dialogue = String(script || "").match(/(?:^|\n|\r)\s*([\u4e00-\u9fa5]{2,4})\s*[：:]/);
  if (dialogue?.[1] && !/第一|第二|第三|雨夜|镜头|场景|剧本/.test(dialogue[1])) return dialogue[1];
  const match = script.match(/(?:男主|主角|女主)?[“"]?([\u4e00-\u9fa5]{2,4})[”"]?(?:冷笑|抬头|醒来|走进|说道|被|在|，)/);
  return match?.[1] && !/第一|第二|第三|雨夜|镜头|场景|剧本/.test(match[1]) ? match[1] : "";
}

function extractLikelyCharacterNames(script) {
  const text = String(script || "");
  const blocked = new Set([
    "第一集", "第二集", "第三集", "第四集", "第五集", "第六集", "第七集", "第八集", "第九集", "第十集",
    "办公室", "会议室", "客厅", "医院", "学校", "教室", "公司", "酒店", "雨夜", "夜晚", "白天", "镜头", "场景",
    "雨夜街头", "街头", "现场", "门口", "车里", "窗外", "台上", "台下",
    "男人", "女人", "众人", "同学", "保镖", "医生", "护士", "记者", "员工", "老师", "警察", "司机", "服务员",
    "男主", "女主", "主角", "反派", "前女友", "未婚妻", "总裁", "家族", "父亲", "母亲", "爷爷", "奶奶", "哥哥", "妹妹",
  ]);
  const counts = new Map();
  const add = (name, weight = 1) => {
    const value = String(name || "").trim();
    if (!/^[\u4e00-\u9fa5]{2,4}$/.test(value)) return;
    if (blocked.has(value)) return;
    if (/任人|街头|雨夜|现场|门口|窗外|台上|台下|教室|公司|酒店|医院|学校|秘境/.test(value)) return;
    if (/^(一个|这个|那个|自己|所有|众人|全场|所有人|为什么|怎么会|没想到|突然|随后|此时|只见)$/.test(value)) return;
    counts.set(value, (counts.get(value) || 0) + weight);
  };

  for (const match of text.matchAll(/(?:男主|女主|主角|反派|前女友|未婚妻|总裁|少爷|小姐|师父|师尊|父亲|母亲)[：:：\s“"]*([\u4e00-\u9fa5]{2,4})/g)) {
    add(match[1], 4);
  }
  for (const match of text.matchAll(/(?:^|\n|\r|[。！？])\s*([\u4e00-\u9fa5]{2,4})\s*[：:]/g)) {
    add(match[1], 4);
  }
  for (const match of text.matchAll(/([\u4e00-\u9fa5]{2,4})(?:冷笑|怒道|说道|开口|抬头|走进|出现|冲进|站起|跪下|转身|看向|盯着|推开|打断|拦住|宣布|质问|嘲讽|羞辱|护住|抱住|掏出|拿出|签下|离开|带着|带|围堵|追杀|威胁|命令|跪在|坐在)/g)) {
    add(match[1], 2);
  }
  for (const match of text.matchAll(/(?:叫|名叫|名为|我叫|她叫|他叫)([\u4e00-\u9fa5]{2,4})/g)) {
    add(match[1], 3);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

async function buildAssetsWorkbook(assetPackage) {
  const pkg = normalizeAssetPackage(assetPackage || {}, assetPackage || {}, assetPackage?.source || "export");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "星驰AI—短剧智能体";
  workbook.created = new Date();
  buildClientAssetSheet(workbook, pkg);
  buildBaseAssetsSheet(workbook, pkg);
  buildDerivedAssetsSheet(workbook, pkg);
  buildToolCallSheet(workbook, pkg);
  buildRiskSheet(workbook, pkg);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildClientAssetSheet(workbook, pkg) {
  const ws = workbook.addWorksheet("资产清单");
  applyWorksheetDefaults(ws, 3, "A4");
  ws.columns = [
    { width: 10 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 44 },
    { width: 25 }, { width: 25 }, { width: 14 }, { width: 70 },
  ];
  ws.mergeCells("A1:I1");
  ws.mergeCells("A2:I2");
  const mainImageCount = pkg.assetChecklist.filter((item) => item.referenceImage).length;
  const supplementImageCount = pkg.assetChecklist.filter((item) => item.threeViewImage || item.supplementImage).length;
  const missingMainCount = pkg.assetChecklist.filter((item) => !item.referenceImage).length;
  const needSupplementCount = pkg.assetChecklist.filter((item) => item.category === "角色" && item.threeViewStatus !== "不需要").length;
  const missingSupplementCount = pkg.assetChecklist.filter((item) => (
    item.category === "角色" && item.threeViewStatus !== "不需要" && !(item.threeViewImage || item.supplementImage)
  )).length;
  ws.getCell("A1").value = `《${pkg.title}》AI视觉资产清单`;
  ws.getCell("A2").value = `已嵌入 ${mainImageCount} 张主参考图、${supplementImageCount} 张三视图/补充图；待补充主图：${missingMainCount ? `${missingMainCount} 张` : "无"}；待补充三视图：${needSupplementCount ? (missingSupplementCount ? `${missingSupplementCount} 张` : "无") : "无"}。`;
  ws.getRow(1).height = 31;
  ws.getRow(2).height = 27;
  styleTitleRow(ws.getRow(1));
  styleSummaryRow(ws.getRow(2));
  const header = ["资产大类", "资产编号", "角色/资产名称", "资产状态", "核心视觉锚点", "参考图", "三视图/补充图", "图片状态", "英文定妆/生图提示词 (Prompt)"];
  ws.addRow(header);
  styleHeader(ws.getRow(3));
  pkg.assetChecklist.forEach((item, index) => {
    const supplementImage = item.threeViewImage || item.supplementImage;
    const imageStatus = item.referenceImage ? "已匹配" : item.imageStatus || "待生成";
    const row = ws.addRow([
      item.category,
      item.assetNo,
      item.name,
      item.state,
      item.visualAnchor,
      item.referenceImage ? "" : "待生成",
      supplementImage ? "" : item.threeViewStatus || "不需要",
      imageStatus,
      item.imagePrompt || item.promptEn,
    ]);
    styleAssetListRow(row, index);
    if (item.referenceImage) embedImage(workbook, ws, item.referenceImage, 5, row.number - 1, 150, 165);
    if (supplementImage) embedImage(workbook, ws, supplementImage, 6, row.number - 1, 150, 165);
  });
  applySheetBorders(ws);
}

function buildBaseAssetsSheet(workbook, pkg) {
  const ws = workbook.addWorksheet("基础资产表");
  applyWorksheetDefaults(ws, 1, "A2");
  ws.columns = [{ width: 24 }, { width: 18 }, { width: 10 }, { width: 42 }, { width: 54 }, { width: 42 }];
  ws.addRow(["assetsId", "name", "type", "function", "visualAnchor", "consistencyRisk"]);
  styleHeader(ws.getRow(1));
  pkg.baseAssets.forEach((item) => {
    ws.addRow([item.assetsId, item.name, item.type, item.function, item.visualAnchor, item.consistencyRisk]);
  });
  styleBody(ws);
}

function buildDerivedAssetsSheet(workbook, pkg) {
  const ws = workbook.addWorksheet("衍生资产表");
  applyWorksheetDefaults(ws, 1, "A2");
  ws.columns = [{ width: 24 }, { width: 10 }, { width: 16 }, { width: 58 }, { width: 10 }, { width: 48 }, { width: 40 }];
  ws.addRow(["assetsId", "id", "name", "desc", "type", "reason", "reuseScenes"]);
  styleHeader(ws.getRow(1));
  pkg.derivedAssets.forEach((item) => {
    ws.addRow([item.assetsId, item.id, item.name, item.desc, item.type, item.reason, item.reuseScenes]);
  });
  styleBody(ws);
}

function buildToolCallSheet(workbook, pkg) {
  const ws = workbook.addWorksheet("add_deriveAsset");
  applyWorksheetDefaults(ws, 1, "A2");
  ws.columns = [{ width: 130 }];
  ws.addRow(["模拟工具调用"]);
  styleHeader(ws.getRow(1));
  pkg.derivedAssets.forEach((item) => {
    ws.addRow([`add_deriveAsset({assetsId: "${item.assetsId}", id: null, name: "${item.name}", desc: "${item.desc}", type: "${item.type}"})`]);
  });
  styleBody(ws);
}

function buildRiskSheet(workbook, pkg) {
  const ws = workbook.addWorksheet("风险检查");
  applyWorksheetDefaults(ws, 1, "A2");
  ws.columns = [{ width: 30 }, { width: 90 }];
  ws.addRow(["内容", "判断/修正"]);
  styleHeader(ws.getRow(1));
  pkg.riskChecks.forEach((item) => ws.addRow([item.content, item.judgement]));
  styleBody(ws);
}

const TEMPLATE_FONT = { name: "PingFang SC", charset: 134 };

function applyWorksheetDefaults(ws, ySplit = 1, topLeftCell = "A2") {
  ws.properties.defaultRowHeight = 18;
  ws.views = [{ state: "frozen", ySplit, topLeftCell, showGridLines: false }];
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };
}

function styleTitleRow(row) {
  row.font = { ...TEMPLATE_FONT, bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.eachCell((cell) => {
    cell.fill = solidFill("FF1F2933");
    cell.border = thinBorder();
  });
}

function styleSummaryRow(row) {
  row.font = { ...TEMPLATE_FONT, size: 10, color: { argb: "FF334155" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.eachCell((cell) => {
    cell.fill = solidFill("FFE9EEF3");
    cell.border = thinBorder();
  });
}

function styleHeader(row) {
  row.font = { ...TEMPLATE_FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.eachCell((cell) => {
    cell.fill = solidFill("FF2F5D62");
    cell.border = thinBorder();
  });
}

function styleBody(ws) {
  ws.eachRow((row, index) => {
    if (index === 1) return;
    row.height = 52;
    row.font = { ...TEMPLATE_FONT, size: 9, color: { argb: "FF374151" } };
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    if (index % 2 === 0) row.eachCell((cell) => { cell.fill = solidFill("FFF8FAFC"); });
  });
  applySheetBorders(ws);
}

function styleAssetListRow(row, index) {
  row.height = 178;
  row.font = { ...TEMPLATE_FONT, size: 9, color: { argb: "FF374151" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.eachCell((cell, colNumber) => {
    cell.border = thinBorder();
    cell.alignment = {
      vertical: "middle",
      horizontal: [5, 9].includes(colNumber) ? "left" : "center",
      wrapText: true,
    };
    if (index % 2 === 1) cell.fill = solidFill("FFF8FAFC");
    if ([6, 7].includes(colNumber)) {
      cell.fill = solidFill("FFFFF4D6");
      cell.font = { ...TEMPLATE_FONT, bold: true, size: 9, color: { argb: "FF9A6700" } };
    }
    if (colNumber === 8 && row.getCell(8).value === "已匹配") {
      cell.fill = solidFill("FFE7F4EA");
      cell.font = { ...TEMPLATE_FONT, bold: true, size: 9, color: { argb: "FF1E7E34" } };
    }
  });
}

function applySheetBorders(ws) {
  ws.eachRow((row) => row.eachCell((cell) => { cell.border = thinBorder(); }));
}

function embedImage(workbook, ws, dataUrl, col, row, width, height) {
  const match = String(dataUrl).match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) return;
  const extension = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const imageId = workbook.addImage({ base64: dataUrl, extension });
  ws.addImage(imageId, { tl: { col, row }, ext: { width, height } });
}

function thinBorder() {
  return {
    top: { style: "thin", color: { argb: "FFD0D7DE" } },
    left: { style: "thin", color: { argb: "FFD0D7DE" } },
    bottom: { style: "thin", color: { argb: "FFD0D7DE" } },
    right: { style: "thin", color: { argb: "FFD0D7DE" } },
  };
}

function solidFill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function sanitizeFilename(value) {
  return String(value || "短剧").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "短剧";
}

function slug(value) {
  return String(value || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "asset";
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
