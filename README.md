# DramaAuteur AI 本地演示版

这是“剧本商业诊断”第一阶段本地原型，用于验证获客入口和报告体验。

## 当前已实现

- 工作台主页
- 发起新剧本诊断
- 上传 txt / md 剧本并读取文本
- PDF / Word 文件名记录
- 粘贴剧本文本
- 选择目标受众、题材类型、预算范围和集数
- 本地模拟 AI 商业诊断
- 商业诊断报告展示
- 导出 txt 诊断报告
- 预留 `GEMINI_API_KEY` 配置文件

## 本地运行

```bash
npm install
npm run dev
```

## 后续 Gemini 接入点

当前 `src/App.tsx` 中的 `createMockReport()` 是本地模拟诊断函数。

后续接入 Gemini 时，将它替换为：

```text
前端提交剧本和参数
→ 后端 API 读取 GEMINI_API_KEY
→ 调用 Gemini
→ 要求 Gemini 返回结构化 JSON
→ 前端按现有 DiagnosisReport 类型渲染报告
```

建议 Gemini 输出结构保持 `DiagnosisReport` 字段一致，避免重写报告页面。

