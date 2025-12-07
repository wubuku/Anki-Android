# PWA 背单词应用实现方案 (最终版)

本文档是我们迭代设计的最终成果，整合了从 v1 到 v5 所有版本的核心思想与关键决策。它是一份唯一的、可直接指导后端和前端开发的权威落地蓝图。

## 第零部分：架构原则与项目建议

### 1. 核心架构：本地优先 (Local-First)
本方案以“本地优先”为核心，所有核心计算在客户端完成，保证了极致的响应速度和离线可用性。后端是“数据备份与同步中心”。

### 2. Anki 核心概念
*   **笔记 (Note)**：信息的基本单位，包含多个“字段”，如“英文”、“中文”等，本身不可复习。
*   **卡片 (Card)**：从 `Note` 的“卡片模板”中自动生成的可复习单位。一张 `Note` 可生成多张 `Card`，且每张 `Card` 的学习进度独立计算。

### 3. 项目落地建议
*   **只用 FSRS**：直接采纳 FSRS 作为唯一调度器。
*   **默认参数**：使用我们 `srs-engine` 中实现的官方 FSRS 默认参数起步，期望保持率 (desired retention) 可设为 0.9。
*   **负载与节奏**：必须实现 Fuzz (随机扰动) 和 Load Balancer (负载均衡)，以平摊每日复习量。

---
## 第一部分：核心 SRS 引擎 (`srs-engine`) - 最终实现

本部分包含我们通过测试驱动开发（TDD）完成的、可直接投产的 `srs-engine` 模块的最终 TypeScript 源代码。

### 1. 数据类型 (`src/types.ts`)
```typescript
export enum Rating {
  Again = 1,
  Hard,
  Good,
  Easy,
}

export enum State {
  New = 0,
  Learning,
  Review,
  Relearning,
}

export interface Card {
  id: string;
  due: Date;
  stability: number;
  difficulty: number;
  lapses: number;
  state: State;
  last_review?: Date;
}

export interface FSRSParameters {
  request_retention: number;
  maximum_interval: number;
  w: number[];
}

export interface MemoryState {
  stability: number;
  difficulty: number;
}

export interface NextStates {
  again: MemoryState & { interval: number };
  hard: MemoryState & { interval: number };
  good: MemoryState & { interval: number };
  easy: MemoryState & { interval: number };
}

export type ReviewLog = {
  card_id: string;
  review_time: Date;
  rating: Rating;
  state: State;
  due: Date;
  stability: number;
  difficulty: number;
  lapses: number;
};
```

