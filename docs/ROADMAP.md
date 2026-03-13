# 浏览器 LLM 翻译插件开发任务清单（Executable Backlog）

## 1. 目标与范围

- 目标：优先解决“翻译生成慢”的痛点，提供稳定的流式输出体验。
- 本期范围（MVP+V1 核心）：`selection`、`context menu`、流式输出、多 Provider、缓存与快速降级。
- 非本期：OCR、账号系统、复杂整页重排翻译。

## 2. 里程碑规划

### Sprint 1（主链路打通）

- A-01 初始化 MV3 项目骨架
- A-02 划词、右键、快捷键触发
- A-03 统一消息协议
- B-01 长连接流式通道

验收：能看到流式翻译字词逐步出现，支持取消。

### Sprint 2（多模型与故障恢复）

- C-01 OpenAI 适配
- C-02 Anthropic 适配
- C-03 OpenRouter 适配
- C-04 路由与 fallback

验收：主 Provider 异常时自动切换成功。

### Sprint 3（性能收敛）

- D-01 双级缓存（L1+L2）
- D-02 缓存键与 TTL
- D-03 限流、重试、退避
- E-03 指标埋点（TTFT/总时延）

验收：缓存命中场景首字响应显著加速。

### Sprint 4（产品化）

- E-01 设置页
- E-02 完整状态机 UX（加载/流式/错误）
- F-01/F-02/F-03 测试、安全、发布材料

验收：可提交浏览器商店审核。

## 3. Epic 与任务明细

## Epic A：Core Translation Fast Path

- A-01 MV3 基础骨架
  - 交付：`manifest.json`、`service-worker`、`content-script`、`popup`、`options`
  - DoD：扩展可加载，脚本注入成功
- A-02 触发系统
  - 交付：划词按钮、右键菜单、快捷键
  - DoD：三种触发均可发起翻译
- A-03 协议层
  - 交付：请求/流事件/错误码 schema
  - DoD：requestId 全链路追踪

## Epic B：Streaming Pipeline

- B-01 Port 长连接
  - DoD：稳定推送 `delta`
- B-02 增量渲染器
  - DoD：50ms flush，不卡顿不闪烁
- B-03 取消机制
  - DoD：用户取消后请求立即中断

## Epic C：Provider Router & Fallback

- C-01/C-02/C-03 各 Provider Adapter
  - DoD：统一事件流输出，不暴露厂商差异
- C-04 动态路由
  - DoD：速度优先 + 超时快切 + 健康评分

## Epic D：Cache & Performance

- D-01 L1/L2 缓存
- D-02 键规范 + TTL
- D-03 429/5xx 重试与节流

DoD：TTFT、总时延、命中率可观测且达门槛。

## Epic E：UX/Settings/Observability

- E-01 设置页：Provider、API Key、模型、速度档位
- E-02 状态机 UX：`idle/loading/streaming/done/error`
- E-03 指标采集：`ttftMs`、`latencyMs`、`cacheHitRate`、`fallbackRate`

## Epic F：QA/Release

- F-01 自动化与手测矩阵
- F-02 安全与权限审查
- F-03 发布说明、隐私政策、商店文案

## 4. 优先级

- P0：A、B、C-04、D-01、D-03
- P1：E、F
- P2：术语表、整页翻译增强、本地模型

## 5. 风险与应对

- MV3 worker 休眠：所有任务状态可恢复，避免依赖全局变量。
- Provider 不稳定：快速切换 + 指数退避。
- 页面兼容性：最小 DOM 注入，优先覆盖层而非替换节点。
