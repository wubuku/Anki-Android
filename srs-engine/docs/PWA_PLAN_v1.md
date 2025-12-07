# PWA 背单词应用实现方案

## 第零部分：调研、原理与设计哲学

本方案的设计深受 Anki 架构的启发。在正式进入技术方案之前，有必要首先阐述我们从 Anki-Android 代码库中提炼出的核心概念与设计原则，它们是我们后续 API 和前端设计的基石。

### 1. Anki 核心概念解析

Anki 的核心是其数据模型和调度算法。我们的分析证实了关键逻辑主要存在于 `libanki` 模块中。为了构建一个体验类似 Anki 的应用，我们必须理解它的基本构建块。

*   **笔记 (Note)**：
    *   **概念**：`Note` 是信息的基本单位，而不是您学习的卡片。一个 `Note` 包含多个字段（Fields），例如“正面”、“背面”、“注释”、“发音”等。它本身是不可复习的。
    *   **Anki-Android 实现**: `libanki/src/main/java/com/ichi2/libanki/Note.java`
    *   **关键发现**: 我们的应用应该区分“知识条目（Notes）”和“复习卡片（Cards）”这两个概念。用户添加的是 Notes，而实际背的是 Cards。

*   **卡片 (Card)**：
    *   **概念**：`Card` 是您实际学习的东西，是“一次输入，多次测验”思想的体现。它是系统根据 `Note` 中存储的信息，通过预设的“卡片模板 (Card Template)”自动生成的。这个过程分为几步：
        1.  **定义信息条目 (Note)**: 用户创建一个 `Note`，其中包含多个“字段 (Fields)”，如 `English: book`, `Chinese: 书`, `Sentence: I am reading a book.`。这只是原始数据。
        2.  **创建测验模板 (Card Templates)**: 用户可以定义多个模板，来决定如何被测验。例如：
            *   **模板A (英->中)**: 卡片正面显示 `English` 字段，背面显示 `Chinese` 字段。
            *   **模板B (中->英)**: 卡片正面显示 `Chinese` 字段，背面显示 `English` 字段。
        3.  **自动生成卡片 (Cards)**: 当保存这个 `Note` 后，系统会根据以上两个模板，自动生成两张独立的 `Card`。一张考验 `book` -> `书`，另一张考验 `书` -> `book`。
        最关键的是，这两张 `Card` 虽然源自同一个 `Note`，但它们的学习进度（如下次复习时间、熟练度等）是完全分开独立计算的。
    *   **Anki-Android 实现**: `libanki/src/main/java/com/ichi2/libanki/Card.java`
    *   **关键发现**：这种“数据与视图分离”的设计非常强大。我们的 PWA 可以让用户只录入一次单词信息（Note），然后自动生成多种学习模式（Cards），极大地提升了学习效率和记忆深度。

*   **卡组 (Deck)**：
    *   **概念**：`Deck` 就是一个卡片的集合。用户学习时是按卡组进行的。
    *   **Anki-Android 实现**: `libanki/src/main/java/com/ichi2/libanki/Deck.java`
    *   **关键发现**：卡组是用户组织学习内容的基本方式，我们的 API 和前端设计必须支持卡组的创建、重命名、删除和选择。

*   **复习日志 (revlog)**:
    *   **概念**: 这是一个记录表，存储每一次的复习历史，包括复习的卡片 ID、时间、用户的按键（重来/困难/良好/简单）、以及卡片在复习前后的状态（间隔时间、Ease 因子等）。
    *   **关键发现**: 详尽的复习日志对于追踪用户进度、调试算法甚至未来的数据分析都至关重要。我们的后端需要一个类似的表。

### 2. 间隔重复算法 (SRS)

这是 Anki 用户体验的“灵魂”。