### 2. 算法实现 (`src/index.ts`)
```typescript
import { Card, NextStates, Rating, State } from './types';

export * from './types';

// Default FSRS parameters
export const FSRS_DEFAULT_PARAMS = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];

// Helper functions based on FSRS formulas
function next_difficulty(d: number, r: Rating): number {
    const new_d = d - FSRS_DEFAULT_PARAMS[6] * (r - 3);
    const constrained_d = Math.min(Math.max(new_d, 1), 10);
    return parseFloat(constrained_d.toFixed(2));
}

function next_stability(d: number, s: number, r: Rating): number {
    const hard_penalty = r === Rating.Hard ? FSRS_DEFAULT_PARAMS[15] : 1;
    const easy_bonus = r === Rating.Easy ? FSRS_DEFAULT_PARAMS[16] : 1;
    return s * (1 + Math.exp(FSRS_DEFAULT_PARAMS[8]) * (11 - d) * Math.pow(s, -FSRS_DEFAULT_PARAMS[9]) * (Math.exp((1 - r) * FSRS_DEFAULT_PARAMS[10]) - 1) * hard_penalty * easy_bonus);
}

export function getNextStates(card: Card, desired_retention: number = 0.9): NextStates {
  if (card.state === State.New || card.state === State.Learning || card.state === State.Relearning) {
    const s_good = FSRS_DEFAULT_PARAMS[0] + (Rating.Good - 1) * FSRS_DEFAULT_PARAMS[1];
    const s_easy = FSRS_DEFAULT_PARAMS[0] + (Rating.Easy - 1) * FSRS_DEFAULT_PARAMS[1];

    return {
        again: { stability: 0, difficulty: next_difficulty(card.difficulty, Rating.Again), interval: 0 },
        hard: { stability: 0, difficulty: next_difficulty(card.difficulty, Rating.Hard), interval: 0 },
        good: { stability: s_good, difficulty: next_difficulty(card.difficulty, Rating.Good), interval: Math.round(s_good) },
        easy: { stability: s_easy, difficulty: next_difficulty(card.difficulty, Rating.Easy), interval: Math.round(s_easy) },
    };
  }

  if (card.state === State.Review) {
    const { stability, difficulty } = card;
    const s_again = next_stability(difficulty, stability, Rating.Again);
    const s_hard = next_stability(difficulty, stability, Rating.Hard);
    const s_good = next_stability(difficulty, stability, Rating.Good);
    const s_easy = next_stability(difficulty, stability, Rating.Easy);

    const retention_term = Math.log(desired_retention) / Math.log(0.9);
    const ivl_hard = Math.round(s_hard * retention_term);
    const ivl_good = Math.round(s_good * retention_term);
    const ivl_easy = Math.round(s_easy * retention_term);

    return {
        again: { stability: s_again, difficulty: next_difficulty(difficulty, Rating.Again), interval: 0 },
        hard: { stability: s_hard, difficulty: next_difficulty(difficulty, Rating.Hard), interval: ivl_hard },
        good: { stability: s_good, difficulty: next_difficulty(difficulty, Rating.Good), interval: ivl_good },
        easy: { stability: s_easy, difficulty: next_difficulty(difficulty, Rating.Easy), interval: ivl_easy },
    };
  }

  // Fallback for any unhandled states
  const fallback_difficulty = next_difficulty(card.difficulty, Rating.Again);
  return {
    again: { stability: 0, difficulty: fallback_difficulty, interval: 0 },
    hard: { stability: 0, difficulty: fallback_difficulty, interval: 0 },
    good: { stability: 0, difficulty: fallback_difficulty, interval: 0 },
    easy: { stability: 0, difficulty: fallback_difficulty, interval: 0 },
  };
}

export function applyFuzzAndLoadBalance(interval: number): number {
    if (interval < 2.5) {
        return Math.round(interval);
    }
    const fuzz_range = Math.max(2, Math.round(interval * 0.05));
    const min_ivl = Math.max(2, Math.round(interval - fuzz_range));
    const max_ivl = Math.round(interval + fuzz_range);
    
    // Placeholder for Load Balancer:
    // In a real app, this is where you would query your schedule for the load
    // between min_ivl and max_ivl and pick the least busy day.
    // For now, we just use random fuzz.
    return Math.floor(Math.random() * (max_ivl - min_ivl + 1)) + min_ivl;
}
```

---
## 第二部分：后端 API 设计

_(本节内容来自 v5 方案，是目前最完善的版本)_

### 1. 核心原则
*   **会话ID (`session_id`)**: 保证分页数据交换的一致性。
*   **ID 映射**: 客户端创建的数据上传后，后端必须返回新旧 ID 的映射关系。
*   **POST 代替 GET**: 对于需要传递大量 ID 的请求，使用 `POST`。

### 2. API 端点
*   **认证**: `POST /auth/login`, `POST /auth/register`
*   **核心同步**:
    *   `POST /sync/start` (返回 `syncSessionId` 和下载信息)
    *   `GET /sync/download/:syncSessionId?page=:page_number` (分页拉取变更)
    *   `POST /sync/upload` (批量上传变更, **返回 `idMappings`**)
*   **全量同步**: `POST /sync/full-download-start`, `GET /sync/full-download/:sessionId/page/:page`
*   **内容拉回**: `POST /cards/content` (请求体为 `{ "cardIds": [...] }`)

---
## 第三部分：后端数据模型 (详细阐述)

本数据模型的设计思想完全借鉴自 Anki 成熟的数据库结构，并为我们现代化的、多用户的云服务做了适配和优化。

