import { ChangeEvent, useEffect, useMemo, useState } from "react";
import mammoth from "mammoth";

type View = "diagnose" | "report" | "assets" | "prompts";

type FormState = {
  title: string;
  scriptText: string;
  fileName: string;
};

type DiagnosisReport = {
  title: string;
  generatedAt: string;
  score: number;
  marketFit: number;
  retention: number;
  characterValue: number;
  roi: string;
  payback: string;
  risk: string;
  audience: Array<{ name: string; fit: number; note: string }>;
  characters: Array<{ name: string; tag: string; value: string; note: string }>;
  risks: Array<{ title: string; level: string; note: string; fix: string }>;
  suggestions: Array<{ title: string; content: string }>;
  commercialHooks: string[];
  basicJudgement?: {
    type: string;
    audience: string;
    commercialFit: string;
    aiVideoFit: string;
    payPotential: string;
    oneLine: string;
  };
  storyCore?: { summary: string; appeal: string[] };
  hiddenLine?: { arc: string; growth: string[] };
  goldenStructure?: Array<{ episodes: string; currentFunction: string; qualified: string; suggestion: string }>;
  payPoints?: Array<{ name: string; episode: string; type: string; scene: string; reason: string }>;
  emotionCurve?: { strong: string[]; weak: string[]; frontload: string[]; curve: string };
  infoGaps?: Array<{ gap: string; current: string; suggestion: string }>;
  aiProductionRisks?: Array<{ title: string; level: string; note: string; fix: string }>;
  revisionSuggestions?: Array<{ title: string; content: string }>;
  sampleEpisodes?: Array<{ episode: string; reason: string }>;
  source?: string;
  note?: string;
};

type BaseAsset = {
  assetsId: string;
  assetCode?: string;
  name: string;
  type: "role" | "scene" | "tool" | "clip";
  function: string;
  visualAnchor: string;
  consistencyRisk: string;
  defaultState: string;
  imagePrompt?: string;
  threeViewPrompt?: string;
  promptEn: string;
};

type DerivedAsset = {
  assetsId: string;
  parentAssetsId?: string;
  assetCode?: string;
  id: number | null;
  name: string;
  desc: string;
  type: "role" | "scene" | "tool" | "clip";
  reason: string;
  reuseScenes: string;
  imagePrompt?: string;
  threeViewPrompt?: string;
  promptEn: string;
};

type AssetChecklistItem = {
  category: string;
  assetNo: string;
  name: string;
  state: string;
  visualAnchor: string;
  imageStatus: string;
  threeViewStatus?: string;
  imagePrompt?: string;
  threeViewPrompt?: string;
  promptEn: string;
  sourceAssetsId: string;
  referenceImage?: string;
  imageModel?: string;
};

type RiskCheck = {
  content: string;
  judgement: string;
};

type AssetPackage = {
  title: string;
  generatedAt: string;
  summary: string;
  source?: string;
  note?: string;
  executionJudgement?: {
    needDerivedAssets: boolean;
    derivedAssetCount: number;
    mainReason: string;
    riskNote: string;
  };
  baseAssets: BaseAsset[];
  derivedAssets: DerivedAsset[];
  addDeriveAssetCalls?: Array<{ assetsId: string; id: number | null; name: string; desc: string; type: string }>;
  scenePrompts?: Array<{ assetCode: string; name: string; state: string; prompt: string }>;
  toolPrompts?: Array<{ assetCode: string; name: string; state: string; prompt: string }>;
  doNotExtract?: Array<{ content: string; reason: string }>;
  assetChecklist: AssetChecklistItem[];
  riskChecks: RiskCheck[];
};

type PromptMode = "auto" | "text" | "first_frame" | "first_last_frame" | "split";
type PromptPlatform = "universal" | "kling" | "seedance" | "runway";

type PromptShot = {
  shotId: string;
  sequence: number;
  scene: string;
  duration: string;
  shotSize: string;
  cameraMove: string;
  visualGoal: string;
  continuity: string;
  orientation: string;
  action: string;
  finalState: string;
  emotion: string;
  lighting: string;
  dialogue: string;
  recommendedMode: PromptMode;
  riskScore: number;
  riskReasons: string[];
  videoPrompt: string;
  firstFramePrompt: string;
  lastFramePrompt: string;
  transitionPrompt: string;
  negativePrompt: string;
  splitSuggestion: string;
};

type PromptPackage = {
  title: string;
  generatedAt: string;
  summary: string;
  platform: PromptPlatform;
  source?: string;
  note?: string;
  globalRules: string[];
  shots: PromptShot[];
};

type ImageStyle = "real_short_drama" | "cinematic_real" | "ancient_real" | "anime_concept";
type ImageModelChoice = "auto" | "gemini-3.1-flash-image-preview" | "gemini-2.5-flash-image";

const initialForm: FormState = {
  title: "",
  scriptText: "",
  fileName: "",
};

const sampleScript = `# 至暗时刻

雨夜，女主苏婉在废弃剧院醒来，手边是一封写着自己名字的旧信。她发现三年前失踪的妹妹可能还活着，而当年负责此案的陈队长正是她现在的合作对象。

第一场：苏婉被陌生电话引到剧院，电话里传来妹妹的声音。
第二场：陈队长阻止苏婉继续调查，两人爆发争执。
第三场：反派林夕出现在慈善晚宴，故意透露三年前案件的关键证物。
第四场：苏婉发现母亲当年隐瞒了真相，决定假装放弃调查，暗中接近林夕。
结尾：妹妹的视频突然出现在大屏幕上，她说：“姐姐，别相信你身边的人。”`;

const progressSteps = ["读取剧本", "提取商业卖点", "评估留存与付费点", "生成诊断报告"];
const assetProgressSteps = ["读取剧本", "提取基础资产", "判断衍生状态", "生成客户资产表"];
const promptProgressSteps = ["读取剧本", "拆分镜头", "判断生成模式", "生成提示词"];
const generationLimit = 2;
const generationCountKey = "xingchi-ai-diagnosis-count";
const generationUnlockKey = "xingchi-ai-diagnosis-unlocked";
const visitorIdKey = "xingchi-ai-visitor-id";
const diagnoseApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/diagnose"
    : "/api/diagnose";
const assetsApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/assets"
    : "/api/assets";
const assetsExportApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/assets/export"
    : "/api/assets/export";
const assetsImageApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/assets/image"
    : "/api/assets/image";
const promptsApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/prompts"
    : "/api/prompts";
const redeemApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/redeem"
    : "/api/redeem";
const visitApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/track-visit"
    : "/api/track-visit";