*   **调度器 (Scheduler)**：
    *   **概念**：当您复习一张卡片并根据难度进行评分后，`Scheduler` 会使用一个复杂的算法来计算这张卡片下一次应该出现的时间。所有关于“下一次何时复习”的逻辑都封装在 `Scheduler` 类中。
    *   **Anki-Android 实现**: `libanki/src/main/java/com/ichi2/libanki/Scheduler.java`
    *   **关键发现**：Anki 的调度算法相当复杂，涉及多种卡片状态（新、学习、复习、延误）和转换。为了快速实现我们的 PWA，后端可以先实现一个简化版的调度器，处理核心的“良好”（增加间隔）和“重来”（重置间隔）逻辑。**前端不需要也不应该实现这个算法**，它只需将用户的操作（点击了哪个按钮）和卡片 ID 发送给后端即可。

### 3. 数据同步逻辑

Anki 的同步机制非常成熟，是我们设计中最宝贵的借鉴财富。

*   **基于 USN (Update Sequence Number) 的增量同步**:
    *   **概念**: Anki 不会在每次同步时都传输所有数据。相反，本地和服务器上的每一条数据的每次变更都会被分配一个唯一的、递增的 USN。同步过程可以简化为：“你好服务器，我最后一次同步的 USN 是 X，请把所有 USN 大于 X 的变更都发给我。” 然后客户端再把自己本地发生的变更发给服务器。
    *   **关键发现**: 这是我们 API 设计的“金钥匙”。通过在核心数据表上引入类似 `mod` (modification time) 或 `usn` 的字段，我们的 PWA 就能实现高效、快速的增量同步，极大提升用户体验，并为离线使用打下坚实基础。这也正是我们 API 设计中 `NORMAL_SYNC` 模式的理论基础。

---

## 第一部分：后端 RESTful API 设计 (v1)

### 1. 认证 (Authentication)

#### `POST /auth/login`
- **功能**: 用户使用用户名和密码登录，获取认证令牌。
- **请求体**:
  ```json
  {
    "username": "user@example.com",
    "password": "your_password"
  }
  ```
- **成功响应 (200 OK)**:
  ```json
  {
    "userId": "user_id_123",
    "username": "user@example.com",
    "authToken": "a_long_and_secure_token_string",
    "tokenExpiresAt": "2026-12-06T10:00:00Z"
  }
  ```
- **失败响应 (401 Unauthorized)**:
  ```json
  {
    "error": "Invalid credentials"
  }
  ```

#### `POST /auth/register`
- **功能**: 创建一个新用户。
- **请求体**:
  ```json
  {
    "username": "user@example.com",
    "password": "a_strong_password"
  }
  ```
- **成功响应 (201 Created)**: (响应体同登录成功)

### 2. 核心同步 (Core Sync)

这是整个应用最核心的部分。它不是简单的获取数据，而是一个“会话式”的过程。

#### `POST /sync/start`
- **功能**: 客户端发起一个同步会话。
- **需要认证**: 是
- **请求体**:
  ```json
  {
    "lastSyncTimestamp": "2025-12-07T08:30:00Z" // ISO 8601 格式, 如果是首次同步则为 null
  }
  ```
- **响应 (200 OK)**: 服务器根据客户端和服务器的状态，返回下一步的指令。
  - **情况一: 一切同步**
    ```json
    {
      "status": "NO_CHANGES",
      "serverMessage": "Everything is up to date."
    }
    ```
  - **情况二: 常规同步 (有变更)**
    ```json
    {
      "status": "NORMAL_SYNC",
      "serverTimestamp": "2025-12-07T09:00:00Z",
      "to_upload": {
        "notes": ["note_id_local_1", "note_id_local_2"],
        "cards": ["card_id_local_1"],
        "reviews": ["review_id_local_1"]
      },
      "to_download": {
         "notes": [
            // ... 完整的 Note 对象列表
         ],
         "cards": [
            // ... 完整的 Card 对象列表
         ],
         "reviews": [
            // ... 完整的 Review 对象列表
         ]
      }
    }
    ```
    *说明: `to_upload` 告诉客户端哪些本地数据是服务器没有的，客户端需要在后续请求中上传它们。`to_download` 则直接把服务器上更新的数据发给客户端。*
  - **情况三: 冲突，需要用户选择**
    ```json
    {
      "status": "CONFLICT",
      "serverMessage": "Your local data and server data have both changed. Please choose how to proceed."
    }
    ```
  - **情况四: 需要全量下载**
    ```json
    {
      "status": "FULL_DOWNLOAD_REQUIRED"
    }
    ```
  - **情况五: 需要全量上传**
    ```json
    {
      "status": "FULL_UPLOAD_REQUIRED"
    }
    ```

