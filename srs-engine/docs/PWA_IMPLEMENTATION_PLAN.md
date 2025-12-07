# PWA 背单词应用实现方案 (最终版)

本文档是我们迭代设计的最终成果，整合了所有核心思想与关键决策，是一份可直接指导后端和前端开发的权威落地蓝图。

## 第零部分：架构原则与项目建议

### 1. 核心架构：本地优先 (Local-First)
本方案以“本地优先”为核心，所有核心计算在客户端完成，保证了极致的响应速度和离线可用性。后端是“数据备份与同步中心”。

### 2. Anki 核心概念
*   **笔记 (Note)**：信息的基本单位，包含多个“字段”，如“英文”、“中文”等，本身不可复习。
*   **卡片 (Card)**：从 `Note` 的“卡片模板”中自动生成的可复习单位。一张 `Note` 可生成多张 `Card`，且每张 `Card` 的学习进度独立计算。

### 3. 项目落地建议
*   **只用 FSRS**：直接采纳 FSRS 作为唯一调度器。
*   **默认参数**：使用我们 `srs-engine` 中实现的官方 FSRS 默认参数起步。
*   **负载与节奏**：应用需实现 Fuzz (随机扰动) 和 Load Balancer (负载均衡)，以平摊每日复习量。

---
## 第一部分：核心 SRS 引擎 (`srs-engine`)

本部分概要介绍我们通过测试驱动开发（TDD）完成的 `srs-engine` 模块。它是一个功能完备、经过严格测试、可直接投产的核心算法库。

### 1. 功能与实现
`srs-engine` 模块使用 TypeScript 编写，完整实现了 FSRS 间隔重复算法的核心逻辑，包括：
*   **精确的 FSRS 公式**：核心算法（如 `next_stability`, `next_difficulty` 等）基于对 `ts-fsrs` 官方库的分析和适配，确保了计算的准确性。
*   **完整的状态机**：能够正确处理 `New`, `Learning`, `Review`, `Relearning` 所有四种卡片状态。
*   **多步学习**：支持为“学习中”和“再学习中”的卡片设置多个学习步骤。
*   **复习时机处理 (`delta_t`)**：能够根据用户是提前、准时还是延迟复习，来动态调整下一次的稳定性增益。
*   **间隔模糊化 (Fuzzing)**：为计算出的复习间隔增加随机扰动，避免卡片在同一天集中到期。

**要查看完整的源代码，请直接参考以下文件：**
*   **数据类型**: `srs-engine/src/types.ts`
*   **算法实现**: `srs-engine/src/index.ts`

### 2. 核心 API
引擎主要导出两个函数供前端调用：
*   `getNextStates(card: Card, config: DeckConfig, now: Date): NextStates`
*   `applyFuzzAndLoadBalance(interval: number): number`

前端通过调用 `getNextStates` 获取卡片在不同评分下的新状态，然后结合 `applyFuzzAndLoadBalance` 的结果来确定最终的复习计划。

---
## 第二部分：后端 API 设计 (v5)

本节是对 API 的最终详细设计，它解决了数据同步中的所有关键缺口。

### 1. 核心原则
*   **会话ID (`session_id`)**: 保证分页数据交换的一致性。
*   **ID 映射**: 客户端创建的数据上传后，后端必须返回新旧 ID 的映射关系。
*   **POST 代替 GET**: 对于需传递大量 ID 的“拉取”类请求，使用 `POST`。

### 2. API 端点
*   **认证**: `POST /auth/login`, `POST /auth/register`
*   **核心同步**:
    *   `POST /sync/start` (返回 `syncSessionId` 和下载信息)
    *   `GET /sync/download/:syncSessionId?page=:page_number` (分页拉取变更)
    *   `POST /sync/upload` (批量上传变更, **返回 `idMappings`**)
