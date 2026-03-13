# SPEC：浏览器 LLM 翻译插件架构设计（速度优先 + 流式优先）

## 1. 概述

- 产品目标：在网页阅读场景提供低延迟、高稳定、可流式反馈的翻译体验。
- 关键设计原则：`Fast First`、`Streaming First`、`Secure by Default`。

## 2. SLO / KPI

- `TTFT`（首字可见）`P50 <= 800ms`，`P95 <= 1800ms`
- 用户触发后 UI 反馈（loading）`<= 80ms`
- 总时延（150-300 字）`P50 <= 3.5s`
- 缓存命中率目标：`>= 35%`（上线后逐步提升）
- fallback 成功率：`>= 99%`（排除全局网络故障）

## 3. 系统架构

### 3.1 组件

- `content-script`
  - 捕获选择文本/上下文
  - 渲染 popover / side panel
  - 接收并增量渲染流式输出
- `service-worker`（MV3）
  - 请求编排、路由、缓存、重试、限流
  - 管理 provider adapter
- `provider-adapter`
  - 各厂商协议兼容层（OpenAI/Anthropic/OpenRouter）
- `options/popup`
  - 配置 Provider、模型、速度档位、术语表等
- `storage`
  - `chrome.storage.session`：敏感配置（优先）
  - `chrome.storage.local`：缓存与指标
  - `chrome.storage.sync`：轻量偏好

### 3.2 逻辑数据流

1. 用户划词 -> `content-script` 生成 `TRANSLATE_REQUEST`
2. `service-worker` 校验请求并查 L1/L2 缓存
3. 缓存命中：立即回放缓存结果（模拟流式）
4. 缓存未命中：路由器选择 provider + model
5. adapter 建立流式请求并输出标准化事件
6. `content-script` 增量渲染，最终 `done`
7. 写入缓存与指标

## 4. 协议与接口

### 4.1 请求协议

```ts
type TranslateRequest = {
  requestId: string;
  text: string;
  sourceLang?: string;
  targetLang: string;
  style: "faithful" | "natural" | "concise" | "glossary_first";
  mode: "selection" | "paragraph" | "page";
  modelHint?: string;
  createdAt: number;
};
```

### 4.2 流式事件协议

```ts
type StreamEvent =
  | { type: "start"; requestId: string; provider: string; model: string }
  | { type: "delta"; requestId: string; chunk: string; seq: number }
  | { type: "meta"; requestId: string; ttftMs?: number; tokenUsage?: number }
  | { type: "done"; requestId: string; text: string; latencyMs: number; cacheHit: boolean }
  | { type: "error"; requestId: string; code: string; message: string; retryable: boolean };
```

### 4.3 Provider Adapter 契约

```ts
interface ProviderAdapter {
  name: "openai" | "anthropic" | "openrouter" | "gemini";
  translateStream(req: TranslateRequest, signal: AbortSignal): AsyncGenerator<StreamEvent>;
  health(): Promise<{ ok: boolean; p95ttftMs: number; errorRate: number }>;
}
```

## 5. 路由与降级策略

- 策略输入：文本长度、语言对、用户速度偏好、实时健康度、429 比例。
- 默认链路：`fast-primary -> fast-backup -> quality-fallback`
- 超时预算：达到 TTFT 阈值仍无 `delta`，立即触发切换。
- 降级模式：高峰期自动降级到低成本/低延迟模型。

## 6. 缓存策略

- L1：内存缓存（worker 活跃期）
- L2：`chrome.storage.local`（跨重启）
- Key：`sha256(normalizedText + src + tgt + style + model + glossaryVersion)`
- TTL：默认 24h，可按语言对动态调整
- 命中后：以“模拟流式”方式回放，保持一致 UX

## 7. 流式渲染策略

- 通道：`runtime.connect` + `Port` 长连接
- 渲染：缓冲队列 + 50ms 合并刷新
- 取消：`AbortController`，新请求自动取消旧请求
- 防抖：避免每 token 重排，减少抖动

## 8. 错误处理

- 标准错误码
  - `E_TIMEOUT`
  - `E_RATE_LIMIT`
  - `E_PROVIDER_DOWN`
  - `E_ABORTED`
  - `E_INVALID_REQUEST`
- 恢复动作
  - `E_TIMEOUT` / `E_PROVIDER_DOWN`：自动 fallback
  - `E_RATE_LIMIT`：指数退避 + `retry-after`
  - `E_ABORTED`：静默结束，不提示错误

## 9. 安全与隐私

- API Key 不进入 `content-script`
- 最小权限原则（仅请求必要权限）
- 用户文本默认不上传日志（日志仅记录匿名指标）
- 全页翻译需用户显式确认

## 10. 可观测性

- 指标
  - `ttftMs`
  - `latencyMs`
  - `cacheHitRate`
  - `fallbackRate`
  - `cancelRate`
- 事件
  - `selection_detected`
  - `request_sent`
  - `first_delta`
  - `done`
  - `error`

## 11. 验收标准

- SLO 达标：TTFT / 总时延达到门槛
- 功能达标：触发、流式、取消、fallback、缓存全部可用
- 安全达标：密钥隔离、权限最小化、输入校验通过
