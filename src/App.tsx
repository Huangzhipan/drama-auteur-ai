import { ChangeEvent, useEffect, useMemo, useState } from "react";
import mammoth from "mammoth";

type View = "diagnose" | "report";

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
const generationLimit = 2;
const generationCountKey = "xingchi-ai-diagnosis-count";
const generationUnlockKey = "xingchi-ai-diagnosis-unlocked";
const redeemCodes = new Set(["XINGCHI2026", "HZP2026", "XCAI888"]);
const diagnoseApiEndpoint =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787/api/diagnose"
    : "/api/diagnose";

function normalizeRedeemCode(code: string) {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

function isRedeemCodeValid(code: string) {
  return redeemCodes.has(normalizeRedeemCode(code));
}

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

function App() {
  const [view, setView] = useState<View>("diagnose");
  const [form, setForm] = useState<FormState>(initialForm);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
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

  const activeStep = useMemo(() => {
    if (progress < 25) return 0;
    if (progress < 52) return 1;
    if (progress < 78) return 2;
    return 3;
  }, [progress]);

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

  const redeemAccess = (code: string) => {
    if (!isRedeemCodeValid(code)) return false;
    window.localStorage.setItem(generationUnlockKey, "true");
    window.localStorage.removeItem(generationCountKey);
    setDonateOpen(false);
    return true;
  };

  const exportReport = () => {
    if (!report) return;
    window.print();
  };

  return (
    <div className="app-shell compact-shell">
      <TopBar
        report={report}
        onReport={() => setView("report")}
        onNew={() => setView("diagnose")}
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
      </main>
      {donateOpen && <DonateModal onClose={() => setDonateOpen(false)} onRedeem={redeemAccess} />}
      {comingSoon && <ComingSoonModal title={comingSoon} onClose={() => setComingSoon("")} />}
    </div>
  );
}

function TopBar({
  report,
  onReport,
  onNew,
  onComingSoon,
}: {
  report: DiagnosisReport | null;
  onReport: () => void;
  onNew: () => void;
  onComingSoon: (title: string) => void;
}) {
  return (
    <header className="topbar compact-topbar">
      <button className="brand-button" onClick={onNew}>星驰AI—短剧智能体</button>
      <nav className="topnav compact-nav">
        <button className="nav-tool active" onClick={onNew}>剧本商业诊断</button>
        <button className="nav-tool" onClick={() => onComingSoon("短剧人物资产专家")}>短剧人物资产专家</button>
        <button className="nav-tool" onClick={() => onComingSoon("A+级剧本提示词专家")}>A+级剧本提示词专家</button>
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
  onRedeem: (code: string) => boolean;
}) {
  const [code, setCode] = useState("");
  const [redeemMessage, setRedeemMessage] = useState("");

  const submitCode = () => {
    if (onRedeem(code)) {
      setRedeemMessage("兑换成功，可以继续生成。");
      return;
    }
    setRedeemMessage("兑换码无效，请检查后重新输入。");
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
            <button className="button secondary" onClick={submitCode}>兑换</button>
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