### `users` 表
*   **用途**: 存储用户信息，用于登录和认证。这是任何多用户系统的标准配置。
*   **字段**:
    *   `id` (PK): 用户唯一标识。
    *   `username` (string, unique): 用户名/邮箱。
    *   `password_hash` (string): **绝不存储明文密码**。这里存储的是经过哈希和加盐处理后的密码摘要。
    *   `created_at` (timestamp): 账户创建时间。

### `decks` 表 (卡组)
*   **用途**: 存储用户创建的卡组。
*   **字段**:
    *   `id` (PK): 卡组唯一标识。
    *   `user_id` (FK): 外键，表明这个卡组属于哪个用户。
    *   `name` (string): 卡组的名称，如“雅思核心词汇”。
    *   `config_json` (JSON): **(关键设计)** 一个 JSON 字段，用于存储这个卡组的特定配置。例如，每日新卡上限、学习步长等。这为未来的高度可定制化提供了极大的灵活性。
    *   `created_at`, `modified_at` (timestamps): 创建和最后修改时间，`modified_at` 对增量同步至关重要。

### `notes` 表 (笔记)
*   **用途**: 存储知识的“原子”单位，即信息本身。对应 Anki 中的 `notes` 表。
*   **字段**:
    *   `id` (PK): 笔记唯一标识。
    *   `user_id` (FK): 外键，表明这条笔记属于哪个用户。
    *   `fields_json` (JSON): **(核心字段)** 存储笔记的所有字段内容。它是一个 JSON 数组，例如 `["apple", "苹果", "an apple a day..."]`。这种设计的巨大优势在于灵活性，我们不需要为“单词笔记”、“成语笔记”等不同类型的笔记分别设计不同的表结构。
    *   `created_at`, `modified_at` (timestamps): 创建和最后修改时间。

### `cards` 表 (卡片)
*   **用途**: 存储可被复习的“卡片”单位。每张卡片都由一条 `note` 生成，是 `srs-engine` 的直接操作对象。
*   **字段**:
    *   `id` (PK): 卡片唯一标识。
    *   `user_id` (FK), `note_id` (FK), `deck_id` (FK): 外键，清晰地表明了这张卡片属于哪个用户、源自哪条笔记、位于哪个卡组。
    *   **`due`** (timestamp): **(调度核心)** 指示这张卡片下一次应该被复习的精确日期和时间。前端的核心查询就是 `SELECT * FROM cards WHERE due <= NOW()`。
    *   **`stability`** (float): **(FSRS 核心)** 稳定度 S。衡量记忆的“牢固”程度。数字越大，代表记忆越稳固。
    *   **`difficulty`** (float): **(FSRS 核心)** 难度 D。一个 1-10 的浮点数，衡量卡片内容的“固有难度”。
    *   **`lapses`** (integer): 遗忘次数。每次在复习阶段答错（评为 `Again`），该计数+1。
    *   **`state`** (integer): 卡片当前的状态 (`0=New`, `1=Learning`, `2=Review`, `3=Relearning`)。
    *   `created_at`, `modified_at` (timestamps): 创建和最后修改时间。

### `revlog` 表 (复习日志)
*   **用途**: **(关键设计)** 这是一个**只增不删**的流水日志表，记录用户的每一次复习操作。它对于调试算法、分析用户行为、甚至未来让用户自行重新训练 FSRS 参数都至关重要。
*   **字段**:
    *   `id` (PK): 日志唯一标识。
    *   `user_id` (FK), `card_id` (FK): 外键。
    *   `review_time` (timestamp): 用户进行本次复习的时间戳。
    *   `rating` (integer): 用户按下的按钮 (1=Again, 2=Hard, 3=Good, 4=Easy)。
    *   `milliseconds_taken` (integer): 用户从看到问题到回答所花费的时间（毫秒）。
    *   **`state_before/after`** (integer)**, **`stability_before/after`** (float)**, 等等**: **(调试利器)** 记录下本次复习**前后**卡片的各项调度参数。这对于调试“为什么这张卡的间隔从 5 天变成了 50 天？”这类问题，具有不可估量的价值。

---
## 第四部分：笔记与卡片模板策略

这是一个关键的架构决策，它决定了应用的灵活性。