#### `POST /sync/upload`
- **功能**: 在 `NORMAL_SYNC` 流程中，上传客户端的变更数据。
- **需要认证**: 是
- **请求体**:
  ```json
  {
    "notes": [
      // ...本地新增/修改的 Note 对象
    ],
    "reviews": [
      // ...本地新增的 ReviewLog 对象
    ]
  }
  ```
- **成功响应 (200 OK)**:
  ```json
  {
    "status": "UPLOAD_SUCCESS"
  }
  ```

### 3. 全量同步 (Full Sync)

#### `POST /sync/full-download`
- **功能**: 当发生冲突且用户选择“从服务器下载”，或服务器要求全量下载时调用。
- **需要认证**: 是
- **成功响应 (200 OK)**:
  ```json
  {
    "serverTimestamp": "2025-12-07T09:00:00Z",
    "all_data": {
      "notes": [ /* ... 所有 Note ... */ ],
      "cards": [ /* ... 所有 Card ... */ ],
      "decks": [ /* ... 所有 Deck ... */ ],
      "reviews": [ /* ... 所有 Review ... */ ]
    }
  }
  ```

#### `POST /sync/full-upload`
- **功能**: 当发生冲突且用户选择“上传到服务器”，或服务器要求全量上传时调用。
- **需要认证**: 是
- **请求体**:
  ```json
  {
    "all_data": {
      "notes": [ /* ... */ ],
      "cards": [ /* ... */ ],
      "decks": [ /* ... */ ],
      "reviews": [ /* ... */ ]
    }
  }
  ```
- **成功响应 (200 OK)**:
  ```json
  {
    "status": "FULL_UPLOAD_SUCCESS"
  }
  ```

### 4. 媒体同步 (Media Sync)

#### `POST /media/list-missing`
- **功能**: 客户端告诉服务器它本地有哪些媒体文件，服务器返回客户端缺失的文件列表。
- **需要认证**: 是
- **请求体**:
  ```json
  {
    "localMediaFiles": ["image1.jpg", "sound2.mp3"]
  }
  ```
- **成功响应 (200 OK)**:
  ```json
  {
    "missing_on_client": ["image3.jpg", "sound4.mp3"],
    "missing_on_server": ["image1.jpg"]
  }
  ```

#### `GET /media/{filename}`
- **功能**: 下载一个媒体文件。
- **需要认证**: 是
- **响应**: 文件的二进制流 (`image/jpeg`, `audio/mpeg`, etc.)

#### `POST /media/upload`
- **功能**: 上传一个媒体文件。通常使用 `multipart/form-data`。
- **需要认证**: 是
- **请求体**: `multipart/form-data` with a file part.
- **成功响应 (200 OK)**:
  ```json
  {
    "filename": "image1.jpg",
    "url": "/media/image1.jpg"
  }
  ```

### 5. 复习 (Reviewing)

#### `GET /review/due-cards`
- **功能**: 获取今天所有到期的卡片。
- **需要认证**: 是
- **查询参数**: `?deckId=deck_id_123` (可选, 如果不提供则返回所有卡组的)
- **成功响应 (200 OK)**:
  ```json
  {
    "dueCards": [
      // ... Card 对象的列表
    ]
  }
  ```

#### `POST /review/answer`
- **功能**: 用户对一张卡片回答后，将结果提交给后端。**这是驱动 SRS 算法的核心 API**。
- **需要认证**: 是
- **请求体**:
  ```json
  {
    "cardId": "card_id_abc",
    "rating": "good" // "again", "hard", "good", "easy"
  }
  ```