function createMockReport(form: FormState): DiagnosisReport {
  const script = form.scriptText.trim();
  const textLength = script.length;
  const densityBoost = Math.min(10, Math.floor(textLength / 450));
  const hasSuspense = /失踪|秘密|真相|反派|调查|复仇|身份|妹妹|死亡|背叛|重生|离婚|认亲|证据|威胁/.test(script);
  const hasHook = /第[一二三四五六七八九十0-9]+集|第一场|结尾|开场|反转|卡点/.test(script);
  const score = Math.min(94, 74 + densityBoost + (hasSuspense ? 7 : 0) + (hasHook ? 4 : 0));

  return {
    title: form.title || inferTitle(form) || "未命名剧本",
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    score,
    marketFit: Math.min(96, score + 3),
    retention: Math.min(95, score + (hasSuspense ? 2 : -5)),
    characterValue: Math.min(92, score - 1),
    roi: score >= 86 ? "谨慎看好" : score >= 80 ? "可推进试拍" : "需复核",
    payback: "需结合预算复核",
    risk: score >= 86 ? "低" : score >= 80 ? "中" : "偏高",
    audience: [
      { name: "核心付费用户", fit: Math.min(96, score + 5), note: "强冲突、秘密差和角色受压越早出现，越容易形成追更。" },
      { name: "大众短剧用户", fit: Math.min(88, score - 3), note: "题材理解成本可控，但前三分钟需要更直接的危机现场。" },
      { name: "泛娱乐用户", fit: Math.max(45, score - 25), note: "需要用更清晰的情绪钩子降低进入门槛。" },
    ],
    characters: [
      { name: "主角", tag: "留存核心", value: "中高", note: "需要同时具备受压、反击和阶段性目标，观众才会持续站队。" },
      { name: "反派/阻碍者", tag: "话题来源", value: "中", note: "建议强化其可被识别的欲望、压迫动作和反差记忆点。" },
      { name: "关键关系", tag: "付费拉扯", value: "中高", note: "亲密关系中的欺骗、保护或背叛适合放在付费卡点前后。" },
    ],
    risks: [
      { title: "开场钩子不够前置", level: score >= 86 ? "中" : "高", note: "如果前3分钟没有危机、秘密或强选择，投放留存会受影响。", fix: "开场直接进入冲突现场，先抛出结果，再回收原因。" },
      { title: "付费节点需要显性化", level: "中", note: "当前具备悬念基础，但需要把真相、关系反转和身份揭露安排到明确节点。", fix: "按10%、30%、50%、70%设置假兑现和反转打断。" },
      { title: "承制成本需提前收口", level: "低", note: "多场景、多人物和高频动作戏会抬高试错成本。", fix: "优先锁定核心人物、主场景和关键道具，减少一次性资产开发。" },
    ],
    suggestions: [
      { title: "前三分钟", content: "把主角困境、反派压迫和第一个秘密集中到开场，避免慢铺世界观。" },
      { title: "人物卖点", content: "为主角设计一个可视化记忆点，例如职业技能、随身道具或固定反击动作。" },
      { title: "承制方案", content: "先做核心场景和关键证物的视觉方案，用低成本样片验证客户方向。" },
    ],
    commercialHooks: ["三分钟强危机", "身份差或真相差", "亲密关系背叛", "真相即将公开却被打断"],
    basicJudgement: {
      type: "自动识别题材，需结合完整剧本复核",
      audience: "核心短剧付费用户，偏好强冲突、强反转和低理解成本",
      commercialFit: `${score >= 86 ? 8 : 6}/10，${score >= 86 ? "具备明确商业钩子" : "需要补强类型卖点"}`,
      aiVideoFit: "6/10，需要避开复杂多人动作和高难度特效",
      payPotential: `${score >= 86 ? 8 : 6}/10，${score >= 86 ? "具备卡点开发空间" : "付费钩子还需显性化"}`,
      oneLine: score >= 86 ? "故事有商业钩子，但需要把前三分钟危机和第一个付费点做得更尖锐。" : "当前文本可做初步判断，但故事核、主角目标和付费点还需要补强。",
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
    source: "local",
  };
}

function inferTitle(form: FormState) {
  if (form.title.trim()) return form.title.trim();
  if (form.fileName) return form.fileName.replace(/\.[^.]+$/, "");
  const firstHeading = form.scriptText.match(/^#\s*(.+)$/m)?.[1];
  return firstHeading?.trim() || "";
}

function getVisitorId() {
  const existing = window.localStorage.getItem(visitorIdKey);
  if (existing) return existing;
  const next = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(visitorIdKey, next);
  return next;
}

function createLocalAssetPackage(form: FormState): AssetPackage {
  const title = inferTitle(form) || "未命名剧本";
  const script = form.scriptText;
  const lead = script.match(/([\u4e00-\u9fa5]{2,4})(?:冷笑|抬头|醒来|走进|被|在)/)?.[1] || "主角";
  const xianxia = /龙|仙|魔|宗门|灵力|刀气|秘境|战袍/.test(script);
  const baseAssets: BaseAsset[] = [
    {
      assetsId: "role_main_character",
      name: lead,
      type: "role",
      function: "承担主线代入、受压和反击。",
      visualAnchor: "中国真人短剧主角 / 五官清晰 / 眼神坚定 / 主场服装稳定",
      consistencyRisk: "出镜频率高，脸、发型和服装必须优先固定。",
      defaultState: xianxia ? "现代常服" : "主场常服",
      promptEn: `Ultra photorealistic vertical 9:16 AI short drama character reference, Chinese protagonist ${lead}, realistic face, consistent identity, main costume, cinematic lighting, no cartoon, no anime, no watermark, no text.`,
    },
    {
      assetsId: "scene_main_conflict",
      name: xianxia ? "关键战场" : "核心冲突场",
      type: "scene",
      function: "承载样片主冲突和客户视觉审核。",
      visualAnchor: xianxia ? "雷暴 / 冷光 / 战斗压迫 / 强对比" : "现代中国空间 / 围观压力 / 真实光线 / 冲突动线",
      consistencyRisk: "空间层次和人物站位需要固定，避免镜头切换后漂移。",
      defaultState: "主场版",
      promptEn: `Ultra photorealistic vertical 9:16 AI short drama scene reference, ${xianxia ? "storm fantasy battlefield" : "modern Chinese conflict location"}, cinematic lighting, clean composition, no watermark, no text.`,
    },
    {
      assetsId: "tool_key_prop",
      name: xianxia ? "核心武器" : "关键证据道具",
      type: "tool",
      function: "推动反转或战力展示。",
      visualAnchor: xianxia ? "长刀 / 能量纹路 / 高光状态" : "文件 / 戒指 / 录音 / 可特写",
      consistencyRisk: "道具形态容易漂移，需要固定大小、材质和特写方式。",
      defaultState: "默认态",
      promptEn: `Ultra photorealistic vertical 9:16 AI short drama prop reference, ${xianxia ? "ancient heavy blade with glowing energy patterns" : "realistic evidence prop close-up"}, cinematic texture, no watermark, no text.`,
    },
  ];
  const derivedAssets: DerivedAsset[] = [
    {
      assetsId: "role_main_character",
      id: null,
      name: xianxia ? "战斗态" : "高压态",
      desc: xianxia ? "与默认态差异 · 深色战斗服，衣摆被风掀起，能量光效围绕身体" : "与默认态差异 · 服装略凌乱，承压但眼神坚定",
      type: "role",
      reason: "主角默认态与样片高冲突状态差异明显，需要固定。",
      reuseScenes: "第一集开场冲突；后续反击高光",
      promptEn: `Ultra photorealistic vertical 9:16 AI short drama character reference, same face identity, ${xianxia ? "battle costume, energy aura" : "high pressure emotional state, slightly messy costume"}, cinematic lighting, no watermark, no text.`,
    },
  ];
  const assetChecklist: AssetChecklistItem[] = [
    ...baseAssets.map((asset, index) => ({
      category: asset.type === "scene" ? "场景" : asset.type === "tool" ? "道具" : "角色",
      assetNo: `${asset.type === "scene" ? "S" : asset.type === "tool" ? "T" : "R"}_${String(index + 1).padStart(2, "0")}`,
      name: asset.name,
      state: `${asset.defaultState} (默认)`,
      visualAnchor: asset.visualAnchor,
      imageStatus: "提示词已生成",
      promptEn: asset.promptEn,
      sourceAssetsId: asset.assetsId,
    })),
    {
      category: "角色",
      assetNo: "R_01_D1",
      name: lead,
      state: `${derivedAssets[0].name} (衍生)`,
      visualAnchor: derivedAssets[0].desc.replace("与默认态差异 · ", ""),
      imageStatus: "提示词已生成",
      promptEn: derivedAssets[0].promptEn,
      sourceAssetsId: derivedAssets[0].assetsId,
    },
  ];
  return {
    title,
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    summary: "本地规则已生成基础资产和衍生资产，建议补充完整第一集后复核。",
    source: "local",
    note: "Gemini 接口暂时不可用，当前为本地规则生成的资产清单。",
    baseAssets,
    derivedAssets,
    assetChecklist,
    riskChecks: [
      { content: "表情、眼泪、手部特写", judgement: "不单独资产化，放入分镜提示词。" },
      { content: "多人同框或复杂动作", judgement: "高风险，样片阶段控制在1-3个主体。" },
    ],
  };
}

function createLocalPromptPackage(form: FormState, platform: PromptPlatform = "universal"): PromptPackage {
  const title = inferTitle(form) || "未命名剧本";
  const script = form.scriptText.trim();
  const sceneParts = script
    .split(/\n(?=第[一二三四五六七八九十0-9]+[场幕集]|场景|△|- )/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  const parts = sceneParts.length ? sceneParts : [script.slice(0, 320) || "主角进入核心冲突场。"];
  const shots = parts.flatMap((part, index) => {
    const lines = part.match(/「([^」]+)」|“([^”]+)”|"([^"]+)"/g)?.slice(0, 1).join(" ") || "无台词";
    const risky = /打|推|抓|抱|摔|跪|倒|跑|追|刺|爆|雷|法术|飞|撞|群|围攻|血|光门|变身/.test(part);
    const riskScore = risky ? 72 : 28;
    const recommendedMode: PromptMode = riskScore >= 80 ? "split" : riskScore >= 60 ? "first_last_frame" : riskScore >= 35 ? "first_frame" : "text";
    const scene = part.match(/(?:在|到|进入|来到)([\u4e00-\u9fa5]{2,10})(?:，|。|里|中)/)?.[1] || (index === 0 ? "核心冲突场" : `场景${index + 1}`);
    const visualGoal = part.replace(/\s+/g, " ").slice(0, 90);
    return [{
      shotId: `SHOT_${String(index + 1).padStart(2, "0")}`,
      sequence: index + 1,
      scene,
      duration: lines === "无台词" ? "4秒" : "5秒",
      shotSize: index === 0 ? "中景" : "中近景",
      cameraMove: risky ? "轻微推近，动作幅度克制" : "静止或轻微缓推",
      visualGoal,
      continuity: index === 0 ? "开篇镜头" : "承接上一镜动作终态，角色位置不跳变",
      orientation: "主角固定画面左侧，3/4正面朝右；对手或目标固定画面右侧，3/4正面朝左",
      action: risky ? "角色先停顿蓄势，再完成一个明确动作，动作结束后自然收住" : "角色保持当前位置，完成一次可见表情或视线变化",
      finalState: risky ? "动作完成后双方距离拉开，站位仍保持左右关系" : "角色视线落在对方或关键道具上，情绪停住",
      emotion: risky ? "压迫、反击临界点" : "克制、悬疑、紧张",
      lighting: "中国真人短剧质感，真实环境光，面部清楚，背景轻微虚化",
      dialogue: lines,
      recommendedMode,
      riskScore,
      riskReasons: risky ? ["存在动作或特效风险", "需要锁定首尾状态"] : ["动作简单", "适合全局文本生成"],
      videoPrompt: `真人短剧质感，${scene}，${index === 0 ? "开篇镜头" : "承接上一镜"}。${visualGoal}。镜头为${index === 0 ? "中景" : "中近景"}，${risky ? "轻微推近，动作幅度克制" : "静止或轻微缓推"}。主角固定画面左侧，3/4正面朝右，对手或目标固定画面右侧，3/4正面朝左。动作：${risky ? "先停顿蓄势，再完成一个明确动作，最终自然收住" : "保持当前位置，完成一次可见视线或表情变化"}。真实光影，面部清楚，背景虚化。`,
      firstFramePrompt: `竖屏9:16真人短剧首帧图，${scene}，${visualGoal}。主角位于画面左侧，3/4正面朝右，身体处于动作开始前的稳定状态。真实中国短剧质感，面部清楚，无文字无水印。`,
      lastFramePrompt: `竖屏9:16真人短剧尾帧图，${scene}，承接同一空间和同一人物身份。动作已经完成，角色停在明确终态，左右站位不变。真实光影，面部清楚，无文字无水印。`,
      transitionPrompt: `以首帧为起点、尾帧为终点，角色只完成一个核心动作，保持同一人物身份、同一服装、同一空间和左右站位，不跳轴，不突然换脸。`,
      negativePrompt: "不要动漫，不要插画，不要换脸，不要左右站位互换，不要多人融合，不要多余手臂，不要手指畸形，不要人物穿模，不要文字水印，不要过暗看不清脸。",
      splitSuggestion: risky ? "建议拆为：起势镜头 / 动作结果镜头 / 对方反应镜头。" : "无需拆镜，可直接生成。",
    }];
  });
  return {
    title,
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    summary: "本地规则已按镜头风险生成可复制视频提示词；建议用 Gemini 版复核细节。",
    platform,
    source: "local",
    note: "Gemini 暂时不可用，当前为本地规则生成的第一版提示词。",
    globalRules: ["同一场戏保持180度视轴", "每镜只做一个核心动作", "复杂打斗和特效优先首尾帧或拆镜", "人物脸、服装、站位不得漂移"],
    shots,
  };
}

function updateAssetChecklistItem(assetPackage: AssetPackage, index: number, patch: Partial<AssetChecklistItem>): AssetPackage {
  return {
    ...assetPackage,
    assetChecklist: assetPackage.assetChecklist.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )),
  };
}

