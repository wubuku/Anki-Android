# PWA 背单词应用实现方案 (最终版)

本文档是我们迭代设计的最终成果，整合了所有核心思想与关键决策，是一份唯一的、可直接指导后端和前端开发的权威落地蓝图。

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
*   **精确的 FSRS 公式**：核心算法基于对 `ts-fsrs` 官方库的分析和适配。
*   **完整的状态机**：能够正确处理 `New`, `Learning`, `Review`, `Relearning` 所有四种卡片状态。
*   **多步学习**：支持为“学习中”和“再学习中”的卡片设置多个学习步骤。
*   **复习时机处理 (`delta_t`)**：能够根据用户是提前、准时还是延迟复习，来动态调整下一次的稳定性增益。
*   **间隔模糊化 (Fuzzing)**：为计算出的复习间隔增加随机扰动。

**要查看完整的源代码，请直接参考以下文件：**
*   **数据类型**: `srs-engine/src/types.ts`
*   **算法实现**: `srs-engine/src/index.ts`

### 2. 未来改进与考量

#### 2.1 负载均衡 (Load Balancer)
*   **架构定位**: “负载均衡”是一个**更高层次的调度编排功能**，而非 FSRS 核心算法的一部分。
*   **当前状态**: `srs-engine` 中的 `applyFuzzAndLoadBalance` 函数目前仅实现了 Fuzzing（随机扰动）功能。
*   **实现建议**: 负载均衡应作为**前端应用层**的一部分来实现。该服务负责查询本地数据库，预测未来几天的复习负载，然后在 Fuzz 范围内，加权选择最“空闲”的一天作为最终的 `due` 日期。

#### 2.2 复习时机处理 (`delta_t`) 精度
*   **当前状态**: `srs-engine` 的实现**已经能够**根据复习的提前或延迟来动态调整稳定度的增益，并通过了单元测试。
*   **未来展望**: 当前的实现是基于对 `ts-fsrs` 库的精确适配。FSRS 算法本身仍在不断发展，未来若有更优化的 `delta_t` 处理公式，我们可以再次迭代 `srs-engine`。这是一个未来可以投入的优化点，而非当前缺陷。

---
## 第二部分：数据流与边界条件

### “最简生词”的处理流程

**场景**: 用户通过查词典、划词等方式，只录入了一个单词 "work" 及其最简单的释义 "工作"。

**数据流**:
1.  **前端响应**：用户点击“收藏”时，前端应用**立即**在本地 IndexedDB 中创建一条 `note` 记录和一张关联的 `card` 记录。
2.  **设置初始状态**：为这张新卡片设置 FSRS 初始状态：`state: State.New`, `stability: 0`, `difficulty: 5`, `due: (当前时间)`。
3.  **即时可用**：这张新卡片会**立刻**出现在用户的学习队列中，可以被 `srs-engine` 正常调度复习。
4.  **异步同步**：这条新的 `note` 和 `card` 记录，将在下一个同步周期中被异步上传到后端。

---
## 第三部分：同步策略与数据编排

### 1. 同步的触发时机 (When)
*   **应用启动时**: 后台自动触发一次增量同步。
*   **复习会话后**: 用户完成一组复习后，后台触发一次变更上传。
*   **关键操作后**: 用户创建/删除卡组等操作后，触发一次变更上传。
*   **周期性同步**: 应用若长期打开，可每隔15分钟静默同步一次。
*   **手动触发**: UI 中必须提供一个清晰的“立即同步”按钮。

### 2. 数据拉取策略 (How Much)
*   **首次同步 (全量下载)**: 必须支持**分页**。后端 `/sync/full-download-start` 接口应返回总页数，前端再循环调用 `GET /sync/full-download/:sessionId/page/:page` 来分批获取，并向用户展示总进度。
*   **增量同步 (常规下载)**: `POST /sync/start` 的响应体如果需要下发大量数据，也应该是分页式的，前端再分批获取。

---
## 第四部分：后端 API 设计 (v5)
*本节是对 API 的最终详细设计，它解决了数据同步中的所有关键缺口。*

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
## 第五部分：后端数据模型 (详细阐述)
*本数据模型的设计思想完全借鉴自 Anki 成熟的数据库结构。*

*   **`users`**: `id`, `username`, `password_hash`, `created_at`
*   **`decks`**: `id`, `user_id`, `name`, `config_json`, `created_at`, `modified_at`
*   **`notes`**: `id`, `user_id`, `fields_json`, `created_at`, `modified_at`
*   **`cards`**: `id`, `user_id`, `note_id`, `deck_id`, `due`, `stability`, `difficulty`, `lapses`, `state`, `created_at`, `modified_at`
*   **`revlog`** (复习日志): `id`, `user_id`, `card_id`, `review_time`, `rating`, `state_before`, `state_after`, `stability_before`, `stability_after`, ...

---
## 第六部分：笔记与卡片模板策略
### 我们的决策：MVP 优先，兼容未来
*   **当前版本**: **不**在数据库中创建 `note_types` 和 `card_templates` 表。生成卡片的规则**硬编码**在前端。
*   **未来扩展**: 当前的 `notes` 表 `fields_json` 字段为未来平滑过渡到完全可定制的模板系统做好了准备。

---
## 第七部分：前端策略与实现指南

### 1. 高级 UI 流程
*   **全局同步状态**: 使用全局状态管理器（如 Zustand/Redux）维护 `sync` 状态 (`idle`, `syncing`, `error`, `conflict`)，驱动 UI 反馈。
*   **冲突解决流程**: 通过阻塞式对话框，引导用户完成“下载覆盖本地”或“上传覆盖云端”的选择。

### 2. 复习界面代码示例 (`ReviewScreen.jsx`)
*此为核心逻辑示例，旨在展示 `srs-engine` 如何与前端数据库和状态管理结合。*
```jsx
import { getNextStates, applyFuzzAndLoadBalance } from '../srs-engine'; // 导入我们创建的引擎
import { db } from './database';
import { State, Rating } from '../srs-engine';

// ...
async function handleAnswer(card, rating, deckConfig, now) {
    // 1. 从 SRS 引擎获取所有可能的新状态
    const nextStates = getNextStates(card, deckConfig, now);

    // 2. 根据用户评分选择一个状态
    const chosenState = nextStates[rating];

    // 3. 计算最终间隔 (应用 Fuzz)
    const finalInterval = applyFuzzAndLoadBalance(chosenState.interval);
    
    // 4. 准备更新本地数据库
    const updatedCard = { /* ... 更新卡片属性 ... */ };
    const reviewLog = { /* ... 记录所有前后变化，用于上传 ... */ };

    // 5. 原子化地更新本地数据库
    await db.transaction('rw', db.cards, db.reviews, async () => {
        await db.cards.put(updatedCard);
        await db.reviews.add(reviewLog);
    });

    // 6. UI 切换到下一张卡
    // ...
};
```