- **成功响应 (200 OK)**:
  ```json
  {
    "reviewLog": {
      "id": "review_log_id_789",
      "cardId": "card_id_abc",
      "rating": "good",
      "reviewTimestamp": "2025-12-07T09:05:00Z",
      "previousInterval": 3, // days
      "newInterval": 10, // days
      // ... 其他由 SRS 算法计算出的字段
    }
  }
  ```

---

## 第二部分：前端实现手册 (v1)

本手册提供 PWA 前端的关键实现代码，以 **React** 和 **Zustand** (一个轻量状态管理库) 为例。核心思想可以轻松迁移到 Vue/Pinia 等技术栈。

### 1. 本地数据库 (`src/database.js`)

我们使用 `Dexie.js`，一个强大的 IndexedDB 包装库。

```bash
npm install dexie
```

```javascript
// src/database.js
import Dexie from 'dexie';

export const db = new Dexie('AnkiPWA');

// 定义数据表和索引
// 'id' 是主键
// 'mod' 是修改时间戳，用于同步
// 'usn' (Update Sequence Number) 也是 Anki 用的一个同步标记，我们这里用 mod 简化
db.version(1).stores({
  notes: 'id, mod',
  cards: 'id, noteId, deckId, due, mod',
  decks: 'id, mod',
  reviews: 'id, cardId, mod', // 存储还未上传到服务器的复习记录
  meta: 'key', // 存储 app 的元信息，如 lastSyncTimestamp
});

// meta 表的辅助函数
export const getMeta = (key) => db.meta.get(key).then(entry => entry?.value);
export const setMeta = (key, value) => db.meta.put({ key, value });
```

### 2. API 客户端 (`src/api.js`)

一个简单的 `fetch` 包装器，用于自动附加认证头和处理 JSON。

```javascript
// src/api.js
import { useAuthStore } from './store'; // 假设你有一个存储 auth token 的 store

const BASE_URL = 'https://your-api-backend.com/api'; // 你的后端 API 地址

async function request(endpoint, options = {}) {
  const authToken = useAuthStore.getState().token;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// 导出具体的 API 调用函数
export const api = {
  login: (username, password) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  startSync: (lastSyncTimestamp) => request('/sync/start', {
    method: 'POST',
    body: JSON.stringify({ lastSyncTimestamp }),
  }),
  // ... 其他 API 函数
  postReview: (cardId, rating) => request('/review/answer', {
      method: 'POST',
      body: JSON.stringify({ cardId, rating }),
  }),
};
```

### 3. 复习界面组件 (`src/components/ReviewScreen.jsx`)

```jsx
// src/components/ReviewScreen.jsx
import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../database';
import { api } from '../api';

export function ReviewScreen({ deckId }) {
  // 从本地数据库实时查询到期的卡片
  const dueCards = useLiveQuery(
    () => db.cards.where('deckId').equals(deckId).and(card => card.due <= Date.now()).toArray(),
    [deckId]
  );

  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  if (!dueCards) {
    return <div>Loading cards...</div>;
  }
  
  if (dueCards.length === 0) {
      return <div>No due cards in this deck. Well done!</div>
  }

  const currentCard = dueCards[cardIndex];
  // 假设 Note 的内容存储在 card 对象的 front/back 字段里
  // 实际应用中可能需要根据 card.noteId 去 notes 表里查询
  const { front, back } = currentCard; 

  const handleAnswer = async (rating) => {
    // 1. 调用 API，让后端处理 SRS 算法
    await api.postReview(currentCard.id, rating);
    // 2. 将复习记录存入本地 (用于上传)
    //    这里的 mod 和 id 最好由客户端生成，例如 uuid + timestamp
    await db.reviews.add({ id: self.crypto.randomUUID(), cardId: currentCard.id, rating, mod: Date.now() });

    // 3. 更新卡片的 due 日期 (理想情况下后端会返回新的 due, 这里做个简单模拟)
    //    一个更稳健的做法是，在同步时，由服务器下发所有卡片的最新状态
    const oneDay = 24 * 60 * 60 * 1000;
    const nextDueDate = rating === 'again' ? Date.now() + 60000 : Date.now() + oneDay;
    await db.cards.update(currentCard.id, { due: nextDueDate });

    // 4. 切换到下一张卡
    setIsFlipped(false);
    if (cardIndex < dueCards.length - 1) {
        setCardIndex(cardIndex + 1);
    } else {
        // 复习完毕
        alert("Deck complete!");
    }
  };

  return (
    <div>
      <div className="card-display">
        <div className="card-front">{front}</div>
        {isFlipped && <div className="card-back">{back}</div>}
      </div>

      {!isFlipped ? (
        <button onClick={() => setIsFlipped(true)}>Show Answer</button>
      ) : (
        <div className="answer-buttons">
          <button onClick={() => handleAnswer('again')}>Again</button>
          <button onClick={() => handleAnswer('hard')}>Hard</button>
          <button onClick={() => handleAnswer('good')}>Good</button>
          <button onClick={() => handleAnswer('easy')}>Easy</button>
        </div>
      )}
    </div>
  );
}
```