*   **全量同步**: `POST /sync/full-download-start`, `GET /sync/full-download/:sessionId/page/:page`
*   **内容拉回**: `POST /cards/content` (请求体为 `{ "cardIds": [...] }`)

---
## 第三部分：后端数据模型

本数据模型的设计思想完全借鉴自 Anki 成熟的数据库结构，并为我们的云服务做了适配和优化。

*   **`users`**: `id`, `username`, `password_hash`, `created_at`
*   **`decks`**: `id`, `user_id`, `name`, `config_json`, `created_at`, `modified_at`
*   **`notes`**: `id`, `user_id`, `fields_json`, `created_at`, `modified_at`
*   **`cards`**: `id`, `user_id`, `note_id`, `deck_id`, `due`, `stability`, `difficulty`, `lapses`, `state`, `created_at`, `modified_at`
*   **`revlog`** (复习日志): `id`, `user_id`, `card_id`, `review_time`, `rating`, `state_before`, `state_after`, `stability_before`, `stability_after`, `difficulty_before`, `difficulty_after`, `interval_before`, `interval_after`, `milliseconds_taken`

---
## 第四部分：遗留问题与未来展望

本节记录在开发过程中识别出的、当前版本已解决或作为未来优化方向的架构决策。

### 1. 笔记与卡片模板策略
*   **当前决策**: MVP 版本采用“隐式模板”。即不在数据库中创建 `note_types` 和 `card_templates` 表，生成卡片的规则硬编码在前端。
*   **优点**: 大幅降低开发复杂度，快速上线核心功能。
*   **未来展望**: 当前的数据模型已为未来支持“显式模板”做好了准备。未来可通过新增表和字段，并开发模板编辑器，来平滑过渡到与 Anki 桌面版一样强大的自定义功能。

### 2. 负载均衡 (Load Balancer)
*   **架构定位**: “负载均衡”是一个**更高层次的调度编排功能**，而非 FSRS 核心算法的一部分。
*   **当前状态**: `srs-engine` 中的 `applyFuzzAndLoadBalance` 函数目前仅实现了 Fuzzing（随机扰动）功能。
*   **实现建议**: 负载均衡应作为**前端应用层**的一部分来实现，例如在 `SyncManager` 或一个独立的 `SchedulerService` 中。该服务负责：
    1.  查询本地 IndexedDB，预测未来几天的复习负载。
    2.  调用 `srs-engine` 获得卡片的理论间隔和 Fuzz 范围。
    3.  在 Fuzz 范围内，结合未来的负载数据，加权选择最“空闲”的一天作为最终的 `due` 日期。

### 3. 复习时机处理 (`delta_t`) 精度
*   **当前状态**: `srs-engine` 的实现**已经能够**根据复习的提前或延迟（`delta_t`）来动态调整稳定度的增益，并通过了我们的单元测试。
*   **未来展望**: 当前的实现是基于对 `ts-fsrs` 库和 FSRS 公开原理的精确适配。尽管已非常健壮，但 FSRS 算法本身仍在不断发展。未来若官方论文或 `ts-fsrs` 库发布了更优化的 `delta_t` 处理公式，我们可以再次迭代 `srs-engine` 中的 `next_stability` 函数，以追求更高的精度。对我们而言，这是一个未来可以投入的优化点，而非当前阻塞功能的缺陷。

---
## 第五部分：前端策略与实现指南

### 1. 数据流与同步策略
*   **最简生词处理**: 前端负责创建 `Note` 和 `Card` 的初始对象，并设置 FSRS 初始状态。
*   **同步时机**: 在应用启动、复习会话后、关键操作后、或手动触发时进行。

### 2. 高级 UI 流程
*   **全局同步状态**: 使用全局状态管理器（如 Zustand/Redux）维护 `sync` 状态，驱动 UI 反馈。
*   **冲突解决流程**: 通过阻塞式对话框，引导用户完成“下载覆盖本地”或“上传覆盖云端”的选择。