function App() {
  const [view, setView] = useState<View>("diagnose");
  const [form, setForm] = useState<FormState>(initialForm);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [assetPackage, setAssetPackage] = useState<AssetPackage | null>(null);
  const [promptPackage, setPromptPackage] = useState<PromptPackage | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingAssets, setIsGeneratingAssets] = useState(false);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isExportingAssets, setIsExportingAssets] = useState(false);
  const [generatingAssetKey, setGeneratingAssetKey] = useState("");
  const [imageStyle, setImageStyle] = useState<ImageStyle>("real_short_drama");
  const [imageModelChoice, setImageModelChoice] = useState<ImageModelChoice>("auto");
  const [promptPlatform, setPromptPlatform] = useState<PromptPlatform>("kling");
  const [promptModeOverrides, setPromptModeOverrides] = useState<Record<string, PromptMode>>({});
  const [progress, setProgress] = useState(0);
  const [assetProgress, setAssetProgress] = useState(0);
  const [promptProgress, setPromptProgress] = useState(0);
  const [fileHint, setFileHint] = useState("");
  const [donateOpen, setDonateOpen] = useState(false);
  const [comingSoon, setComingSoon] = useState("");

  useEffect(() => {
    if (!isAnalyzing) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setProgress((prev) => Math.min(92, Math.max(prev, Math.round(elapsed / 90))));
    }, 280);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  useEffect(() => {
    if (!isGeneratingAssets) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setAssetProgress((prev) => Math.min(92, Math.max(prev, Math.round(elapsed / 120))));
    }, 320);
    return () => window.clearInterval(timer);
  }, [isGeneratingAssets]);

  useEffect(() => {
    if (!isGeneratingPrompts) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setPromptProgress((prev) => Math.min(92, Math.max(prev, Math.round(elapsed / 110))));
    }, 300);
    return () => window.clearInterval(timer);
  }, [isGeneratingPrompts]);

  useEffect(() => {
    const visitorId = getVisitorId();
    fetch(visitApiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId }),
    }).catch(() => undefined);
  }, []);

  const activeStep = useMemo(() => {
    if (progress < 25) return 0;
    if (progress < 52) return 1;
    if (progress < 78) return 2;
    return 3;
  }, [progress]);

  const activeAssetStep = useMemo(() => {
    if (assetProgress < 25) return 0;
    if (assetProgress < 52) return 1;
    if (assetProgress < 78) return 2;
    return 3;
  }, [assetProgress]);

  const activePromptStep = useMemo(() => {
    if (promptProgress < 25) return 0;
    if (promptProgress < 52) return 1;
    if (promptProgress < 78) return 2;
    return 3;
  }, [promptProgress]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const title = file.name.replace(/\.[^.]+$/, "");
    setFileHint("正在读取剧本文件...");
    setForm((prev) => ({ ...prev, fileName: file.name, title: prev.title || title }));

    try {
      if (file.name.endsWith(".docx")) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setForm((prev) => ({ ...prev, scriptText: result.value.trim() }));
        setFileHint(result.value.trim() ? "Word 剧本已读取，可以开始诊断。" : "文件已上传，但未识别到正文，请粘贴剧本文本。");
        return;
      }

      if (file.type.startsWith("text/") || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
        const text = await file.text();
        setForm((prev) => ({ ...prev, scriptText: text }));
        setFileHint("剧本文本已读取，可以开始诊断。");
        return;
      }

      setFileHint("暂不支持直接解析该格式，请把剧本正文粘贴到下方文本框。");
    } catch {
      setFileHint("文件读取失败，请把剧本正文粘贴到下方文本框。");
    }
  };

  const runDiagnosis = async () => {
    const scriptText = form.scriptText.trim();
    if (!scriptText) return;
    const usedCount = Number(window.localStorage.getItem(generationCountKey) || "0");
    const isUnlocked = window.localStorage.getItem(generationUnlockKey) === "true";
    if (!isUnlocked && usedCount >= generationLimit) {
      setDonateOpen(true);
      return;
    }
    setIsAnalyzing(true);
    setProgress(7);
    try {
      const payload = {
        title: inferTitle(form),
        audience: "自动识别",
        budget: "自动评估",
        genre: "自动识别",
        episodes: "自动识别",
        scriptText,
      };
      const response = await fetch(diagnoseApiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`诊断接口返回 ${response.status}`);
      const nextReport = await response.json();
      setProgress(100);
      window.setTimeout(() => {
        setReport(nextReport);
        if (!isUnlocked) {
          window.localStorage.setItem(generationCountKey, String(usedCount + 1));
        }
        setView("report");
        setIsAnalyzing(false);
      }, 360);
    } catch (error) {
      console.warn("API diagnosis failed, using local fallback.", error);
      const nextReport = createMockReport({ ...form, scriptText });
      setProgress(100);
      window.setTimeout(() => {
        setReport({
          ...nextReport,
          note: "Gemini 接口暂时不可用，当前为本地规则生成的初步诊断。",
        });
        if (!isUnlocked) {
          window.localStorage.setItem(generationCountKey, String(usedCount + 1));
        }
        setView("report");
        setIsAnalyzing(false);
      }, 360);
    }
  };

  const runAssetGeneration = async () => {
    const scriptText = form.scriptText.trim();
    if (!scriptText) return;
    const usedCount = Number(window.localStorage.getItem(generationCountKey) || "0");
    const isUnlocked = window.localStorage.getItem(generationUnlockKey) === "true";
    if (!isUnlocked && usedCount >= generationLimit) {
      setDonateOpen(true);
      return;
    }
    setIsGeneratingAssets(true);
    setAssetProgress(8);
    try {
      const response = await fetch(assetsApiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: inferTitle(form),
          scriptText,
          generateImages: false,
        }),
      });
      if (!response.ok) throw new Error(`资产接口返回 ${response.status}`);
      const nextPackage = await response.json();
      setAssetProgress(100);
      window.setTimeout(() => {
        setAssetPackage(nextPackage);
        if (!isUnlocked) {
          window.localStorage.setItem(generationCountKey, String(usedCount + 1));
        }
        setIsGeneratingAssets(false);
      }, 360);
    } catch (error) {
      console.warn("Asset generation failed.", error);
      setAssetProgress(100);
      window.setTimeout(() => {
        setAssetPackage(createLocalAssetPackage(form));
        if (!isUnlocked) {
          window.localStorage.setItem(generationCountKey, String(usedCount + 1));
        }
        setIsGeneratingAssets(false);
      }, 360);
    }
  };

  const runPromptGeneration = async () => {
    const scriptText = form.scriptText.trim();
    if (!scriptText) return;
    const usedCount = Number(window.localStorage.getItem(generationCountKey) || "0");
    const isUnlocked = window.localStorage.getItem(generationUnlockKey) === "true";
    if (!isUnlocked && usedCount >= generationLimit) {
      setDonateOpen(true);
      return;
    }
    setIsGeneratingPrompts(true);
    setPromptProgress(8);
    setPromptModeOverrides({});
    try {
      const response = await fetch(promptsApiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: inferTitle(form),
          scriptText,
          platform: promptPlatform,
        }),
      });
      if (!response.ok) throw new Error(`提示词接口返回 ${response.status}`);
      const nextPackage = await response.json();
      setPromptProgress(100);
      window.setTimeout(() => {
        setPromptPackage(nextPackage);
        if (!isUnlocked) {
          window.localStorage.setItem(generationCountKey, String(usedCount + 1));
        }
        setIsGeneratingPrompts(false);
      }, 360);
    } catch (error) {
      console.warn("Prompt generation failed.", error);
      setPromptProgress(100);
      window.setTimeout(() => {
        setPromptPackage(createLocalPromptPackage(form, promptPlatform));
        if (!isUnlocked) {
          window.localStorage.setItem(generationCountKey, String(usedCount + 1));
        }
        setIsGeneratingPrompts(false);
      }, 360);
    }
  };

  const copyText = async (text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  };

  const generateAssetImage = async (item: AssetChecklistItem, index: number) => {
    if (!assetPackage) return;
    const key = `${item.assetNo}-${item.state}-${index}`;
    setGeneratingAssetKey(key);
    setAssetPackage((current) => current ? updateAssetChecklistItem(current, index, {
      imageStatus: "生成中",
    }) : current);
    try {
      const response = await fetch(assetsImageApiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetNo: item.assetNo,
          name: item.name,
          prompt: item.imagePrompt || item.promptEn || item.visualAnchor,
          imageStyle,
          imageModel: imageModelChoice,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.referenceImage) {
        throw new Error(result.error || `生图接口返回 ${response.status}`);
      }
      setAssetPackage((current) => current ? updateAssetChecklistItem(current, index, {
        referenceImage: result.referenceImage,
        imageModel: result.imageModel || "",
        imageStatus: result.imageStatus || "已生成",
      }) : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生图失败";
      setAssetPackage((current) => current ? updateAssetChecklistItem(current, index, {
        imageStatus: `生成失败：${message.slice(0, 42)}`,
      }) : current);
    } finally {
      setGeneratingAssetKey("");
    }
  };

  const exportAssetsExcel = async () => {
    if (!assetPackage) return;
    setIsExportingAssets(true);
    try {
      const response = await fetch(assetsExportApiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetPackage }),
      });
      if (!response.ok) throw new Error(`导出接口返回 ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${assetPackage.title || "短剧"}_AI视觉资产清单_客户版.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出失败";
      window.alert(`Excel 导出失败：${message}`);
    } finally {
      setIsExportingAssets(false);
    }
  };

  const redeemAccess = async (code: string) => {
    const response = await fetch(redeemApiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "兑换码无效，请检查后重新输入。");
    }
    window.localStorage.setItem(generationUnlockKey, "true");
    window.localStorage.removeItem(generationCountKey);
    setDonateOpen(false);
  };

  const exportReport = () => {
    if (!report) return;
    window.print();
  };

  return (
    <div className="app-shell compact-shell">
      <TopBar
        view={view}
        report={report}
        onReport={() => setView("report")}
        onNew={() => setView("diagnose")}
        onAssets={() => setView("assets")}
        onPrompts={() => setView("prompts")}
        onComingSoon={setComingSoon}
      />
      <main className="main compact-main">
        {view === "diagnose" && (
          <Diagnose
            form={form}
            setForm={setForm}
            onFile={handleFile}
            onRun={runDiagnosis}
            isAnalyzing={isAnalyzing}
            progress={progress}
            activeStep={activeStep}
            fileHint={fileHint}
          />
        )}
        {view === "report" && <Report report={report} onStart={() => setView("diagnose")} onExport={exportReport} />}
        {view === "assets" && (
          <AssetExpert
            form={form}
            setForm={setForm}
            onFile={handleFile}
            onRun={runAssetGeneration}
            onExport={exportAssetsExcel}
            onGenerateImage={generateAssetImage}
            imageStyle={imageStyle}
            setImageStyle={setImageStyle}
            imageModelChoice={imageModelChoice}
            setImageModelChoice={setImageModelChoice}
            isGenerating={isGeneratingAssets}
            isExporting={isExportingAssets}
            generatingAssetKey={generatingAssetKey}
            progress={assetProgress}
            activeStep={activeAssetStep}
            fileHint={fileHint}
            assetPackage={assetPackage}
          />
        )}
        {view === "prompts" && (
          <PromptExpert
            form={form}
            setForm={setForm}
            onFile={handleFile}
            onRun={runPromptGeneration}
            isGenerating={isGeneratingPrompts}
            progress={promptProgress}
            activeStep={activePromptStep}
            fileHint={fileHint}
            promptPackage={promptPackage}
            platform={promptPlatform}
            setPlatform={setPromptPlatform}
            modeOverrides={promptModeOverrides}
            setModeOverrides={setPromptModeOverrides}
            onCopy={copyText}
          />
        )}
      </main>
      {donateOpen && <DonateModal onClose={() => setDonateOpen(false)} onRedeem={redeemAccess} />}
      {comingSoon && <ComingSoonModal title={comingSoon} onClose={() => setComingSoon("")} />}
    </div>
  );
}

function TopBar({
  view,
  report,
  onReport,
  onNew,
  onAssets,
  onPrompts,
  onComingSoon,
}: {
  view: View;
  report: DiagnosisReport | null;
  onReport: () => void;
  onNew: () => void;
  onAssets: () => void;
  onPrompts: () => void;
  onComingSoon: (title: string) => void;
}) {
  return (
    <header className="topbar compact-topbar">
      <button className="brand-button" onClick={onNew}>星驰AI—短剧智能体</button>
      <nav className="topnav compact-nav">
        <button className={`nav-tool ${view === "diagnose" || view === "report" ? "active" : ""}`} onClick={onNew}>剧本商业诊断</button>
        <button className={`nav-tool ${view === "assets" ? "active" : ""}`} onClick={onAssets}>短剧人物资产专家</button>
        <button className={`nav-tool ${view === "prompts" ? "active" : ""}`} onClick={onPrompts}>A+级剧本提示词专家</button>
      </nav>
      <div className="head-actions">
        <button className="button secondary" onClick={onReport} disabled={!report}>查看报告</button>
        <button className="button primary" onClick={onNew}>新诊断</button>
      </div>
    </header>
  );
}

function Diagnose({
  form,
  setForm,
  onFile,
  onRun,
  isAnalyzing,
  progress,
  activeStep,
  fileHint,
}: {
  form: FormState;
  setForm: (fn: (prev: FormState) => FormState) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onRun: () => void;
  isAnalyzing: boolean;
  progress: number;
  activeStep: number;
  fileHint: string;
}) {
  const canRun = Boolean(form.scriptText.trim());

  return (
    <section className="diagnose-page">
      <div className="diagnose-hero">
        <p className="eyebrow">剧本方商业评估入口</p>
        <h1>上传剧本，先看它值不值得做</h1>
        <p className="subhead">基于短剧商业诊断逻辑，快速判断故事核、前三分钟留存、付费卡点、人设价值和承制风险。</p>
      </div>
      <ToolCards />

      <section className="diagnose-card">
        <div className="upload-zone compact-upload">
          <input id="file" type="file" accept=".txt,.md,.docx" onChange={onFile} />
          <label htmlFor="file">
            <strong>拖拽或选择剧本文件</strong>
            <span>支持 .docx、.txt、.md。也可以直接粘贴剧本正文、故事梗概或前几集内容。</span>
            <em>{form.fileName || "选择本地剧本"}</em>
          </label>
        </div>

        <div className="diagnose-summary">
          <h2>诊断逻辑</h2>
          <p>故事核、开篇留存、单线推进、付费卡点、人设商业价值、承制可行性。</p>
          <div className="summary-list">
            <span>不需要填写目标受众</span>
            <span>不需要填写预算集数</span>
            <span>先给可沟通的商业判断</span>
          </div>
        </div>

        <div className="script-input compact-script">
          <div>
            <h2>剧本文本</h2>
            <button className="text-button" onClick={() => setForm((prev) => ({ ...prev, title: "至暗时刻", scriptText: sampleScript }))}>
              填入示例
            </button>
          </div>
          <textarea
            value={form.scriptText}
            onChange={(event) => setForm((prev) => ({ ...prev, scriptText: event.target.value }))}
            placeholder="粘贴剧本正文、故事梗概或前几集内容。信息越完整，诊断越接近真实项目判断。"
          />
          <div className="input-meta">
            <span>{fileHint || "上传 Word 剧本后会自动提取正文。"}</span>
            <span>{form.scriptText.trim().length} 字</span>
          </div>
        </div>

        <div className="diagnose-footer compact-footer">
          <div>
            <strong>{isAnalyzing ? progressSteps[activeStep] : "准备开始商业诊断"}</strong>
            <span>{isAnalyzing ? "正在调用诊断逻辑，请稍候。" : "上传或粘贴剧本后即可生成报告。"}</span>
          </div>
          <button className="button primary" onClick={onRun} disabled={!canRun || isAnalyzing}>
            {isAnalyzing ? "诊断中" : "生成商业诊断"}
          </button>
        </div>

        {isAnalyzing && (
          <div className="progress-panel" aria-live="polite">
            <div className="progress-head">
              <strong>{progress}%</strong>
              <span>{progressSteps[activeStep]}</span>
            </div>
            <i><b style={{ width: `${progress}%` }} /></i>
            <div className="progress-steps">
              {progressSteps.map((step, index) => (
                <span className={index <= activeStep ? "active" : ""} key={step}>{step}</span>
              ))}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

function AssetExpert({
  form,
  setForm,
  onFile,
  onRun,
  onExport,
  onGenerateImage,
  imageStyle,
  setImageStyle,
  imageModelChoice,
  setImageModelChoice,
  isGenerating,
  isExporting,
  generatingAssetKey,
  progress,
  activeStep,
  fileHint,
  assetPackage,
}: {
  form: FormState;
  setForm: (fn: (prev: FormState) => FormState) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onRun: () => void;
  onExport: () => void;
  onGenerateImage: (item: AssetChecklistItem, index: number) => void;
  imageStyle: ImageStyle;
  setImageStyle: (value: ImageStyle) => void;
  imageModelChoice: ImageModelChoice;
  setImageModelChoice: (value: ImageModelChoice) => void;
  isGenerating: boolean;
  isExporting: boolean;
  generatingAssetKey: string;
  progress: number;
  activeStep: number;
  fileHint: string;
  assetPackage: AssetPackage | null;
}) {
  const canRun = Boolean(form.scriptText.trim());

  return (
    <section className="asset-page">
      <div className="asset-hero">
        <p className="eyebrow">客户审核资产入口</p>
        <h1>先定资产，再进样片</h1>
        <p className="subhead">根据剧本提取人物、场景、道具和衍生状态，生成客户可审核的AI视觉资产清单。</p>
      </div>

      <section className="asset-workbench">
        <div className="asset-input-panel">
          <div className="upload-zone compact-upload">
            <input id="asset-file" type="file" accept=".txt,.md,.docx" onChange={onFile} />
            <label htmlFor="asset-file">
              <strong>拖拽或选择剧本文件</strong>
              <span>支持 .docx、.txt、.md。优先上传第一集或样片段落，资产判断会更准确。</span>
              <em>{form.fileName || "选择本地剧本"}</em>
            </label>
          </div>
          <div className="script-input compact-script asset-script">
            <div>
              <h2>剧本文本</h2>
              <button className="text-button" onClick={() => setForm((prev) => ({ ...prev, title: "至暗时刻", scriptText: sampleScript }))}>
                填入示例
              </button>
            </div>
            <textarea
              value={form.scriptText}
              onChange={(event) => setForm((prev) => ({ ...prev, scriptText: event.target.value }))}
              placeholder="粘贴第一集剧本、样片段落或完整故事梗概。系统会先锁定可复用资产，不把情绪、动作和局部特写误判为资产。"
            />
            <div className="input-meta">
              <span>{fileHint || "资产提取会优先识别人物、主场景、关键道具和稳定视觉状态。"}</span>
              <span>{form.scriptText.trim().length} 字</span>
            </div>
          </div>
        </div>

        <div className="asset-rules-panel">
          <h2>资产审核逻辑</h2>
          <ul>
            <li>只提取稳定复用的人物、场景、道具。</li>
            <li>服装、战损、雨夜、激活、破损才进入衍生资产。</li>
            <li>表情、眼泪、手部特写、临时动作不单独资产化。</li>
            <li>先输出提示词和审核表，再按需逐张生成参考图。</li>
          </ul>
          <button className="button primary" onClick={onRun} disabled={!canRun || isGenerating}>
            {isGenerating ? "资产清单生成中" : "生成资产清单和提示词"}
          </button>
        </div>
      </section>

      {isGenerating && (
        <div className="progress-panel asset-progress" aria-live="polite">
          <div className="progress-head">
            <strong>{progress}%</strong>
            <span>{assetProgressSteps[activeStep]}</span>
          </div>
          <i><b style={{ width: `${progress}%` }} /></i>
          <div className="progress-steps">
            {assetProgressSteps.map((step, index) => (
              <span className={index <= activeStep ? "active" : ""} key={step}>{step}</span>
            ))}
          </div>
          <p className="progress-note">正在调用 Gemini 提取资产和提示词。图片改为逐张生成，清单会更快返回。</p>
        </div>
      )}

      {assetPackage ? (
        <AssetResult
          assetPackage={assetPackage}
          onExport={onExport}
          onGenerateImage={onGenerateImage}
          imageStyle={imageStyle}
          setImageStyle={setImageStyle}
          imageModelChoice={imageModelChoice}
          setImageModelChoice={setImageModelChoice}
          isExporting={isExporting}
          generatingAssetKey={generatingAssetKey}
        />
      ) : (
        <div className="asset-empty">
          <h2>等待剧本资产分析</h2>
          <p>生成后会出现基础资产、衍生资产、客户审核表、风险检查和英文定妆提示词。</p>
        </div>
      )}
    </section>
  );
}

function AssetResult({
  assetPackage,
  onExport,
  onGenerateImage,
  imageStyle,
  setImageStyle,
  imageModelChoice,
  setImageModelChoice,
  isExporting,
  generatingAssetKey,
}: {
  assetPackage: AssetPackage;
  onExport: () => void;
  onGenerateImage: (item: AssetChecklistItem, index: number) => void;
  imageStyle: ImageStyle;
  setImageStyle: (value: ImageStyle) => void;
  imageModelChoice: ImageModelChoice;
  setImageModelChoice: (value: ImageModelChoice) => void;
  isExporting: boolean;
  generatingAssetKey: string;
}) {
  const previewRows = assetPackage.assetChecklist;
  return (
    <section className="asset-result">
      {assetPackage.note && <div className="report-note">{assetPackage.note}</div>}
      <div className="asset-result-head">
        <div>
          <p className="eyebrow">AI视觉资产清单</p>
          <h2>《{assetPackage.title}》客户审核版</h2>
          <span>{assetPackage.summary}</span>
        </div>
        <button className="button primary" onClick={onExport} disabled={isExporting}>
          {isExporting ? "导出中" : "导出Excel资产表"}
        </button>
      </div>

      <div className="asset-generation-controls">
        <label>
          <span>图片风格</span>
          <select value={imageStyle} onChange={(event) => setImageStyle(event.target.value as ImageStyle)}>
            <option value="real_short_drama">真人短剧定妆照（默认）</option>
            <option value="cinematic_real">电影写实质感</option>
            <option value="ancient_real">古装/仙侠真人</option>
            <option value="anime_concept">动漫概念图</option>
          </select>
        </label>
        <label>
          <span>生图模型</span>
          <select value={imageModelChoice} onChange={(event) => setImageModelChoice(event.target.value as ImageModelChoice)}>
            <option value="auto">自动：优先 Nano Banana 2，失败降级</option>
            <option value="gemini-3.1-flash-image-preview">Nano Banana 2（Gemini 3.1）</option>
            <option value="gemini-2.5-flash-image">Nano Banana（Gemini 2.5）</option>
          </select>
        </label>
      </div>

      <div className="asset-stat-grid">
        <AssetStat label="基础资产" value={assetPackage.baseAssets.length} />
        <AssetStat label="衍生资产" value={assetPackage.derivedAssets.length} />
        <AssetStat label="客户审核项" value={assetPackage.assetChecklist.length} />
        <AssetStat label="风险检查" value={assetPackage.riskChecks.length} />
      </div>

      <div className="asset-preview-grid">
        {previewRows.map((item, index) => {
          const key = `${item.assetNo}-${item.state}-${index}`;
          const isGenerating = generatingAssetKey === key;
          return (
          <article className="asset-preview-card" key={key}>
            <div className="asset-preview-media">
              {item.referenceImage ? (
                <img src={item.referenceImage} alt={`${item.name}${item.state}`} />
              ) : (
                <span>{isGenerating ? "生成中" : item.category}</span>
              )}
            </div>
            <div>
              <strong>{item.assetNo} · {item.name}</strong>
              <p>{item.state}</p>
              <em>{item.imageStatus}</em>
              <small>模型：{item.imageModel || "未生成"}</small>
              <p className="asset-anchor">{item.visualAnchor}</p>
              <details className="asset-prompt">
                <summary>查看英文提示词</summary>
                <p>{item.imagePrompt || item.promptEn}</p>
                {item.threeViewPrompt && (
                  <>
                    <strong>三视图提示词</strong>
                    <p>{item.threeViewPrompt}</p>
                  </>
                )}
              </details>
              <button
                className="button secondary asset-image-button"
                onClick={() => onGenerateImage(item, index)}
                disabled={Boolean(generatingAssetKey)}
              >
                {isGenerating ? "生成中" : item.referenceImage ? "重新生成参考图" : "生成参考图"}
              </button>
            </div>
          </article>
          );
        })}
      </div>

      <div className="asset-tables">
        <AssetTable
          title="客户审核资产表"
          headers={["编号", "名称", "状态", "视觉锚点", "图片状态", "生图模型", "英文提示词"]}
          rows={assetPackage.assetChecklist.map((item) => [
            item.assetNo,
            item.name,
            item.state,
            item.visualAnchor,
            item.imageStatus,
            item.imageModel || "未生成",
            item.imagePrompt || item.promptEn,
          ])}
        />
        <AssetTable
          title="基础资产表"
          headers={["assetsId", "名称", "类型", "剧情功能", "核心视觉锚点", "一致性风险"]}
          rows={assetPackage.baseAssets.map((item) => [
            item.assetsId,
            item.name,
            item.type,
            item.function,
            item.visualAnchor,
            item.consistencyRisk,
          ])}
        />
        <AssetTable
          title="衍生资产表"
          headers={["父资产ID", "状态名", "类型", "差异描述", "原因", "复用场景"]}
          rows={assetPackage.derivedAssets.map((item) => [
            item.assetsId,
            item.name,
            item.type,
            item.desc,
            item.reason,
            item.reuseScenes,
          ])}
        />
        <AssetTable
          title="风险检查"
          headers={["内容", "判断/修正"]}
          rows={assetPackage.riskChecks.map((item) => [item.content, item.judgement])}
        />
      </div>
    </section>
  );
}

function AssetStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="asset-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AssetTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="asset-table-wrap">
      <h3>{title}</h3>
      <div className="asset-table-scroll">
        <table className="asset-table">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                {row.map((cell, cellIndex) => <td key={`${title}-${index}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PromptExpert({
  form,
  setForm,
  onFile,
  onRun,
  isGenerating,
  progress,
  activeStep,
  fileHint,
  promptPackage,
  platform,
  setPlatform,
  modeOverrides,
  setModeOverrides,
  onCopy,
}: {
  form: FormState;
  setForm: (fn: (prev: FormState) => FormState) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onRun: () => void;
  isGenerating: boolean;
  progress: number;
  activeStep: number;
  fileHint: string;
  promptPackage: PromptPackage | null;
  platform: PromptPlatform;
  setPlatform: (value: PromptPlatform) => void;
  modeOverrides: Record<string, PromptMode>;
  setModeOverrides: (value: Record<string, PromptMode>) => void;
  onCopy: (text: string) => void;
}) {
  const canRun = Boolean(form.scriptText.trim());
  return (
    <section className="prompt-page">
      <div className="asset-hero prompt-hero">
        <p className="eyebrow">视频生成执行入口</p>
        <h1>先拆镜，再决定怎么生成</h1>
        <p className="subhead">把剧本拆成标准镜头，自动判断全局文本、首帧、首尾帧或拆镜方案，并输出可直接复制到视频平台的提示词。</p>
      </div>

      <section className="asset-workbench">
        <div className="asset-input-panel">
          <div className="upload-zone compact-upload">
            <input id="prompt-file" type="file" accept=".txt,.md,.docx" onChange={onFile} />
            <label htmlFor="prompt-file">
              <strong>拖拽或选择剧本文件</strong>
              <span>建议上传第一集或样片段落。系统会重点锁定上一镜承接、朝向、动作终态和首尾帧。</span>
              <em>{form.fileName || "选择本地剧本"}</em>
            </label>
          </div>
          <div className="script-input compact-script asset-script">
            <div>
              <h2>剧本文本</h2>
              <button className="text-button" onClick={() => setForm((prev) => ({ ...prev, title: "至暗时刻", scriptText: sampleScript }))}>
                填入示例
              </button>
            </div>
            <textarea
              value={form.scriptText}
              onChange={(event) => setForm((prev) => ({ ...prev, scriptText: event.target.value }))}
              placeholder="粘贴需要生成视频提示词的剧本。复杂动作会自动建议首尾帧或拆镜。"
            />
            <div className="input-meta">
              <span>{fileHint || "提示词会按镜头拆分，不建议一次塞入太多动作。"}</span>
              <span>{form.scriptText.trim().length} 字</span>
            </div>
          </div>
        </div>

        <div className="asset-rules-panel prompt-rules">
          <h2>生成策略</h2>
          <label>
            <span>目标平台</span>
            <select value={platform} onChange={(event) => setPlatform(event.target.value as PromptPlatform)}>
              <option value="kling">可灵 / Kling</option>
              <option value="seedance">Seedance</option>
              <option value="runway">Runway</option>
              <option value="universal">通用视频平台</option>
            </select>
          </label>
          <ul>
            <li>简单对话和空镜优先全局文本生成。</li>
            <li>人物一致性强的镜头建议首帧驱动。</li>
            <li>打斗、推搡、转身、法术、状态变化优先首尾帧。</li>
            <li>极复杂镜头直接给拆镜建议，避免硬抽。</li>
          </ul>
          <button className="button primary" onClick={onRun} disabled={!canRun || isGenerating}>
            {isGenerating ? "提示词生成中" : "生成分镜提示词"}
          </button>
        </div>
      </section>

      {isGenerating && (
        <div className="progress-panel asset-progress" aria-live="polite">
          <div className="progress-head">
            <strong>{progress}%</strong>
            <span>{promptProgressSteps[activeStep]}</span>
          </div>
          <i><b style={{ width: `${progress}%` }} /></i>
          <div className="progress-steps">
            {promptProgressSteps.map((step, index) => (
              <span className={index <= activeStep ? "active" : ""} key={step}>{step}</span>
            ))}
          </div>
          <p className="progress-note">正在拆镜并判断全局生成、首帧、首尾帧或拆镜方案。</p>
        </div>
      )}

      {promptPackage ? (
        <PromptResult
          promptPackage={promptPackage}
          modeOverrides={modeOverrides}
          setModeOverrides={setModeOverrides}
          onCopy={onCopy}
        />
      ) : (
        <div className="asset-empty">
          <h2>等待生成分镜提示词</h2>
          <p>生成后会出现风险评分、推荐生成方式、正向提示词、负面提示词、首帧和尾帧提示词。</p>
        </div>
      )}
    </section>
  );
}

function PromptResult({
  promptPackage,
  modeOverrides,
  setModeOverrides,
  onCopy,
}: {
  promptPackage: PromptPackage;
  modeOverrides: Record<string, PromptMode>;
  setModeOverrides: (value: Record<string, PromptMode>) => void;
  onCopy: (text: string) => void;
}) {
  const highRiskCount = promptPackage.shots.filter((shot) => shot.riskScore >= 60).length;
  return (
    <section className="prompt-result asset-result">
      {promptPackage.note && <div className="report-note">{promptPackage.note}</div>}
      <div className="asset-result-head">
        <div>
          <p className="eyebrow">分镜提示词执行表</p>
          <h2>《{promptPackage.title}》视频生成提示词</h2>
          <span>{promptPackage.summary}</span>
        </div>
        <button className="button secondary" onClick={() => onCopy(buildAllPromptText(promptPackage, modeOverrides))}>复制整集提示词</button>
      </div>
      <div className="asset-stat-grid">
        <AssetStat label="镜头数量" value={promptPackage.shots.length} />
        <AssetStat label="高风险镜头" value={highRiskCount} />
        <AssetStat label="首尾帧建议" value={promptPackage.shots.filter((shot) => shot.recommendedMode === "first_last_frame").length} />
        <AssetStat label="拆镜建议" value={promptPackage.shots.filter((shot) => shot.recommendedMode === "split").length} />
      </div>
      <div className="prompt-global-rules">
        {promptPackage.globalRules.map((rule) => <span key={rule}>{rule}</span>)}
      </div>
      <div className="prompt-shot-list">
        {promptPackage.shots.map((shot) => {
          const selectedMode = modeOverrides[shot.shotId] || shot.recommendedMode;
          const copyText = buildShotCopyText(shot, selectedMode);
          return (
            <article className="prompt-shot-card" key={shot.shotId}>
              <div className="prompt-shot-head">
                <div>
                  <p className="eyebrow">{shot.shotId} · {shot.scene}</p>
                  <h3>{shot.visualGoal}</h3>
                </div>
                <span className={`risk-pill ${shot.riskScore >= 80 ? "danger" : shot.riskScore >= 60 ? "warning" : "safe"}`}>
                  风险 {shot.riskScore}/100
                </span>
              </div>
              <div className="prompt-meta-grid">
                <span>推荐：{modeLabel(shot.recommendedMode)}</span>
                <span>景别：{shot.shotSize}</span>
                <span>时长：{shot.duration}</span>
                <span>运镜：{shot.cameraMove}</span>
              </div>
              <label className="prompt-mode-select">
                <span>生成方式</span>
                <select
                  value={selectedMode}
                  onChange={(event) => setModeOverrides({ ...modeOverrides, [shot.shotId]: event.target.value as PromptMode })}
                >
                  <option value="text">全局文本生成</option>
                  <option value="first_frame">首帧驱动</option>
                  <option value="first_last_frame">首尾帧控制</option>
                  <option value="split">拆镜方案</option>
                </select>
              </label>
              <div className="prompt-risk-reasons">
                {shot.riskReasons.map((reason) => <span key={reason}>{reason}</span>)}
              </div>
              <PromptBlock title="视频正向提示词" text={shot.videoPrompt} onCopy={onCopy} />
              {(selectedMode === "first_frame" || selectedMode === "first_last_frame") && (
                <PromptBlock title="首帧图提示词" text={shot.firstFramePrompt} onCopy={onCopy} />
              )}
              {selectedMode === "first_last_frame" && (
                <>
                  <PromptBlock title="尾帧图提示词" text={shot.lastFramePrompt} onCopy={onCopy} />
                  <PromptBlock title="首尾帧过渡提示词" text={shot.transitionPrompt} onCopy={onCopy} />
                </>
              )}
              {selectedMode === "split" && <PromptBlock title="拆镜建议" text={shot.splitSuggestion} onCopy={onCopy} />}
              <PromptBlock title="负面提示词" text={shot.negativePrompt} onCopy={onCopy} />
              <button className="button primary prompt-copy-all" onClick={() => onCopy(copyText)}>复制当前镜头全部内容</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PromptBlock({ title, text, onCopy }: { title: string; text: string; onCopy: (text: string) => void }) {
  return (
    <section className="prompt-block">
      <div>
        <strong>{title}</strong>
        <button className="text-button" onClick={() => onCopy(text)}>一键复制</button>
      </div>
      <p>{text || "暂无"}</p>
    </section>
  );
}

function modeLabel(mode: PromptMode) {
  if (mode === "first_last_frame") return "首尾帧控制";
  if (mode === "first_frame") return "首帧驱动";
  if (mode === "split") return "建议拆镜";
  if (mode === "auto") return "自动判断";
  return "全局文本生成";
}

function buildShotCopyText(shot: PromptShot, mode: PromptMode) {
  const rows = [
    `【${shot.shotId}｜${modeLabel(mode)}】`,
    `场景：${shot.scene}`,
    `景别/运镜/时长：${shot.shotSize}｜${shot.cameraMove}｜${shot.duration}`,
    `连续性：${shot.continuity}`,
    `朝向：${shot.orientation}`,
    `动作终态：${shot.finalState}`,
    `视频正向提示词：${shot.videoPrompt}`,
  ];
  if (mode === "first_frame" || mode === "first_last_frame") rows.push(`首帧图提示词：${shot.firstFramePrompt}`);
  if (mode === "first_last_frame") {
    rows.push(`尾帧图提示词：${shot.lastFramePrompt}`);
    rows.push(`首尾帧过渡提示词：${shot.transitionPrompt}`);
  }
  if (mode === "split") rows.push(`拆镜建议：${shot.splitSuggestion}`);
  rows.push(`负面提示词：${shot.negativePrompt}`);
  return rows.join("\n");
}

function buildAllPromptText(promptPackage: PromptPackage, modeOverrides: Record<string, PromptMode>) {
  return promptPackage.shots
    .map((shot) => buildShotCopyText(shot, modeOverrides[shot.shotId] || shot.recommendedMode))
    .join("\n\n---\n\n");
}

function ToolCards() {
  return (
    <div className="tool-cards" aria-label="短剧智能体功能">
      <article className="tool-card active">
        <span>当前开放</span>
        <h3>剧本商业诊断</h3>
        <p>上传剧本后生成商业评分、故事核、付费卡点、承制风险和优化建议。</p>
      </article>
      <article className="tool-card">
        <span>开发中</span>
        <h3>短剧人物资产专家</h3>
        <p>博主正在抓紧开发。更新请关注：黄志攀AI商业圈</p>
      </article>
      <article className="tool-card">
        <span>开发中</span>
        <h3>A+级剧本提示词专家</h3>
        <p>博主正在抓紧开发。更新请关注：黄志攀AI商业圈</p>
      </article>
    </div>
  );
}

function Report({
  report,
  onStart,
  onExport,
}: {
  report: DiagnosisReport | null;
  onStart: () => void;
  onExport: () => void;
}) {
  if (!report) {
    return (
      <section className="empty-report">
        <h2>还没有诊断报告</h2>
        <p>先上传剧本或粘贴梗概，生成第一份商业诊断。</p>
        <button className="button primary" onClick={onStart}>发起诊断</button>
      </section>
    );
  }

  return (
    <section className="report-layout commercial-report">
      {report.note && <div className="report-note">{report.note}</div>}
      <div className="score-panel">
        <p>商业评分</p>
        <div className="score">{report.score}<span>/100</span></div>
        <ScoreLine label="故事核清晰度" value={report.score - 4} />
        <ScoreLine label="市场契合度" value={report.marketFit} />
        <ScoreLine label="人设商业价值" value={report.characterValue} />
      </div>

      <div className="roi-panel report-card">
        <div className="section-title compact">
          <h2>综合判断</h2>
          <span>{report.risk}风险</span>
        </div>
        <div className="roi-grid">
          <Metric label="市场契合" value={`${report.marketFit}%`} />
          <Metric label="留存预测" value={`${report.retention}%`} />
          <Metric label="推进建议" value={report.roi} />
        </div>
      </div>

      {report.basicJudgement && (
        <div className="deep-panel report-card">
          <h2>基本判断</h2>
          <div className="judgement-grid">
            <article>
              <span>类型</span>
              <strong>{report.basicJudgement.type}</strong>
            </article>
            <article>
              <span>目标受众</span>
              <strong>{report.basicJudgement.audience}</strong>
            </article>
            <article>
              <span>商业适配度</span>
              <strong>{report.basicJudgement.commercialFit}</strong>
            </article>
            <article>
              <span>AI视频适配度</span>
              <strong>{report.basicJudgement.aiVideoFit}</strong>
            </article>
            <article>
              <span>付费潜力</span>
              <strong>{report.basicJudgement.payPotential}</strong>
            </article>
          </div>
          <p className="diagnosis-line">{report.basicJudgement.oneLine}</p>
        </div>
      )}

      {report.storyCore && (
        <div className="story-panel report-card">
          <h2>故事核</h2>
          <blockquote>{report.storyCore.summary}</blockquote>
          <h3>为什么有吸引力</h3>
          <ul>
            {report.storyCore.appeal.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {report.hiddenLine && (
        <div className="story-panel report-card">
          <h2>隐线与人物弧</h2>
          <blockquote>{report.hiddenLine.arc}</blockquote>
          <h3>主角真正的成长</h3>
          <ul>
            {report.hiddenLine.growth.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {Boolean(report.goldenStructure?.length) && (
        <div className="table-panel report-card">
          <h2>前10集黄金结构检查</h2>
          <div className="report-table">
            <div className="table-row table-head">
              <span>集数</span>
              <span>当前功能</span>
              <span>判断</span>
              <span>优化建议</span>
            </div>
            {report.goldenStructure?.map((item) => (
              <div className="table-row" key={item.episodes}>
                <span>{item.episodes}</span>
                <span>{item.currentFunction}</span>
                <span>{item.qualified}</span>
                <span>{item.suggestion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Boolean(report.payPoints?.length) && (
        <div className="table-panel report-card">
          <h2>付费卡点设计</h2>
          <div className="paypoint-list">
            {report.payPoints?.map((item) => (
              <article key={`${item.name}-${item.episode}`}>
                <div>
                  <span>{item.name}</span>
                  <strong>{item.episode} · {item.type}</strong>
                </div>
                <p>{item.scene}</p>
                <small>{item.reason}</small>
              </article>
            ))}
          </div>
        </div>
      )}

      {report.emotionCurve && (
        <div className="emotion-panel report-card">
          <h2>爽点与情绪曲线</h2>
          <p className="diagnosis-line">{report.emotionCurve.curve}</p>
          <div className="tag-blocks">
            <article>
              <h3>强点</h3>
              {report.emotionCurve.strong.map((item) => <span key={item}>{item}</span>)}
            </article>
            <article>
              <h3>弱点</h3>
              {report.emotionCurve.weak.map((item) => <span key={item}>{item}</span>)}
            </article>
            <article>
              <h3>应该前置</h3>
              {report.emotionCurve.frontload.map((item) => <span key={item}>{item}</span>)}
            </article>
          </div>
        </div>
      )}

      {Boolean(report.infoGaps?.length) && (
        <div className="table-panel report-card">
          <h2>信息差设计</h2>
          <div className="report-table compact-table">
            <div className="table-row table-head">
              <span>信息差</span>
              <span>当前状态</span>
              <span>优化建议</span>
            </div>
            {report.infoGaps?.map((item) => (
              <div className="table-row" key={item.gap}>
                <span>{item.gap}</span>
                <span>{item.current}</span>
                <span>{item.suggestion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Boolean(report.aiProductionRisks?.length) && (
        <div className="risk-panel report-card ai-risk-panel">
          <h2>AI真人短剧制作风险</h2>
          {report.aiProductionRisks?.map((item) => (
            <article key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.level}</span>
              <p>{item.note}</p>
              <small>{item.fix}</small>
            </article>
          ))}
        </div>
      )}

      <div className="hook-panel report-card">
        <h2>可包装卖点</h2>
        {report.commercialHooks.map((hook) => <p key={hook}>{hook}</p>)}
      </div>

      <div className="suggest-panel report-card">
        <h2>具体修改建议</h2>
        <div className="suggest-grid">
          {(report.revisionSuggestions?.length ? report.revisionSuggestions : report.suggestions).map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.content}</p>
            </article>
          ))}
        </div>
      </div>

      {Boolean(report.sampleEpisodes?.length) && (
        <div className="sample-panel report-card">
          <h2>最适合优先制作的样片集数</h2>
          <div className="sample-grid">
            {report.sampleEpisodes?.map((item) => (
              <article key={item.episode}>
                <strong>{item.episode}</strong>
                <p>{item.reason}</p>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="retention-panel report-card">
        <h2>受众留存</h2>
        {report.audience.map((item) => (
          <div className="retention-row" key={item.name}>
            <strong>{item.fit}%</strong>
            <div>
              <span>{item.name}</span>
              <i><b style={{ width: `${item.fit}%` }} /></i>
              <small>{item.note}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="character-panel report-card">
        <h2>人设价值</h2>
        {report.characters.map((item) => (
          <article key={item.name}>
            <span>{item.tag}</span>
            <h3>{item.name} · {item.value}</h3>
            <p>{item.note}</p>
          </article>
        ))}
      </div>

      <div className="risk-panel report-card">
        <h2>风险与修复路径</h2>
        {report.risks.map((item) => (
          <article key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.level}</span>
            <p>{item.note}</p>
            <small>{item.fix}</small>
          </article>
        ))}
      </div>

      <div className="report-actions">
        <button className="button secondary" onClick={onStart}>重新诊断</button>
        <button className="button primary" onClick={onExport}>导出PDF报告</button>
      </div>
    </section>
  );
}

function DonateModal({
  onClose,
  onRedeem,
}: {
  onClose: () => void;
  onRedeem: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [redeemMessage, setRedeemMessage] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);

  const submitCode = async () => {
    setIsRedeeming(true);
    setRedeemMessage("");
    try {
      await onRedeem(code);
      setRedeemMessage("兑换成功，可以继续生成。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "兑换码无效，请检查后重新输入。";
      setRedeemMessage(message);
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="打赏提示">
      <div className="modal-card donate-card">
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="modal-kicker">免费次数已用完</span>
        <h2>添加管理员，咨询解锁后续使用</h2>
        <p>如需继续生成商业诊断，请扫码添加管理员。管理员会协助开通后续使用权限，也可以为你提供项目诊断和工具使用建议。</p>
        <div className="qr-box">
          <img src="/donate-qr.jpg" alt="管理员微信二维码" />
        </div>
        <div className="redeem-form">
          <label htmlFor="redeem-code">已有兑换码</label>
          <div>
            <input
              id="redeem-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCode();
              }}
              placeholder="输入兑换码继续使用"
            />
            <button className="button secondary" onClick={submitCode} disabled={isRedeeming}>
              {isRedeeming ? "兑换中" : "兑换"}
            </button>
          </div>
          {redeemMessage && (
            <span className={redeemMessage.includes("成功") ? "redeem-message success" : "redeem-message error"}>
              {redeemMessage}
            </span>
          )}
        </div>
        <button className="button primary wide" onClick={onClose}>我知道了</button>
      </div>
    </div>
  );
}

function ComingSoonModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="功能开发中">
      <div className="modal-card">
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="modal-kicker">功能开发中</span>
        <h2>{title}</h2>
        <p>博主正在抓紧开发。更新请关注：黄志攀AI商业圈</p>
        <button className="button primary wide" onClick={onClose}>知道了</button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <i />
    </div>
  );
}

function ScoreLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-line">
      <span>{label}</span>
      <i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
    </div>
  );
}

export default App;