### 4. 同步管理器 (`src/SyncManager.js`)

这是最关键的逻辑，协调 API 和本地数据库。

```javascript
// src/SyncManager.js
import { db, getMeta, setMeta } from './database';
import { api } from './api';
// 假设你有一个 UI store 来通知用户
import { useUIStore } from './store';

export async function runSync() {
  const setSyncStatus = useUIStore.getState().setSyncStatus;

  try {
    setSyncStatus('syncing');
    const lastSyncTimestamp = await getMeta('lastSyncTimestamp');

    const response = await api.startSync(lastSyncTimestamp);

    switch (response.status) {
      case 'NO_CHANGES':
        setSyncStatus('idle');
        break;

      case 'NORMAL_SYNC':
        // 1. 下载服务器的变更
        if (response.to_download) {
            await db.transaction('rw', db.notes, db.cards, async () => {
                if(response.to_download.notes) await db.notes.bulkPut(response.to_download.notes);
                if(response.to_download.cards) await db.cards.bulkPut(response.to_download.cards);
            });
        }
        
        // 2. 上传客户端的变更
        const notesToUpload = await db.notes.where('mod').above(lastSyncTimestamp || 0).toArray();
        const reviewsToUpload = await db.reviews.toArray(); // 上传所有未同步的复习记录
        
        await api.uploadChanges({ notes: notesToUpload, reviews: reviewsToUpload });
        
        // 3. 清空已上传的复习记录
        await db.reviews.clear();

        // 4. 更新同步时间戳
        await setMeta('lastSyncTimestamp', response.serverTimestamp);
        setSyncStatus('idle');
        break;

      case 'CONFLICT':
        setSyncStatus('conflict'); // UI 层需要弹窗让用户选择
        break;

      case 'FULL_DOWNLOAD_REQUIRED':
        await handleFullDownload();
        setSyncStatus('idle');
        break;
        
      case 'FULL_UPLOAD_REQUIRED':
        await handleFullUpload();
        setSyncStatus('idle');
        break;
    }
  } catch (error) {
    console.error("Sync failed:", error);
    setSyncStatus('error');
  }
}

async function handleFullDownload() {
    const { serverTimestamp, all_data } = await api.fullDownload();
    await db.transaction('rw', [db.notes, db.cards, db.decks, db.reviews, db.meta], async () => {
        // 清空所有本地数据
        await Promise.all([db.notes.clear(), db.cards.clear(), db.decks.clear(), db.reviews.clear()]);
        // 写入服务器下发的数据
        await db.notes.bulkPut(all_data.notes);
        await db.cards.bulkPut(all_data.cards);
        await db.decks.bulkPut(all_data.decks);
        // 更新同步时间戳
        await setMeta('lastSyncTimestamp', serverTimestamp);
    });
}

// handleFullUpload 与此类似，但方向相反
```