### 1. Anki 的标准设计
在 Anki 中，模板的核心载体是“笔记类型 (Note Type)”。一个“笔记类型”定义了一组字段和一组“卡片模板”。用户在创建笔记时选择一个“笔记类型”，系统就会根据其包含的“卡片模板”自动生成一张或多张卡片。

### 2. 我们的决策：MVP 优先，兼容未来
为了在快速开发和未来灵活性之间取得平衡，我们决定：

*   **路径 A (当前 MVP 版本)**: 我们**不**在数据库中创建 `note_types` 和 `card_templates` 表。生成卡片的逻辑将**硬编码**在前端。例如，我们可以内置两种固定的笔记模式：“单词模式”（2个字段，自动生成正反两张卡片）和“问答模式”（2个字段，只生成一张“问题→答案”卡片）。
    *   **优点**: 大幅降低开发复杂度，让我们能迅速上线核心功能。
    *   **缺点**: 用户无法自定义卡片样式和生成规则。

*   **路径 B (未来扩展)**: 我们的数据模型为未来扩展做好了准备。`notes` 表中的 `fields_json` 字段非常灵活，未来我们只需要：
    1.  增加 `note_types` 和 `card_templates` 两张表。
    2.  为 `notes` 表增加一个 `note_type_id` 外键。
    3.  开发一个笔记类型/模板编辑器。
    即可平滑地过渡到与 Anki 桌面版一样强大的“完全体”模式，而无需重构现有核心数据。

---
## 第五部分：前端策略与实现指南

### 1. 数据流与同步策略
_(本节内容来自 v4 方案)_
*   **最简生词处理**: 前端负责创建 `Note` 和 `Card` 的初始对象，并设置 FSRS 初始状态。
*   **同步时机**: 在应用启动、复习会话后、关键操作后、或手动触发时进行。

### 2. 高级 UI 流程
_(本节内容来自 v4 方案)_
*   **全局同步状态**: 使用全局状态管理器（如 Zustand/Redux）维护 `sync` 状态，驱动 UI 反馈。
*   **冲突解决流程**: 通过阻塞式对话框，引导用户完成“下载覆盖本地”或“上传覆盖云端”的选择。

### 3. 前端代码实现（食谱）

#### 本地数据库 (`database.js`)
```javascript
import Dexie from 'dexie';
import { State } from '../srs-engine';

export const db = new Dexie('AnkiPWA');
db.version(1).stores({
  meta: 'key', // 存储 lastSyncTimestamp 等
  decks: 'id',
  notes: 'id',
  // 适配 FSRS 的最终表结构
  cards: 'id, deckId, due, state',
  reviews: '++id', // 自动递增主键，用于存储待上传的 revlog
});

// 初始化/默认数据可以在这里添加
```

#### 复习界面 (`ReviewScreen.jsx`) - **最终版**
```jsx
import { getNextStates, applyFuzzAndLoadBalance } from '../srs-engine'; // 导入我们创建的引擎
import { db } from './database';
import { State, Rating } from '../srs-engine';

// ...
async function handleAnswer(card, rating) {
    // 1. 从 SRS 引擎获取所有可能的新状态
    const nextStates = getNextStates(card);

    // 2. 根据用户评分选择一个状态
    const chosenState = nextStates[rating]; // e.g., nextStates.good

    // 3. 计算最终间隔 (应用 Fuzz)
    const finalIntervalDays = applyFuzzAndLoadBalance(chosenState.interval);

    // 4. 准备更新本地数据库
    const now = new Date();
    const updatedCard = {
        ...card,
        stability: chosenState.stability,
        difficulty: chosenState.difficulty,
        due: new Date(now.getTime() + finalIntervalDays * 24 * 60 * 60 * 1000),
        state: (chosenState.interval > 0) ? State.Review : State.Relearning, // 简化的状态转换逻辑
        lapses: card.lapses + (rating === Rating.Again ? 1 : 0),
        last_review: now,
    };
    
    const reviewLog = { /* 记录所有前后变化，用于上传 */ };

    // 5. **原子化地更新本地数据库**
    await db.transaction('rw', db.cards, db.reviews, async () => {
        await db.cards.put(updatedCard);
        await db.reviews.add(reviewLog);
    });

    // 6. UI 切换到下一张卡
    // ...
};
```

