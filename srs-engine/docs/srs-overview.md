# Anki SRS 实现总览（Rust 伪代码）

> 常用缩写速查（按出现频率）  
> - SRS：Spaced Repetition System，间隔重复系统。  
> - SM2：SuperMemo 2 代算法，Anki 早期的间隔推算方法。  
> - FSRS：Free Spaced Repetition Scheduler，Ankitects 集成的新一代调度器。  
> - FSRSItem：FSRS 训练/预测的单条样本（包含一张卡的累积评分序列）。  
> - MemoryState：FSRS 的记忆状态（stability/difficulty）。  
> - Revlog：复习日志表（用户评分、间隔等历史记录）。  
> - DR / desired_retention：期望保持率，用于 FSRS 目标间隔计算。  
> - Decay：FSRS 衰减参数（不同 FSRS 版本有不同默认值）。  
> - Fuzz：对新间隔的随机扰动范围，防止整天堆叠。  
> - Load Balancer：负载均衡器，在 fuzz 范围内加权挑日以平摊每日量。  
> - NextStates：FSRS 预测的 again/hard/good/easy 下一状态（含 interval 与记忆态）。  
> - Lapse：遗忘计数，复习答错时递增。  
> - Easy Days：每周可配置的“轻松日”权重，用于负载均衡。  

本文件梳理 [Anki 代码库]( https://github.com/ankitects/anki)中 SRS（包括传统 SM2 风格与 FSRS）实现的核心位置与算法流程，并给出简化的 Rust 伪代码以便快速理解。

## 0. 面向“背单词”应用的落地建议（无历史包袱场景）
- **只用 FSRS，避免双轨**：直接采纳 FSRS 作为唯一调度器，省去 SM2 兼容层（代码里仍保留 SM2，未来若无需兼容可精简相关状态机）。
- **词源划分**：预制词表（如雅思核心）各自映射到独立 deck/preset；用户查词生成的“生词”可进入个人 deck，按最近添加时间建立默认学习顺序。
- **卡片模型**：建议 1–2 张卡/单词（如正面：英文→释义，反面：释义→英文），字段包含音标、例句、音频，方便未来做多模态提示。
- **默认参数**：使用官方 FSRS 参数起步；目标保持率（DR）可分组配置：考试核心词可设 0.9，零散生词设 0.85；暂不暴露复杂调优入口，只提供“高级”开关。
- **学习/再学习步长**：简化为 3–4 个分钟级步长（如 1m/10m/1d）；允许 FSRS 短期预测走亚日级复习，保证新词在当天内反复巩固。
- **负载与节奏**：开启 load balancer + fuzz，限制每日新词上限（如 20–40），并在周末应用 Easy Days 减负；个人生词默认不重排已过期的老词，避免惊扰用户节奏。
- **导入与持久化**：预制词表可按 deck 标签批量导入；生词由“查字典”入口写 revlog 时立即生成卡片并打上来源（search / clipboard / camera）。
- **统计与回路**：围绕 FSRS 记忆态与 DR 提供“预测留存”“今日复习量”与“高危词”（低稳定度）榜单；可用 `compute_optimal_retention` 做高级提示，但不必强制。

## 1. 代码位置速览
- FSRS 数据与训练：`rslib/src/scheduler/fsrs/params.rs`、`memory_state.rs`、`rescheduler.rs`、`retention.rs`
- 调度状态机（SM2/FSRS 融合）：`rslib/src/scheduler/states/*.rs`（`review.rs`、`learning.rs`、`relearning.rs`、`steps.rs`、`fuzz.rs`、`load_balancer.rs`）
- 卡片状态更新入口：`rslib/src/scheduler/answering/*.rs` 与 `service/answering.rs`

## 2. FSRS 数据管道与参数

### 2.1 Revlog 转 FSRSItem 过滤逻辑
来源：`reviews_for_fsrs(...)` 负责把每张卡的 revlog 过滤后转成 FSRSItem：
- 丢弃 cramming / 手动改期 / reset 之前的记录，按 `ignore_revlogs_before` 截断。
- 如果找不到有效用户评分或仅有被重置历史，返回 `None`。
- 训练模式下需要完整学习步骤；记忆态计算时允许落回 SM2 状态推断。

伪代码：
```rust
fn reviews_for_fsrs(entries, next_day_at, training, ignore_before) -> Option<ReviewsForFsrs> {
    entries = drop_cram_and_reset(entries, ignore_before);
    if training && !has_learning_steps(entries) { return None; }
    if !has_user_grade_after_cutoff(entries) { return None; }
    entries = entries.retain(|e| e.has_rating_and_affects_scheduling());
    let delta_t = diff_in_days(entries, next_day_at);
    Some(build_fsrs_items(entries, delta_t, training))
}
```

### 2.2 参数训练与评估
`Collection::compute_params`（`params.rs`）：
1. 通过 `revlog_for_srs` 获取符合搜索条件的 revlog。
2. 调 `fsrs_items_for_training` 生成训练样本与次数。
3. 用 `FSRS::compute_parameters` 训练；若新参数表现不优于旧参数会回退；可做健康检查（时间序列切分）。

伪代码：
```rust
fn compute_params(search, current_params) -> Params {
    let (items, review_count) = fsrs_items_for_training(revlogs, next_day_at, ignore_before);
    if items.is_empty() { return current_params; }
    let optimized = FSRS::new(None).compute_parameters(input(items));
    if eval(current_params) <= eval(optimized) { return current_params; }
    optimized
}
```

### 2.3 记忆状态写回与可选重排
`Collection::update_memory_state`（`memory_state.rs`）：
1. 为每个搜索集计算 FSRS 记忆态（若缺失历史，则 `memory_state_from_sm2` 推断）。
2. 把 decay/desired_retention 写入卡片，便于检索与统计。
3. 若启用“重新排程”，使用 `Rescheduler::find_interval` 基于负载平衡重新设 due，并记录 `Rescheduled` revlog。

伪代码：
```rust
fn update_memory_state(entries) {
    for entry in entries {
        let fsrs = FSRS::new(entry.params);
        let items = fsrs_items_for_memory_states(fsrs, revlog, next_day_at, hist_r, ignore_before);
        for (card, item) in items {
            if entry.params.is_none() { card.clear_fsrs_data(); continue; }
            card.set_memory_state(&fsrs, item, hist_r);
            card.desired_retention = deck_or_preset_retention(card);
            card.decay = decay_from_params(entry.params);
            if entry.reschedule { card.interval = choose_interval_with_load_balancer(...); }
            save_card_and_revlog(card);
        }
    }
}
```

### 2.4 负载均衡式重排
`Rescheduler::find_interval`（`rescheduler.rs`）：
- 在 fuzz 范围内枚举候选天数，结合当天已排量、周几限制（Easy Days）、以及是否逾期决定新间隔。
- 若找不到合适日子，落回标准 fuzz。

伪代码：
```rust
fn find_interval(target, min, max, days_elapsed) -> Option<u32> {
    let (low, high) = constrained_fuzz_bounds(target, min, max);
    if high < days_elapsed { return None; }
    let candidates = low..=high;
    let weights = candidates.map(|ivl| workload_score(ivl, today_load, weekday_mod));
    weighted_choice(candidates, weights, fuzz_seed)
}
```

### 2.5 最优保持率模拟
`compute_optimal_retention` / `get_optimal_retention_parameters`（`retention.rs`）调用 FSRS 模拟器，对给定参数和复习配置搜索保持率区间（结果被截断在 0.7–0.95）。

## 3. 调度状态机（SM2 + FSRS 结合）

### 3.1 状态上下文
`StateContext`（`states/mod.rs`）提供调度所需配置：学习步骤、间隔倍率、最大间隔、leech 阈值、FSRS 预测、负载均衡器与 fuzz 因子等。

### 3.2 ReviewState（间隔计算与易度调整）
文件：`states/review.rs`。核心逻辑：
- `passing_review_intervals`：若有 FSRS 预测，直接用 `NextStates` 给出的间隔并受最小/最大与 fuzz 限制；否则使用 SM2 核心公式，针对提前/按时/迟到区分。
- `answer_again`：增加 lapse，易度减 0.2，必要时进入 RelearnState；FSRS 情况下短期再学习可走 sub-day 间隔。
- `answer_hard/good/easy`：调整易度（Hard -0.15，Easy +0.15），并应用 fuzz/负载均衡。

示例（摘自 `review.rs`）：
```63:83:rslib/src/scheduler/states/review.rs
    pub(crate) fn next_states(self, ctx: &StateContext) -> SchedulingStates {
        let (hard_interval, good_interval, easy_interval) = self.passing_review_intervals(ctx);
        SchedulingStates {
            current: self.into(),
            again: self.answer_again(ctx),
            hard: self.answer_hard(hard_interval, ctx).into(),
            good: self.answer_good(good_interval, ctx).into(),
            easy: self.answer_easy(easy_interval, ctx).into(),
        }
    }
```

### 3.3 LearnState（学习步骤）
文件：`states/learning.rs`。逻辑：
- 学习步骤由 `LearningSteps` 提供（分钟）；Again 重置步数，Hard 停留当前/前一步，Good 前进一步，Easy 直接毕业。
- 若开启 FSRS 且预测间隔 < 0.5 天，可选择“短期 FSRS”路径（保持亚日级）。

示例：
```40:84:rslib/src/scheduler/states/learning.rs
    fn answer_again(self, ctx: &StateContext) -> CardState {
        let memory_state = ctx.fsrs_next_states.as_ref().map(|s| s.again.memory.into());
        if let Some(again_delay) = ctx.steps.again_delay_secs_learn() {
            LearnState { remaining_steps: ctx.steps.remaining_for_failed(), scheduled_secs: again_delay, elapsed_secs: 0, memory_state }.into()
        } else {
            let (minimum, maximum) = ctx.min_and_max_review_intervals(1);
            let (interval, short_term) = if let Some(states) = &ctx.fsrs_next_states {
                (states.again.interval, ctx.fsrs_allow_short_term && (ctx.fsrs_short_term_with_steps_enabled || ctx.steps.is_empty()) && states.again.interval < 0.5)
            } else {
                (ctx.graduating_interval_good as f32, false)
            };
            if short_term {
                LearnState { remaining_steps: ctx.steps.remaining_for_failed(), scheduled_secs: (interval * 86_400.0) as u32, elapsed_secs: 0, memory_state }.into()
            } else {
                ReviewState { scheduled_days: ctx.with_review_fuzz(interval.round().max(1.0), minimum, maximum), ease_factor: ctx.initial_ease_factor, memory_state, ..Default::default() }.into()
            }
        }
    }
```

### 3.4 RelearnState（遗忘后的再学习）
文件：`states/relearning.rs`。Again 触发 lapse，可能进入学习队列或直接复习，依赖 relearn 步骤与 FSRS 预测；Hard/Good 路径类似，但保持已有 review 间隔。

### 3.5 LearningSteps（步长规则）
文件：`states/steps.rs`。将配置的分钟步长转秒；Hard 首步有特殊“介于 Again/Good”规则；超过一天的步长会按整天取整以保持日内一致性。

### 3.6 Fuzz 与负载均衡
- `fuzz.rs`：基于区间大小给出对称 fuzz（2.5d 以下不 fuzz；>20d 每天再加 5% 权重），并裁剪到最小/最大间隔。
- `load_balancer.rs`：可选的负载均衡器在 fuzz 范围内按加权随机挑选目标日，权重考虑当天待复习量、周模式（Easy Days）、同笔记同日惩罚等。

示例：
```35:76:rslib/src/scheduler/states/fuzz.rs
    pub(crate) fn with_review_fuzz(&self, interval: f32, minimum: u32, maximum: u32) -> u32 {
        self.load_balancer_ctx
            .as_ref()
            .and_then(|load_balancer_ctx| load_balancer_ctx.find_interval(interval, minimum, maximum))
            .unwrap_or_else(|| with_review_fuzz(self.fuzz_factor, interval, minimum, maximum))
    }
```

```205:261:rslib/src/scheduler/states/load_balancer.rs
    fn find_interval(
        &self,
        interval: f32,
        minimum: u32,
        maximum: u32,
        deckconfig_id: DeckConfigId,
        fuzz_seed: Option<u64>,
        note_id: Option<NoteId>,
    ) -> Option<u32> {
        if interval as usize > MAX_LOAD_BALANCE_INTERVAL || minimum as usize > MAX_LOAD_BALANCE_INTERVAL {
            return None;
        }
        let (before_days, after_days) = constrained_fuzz_bounds(interval, minimum, maximum);
        let days = self.days_by_preset.get(&deckconfig_id)?;
        let interval_days = &days[before_days as usize..=after_days as usize];
        let (review_counts, weekdays): (Vec<usize>, Vec<usize>) = interval_days.iter().enumerate().map(|(i, day)| (day.cards.len(), interval_to_weekday(i as u32 + before_days, self.next_day_at))).unzip();
        let easy_days_load = self.easy_days_percentages_by_preset.get(&deckconfig_id)?;
        let easy_days_modifier = calculate_easy_days_modifiers(easy_days_load, &weekdays, &review_counts);
        let intervals = interval_days.iter().enumerate().map(|(interval_index, interval_day)| LoadBalancerInterval {
            target_interval: interval_index as u32 + before_days,
            review_count: review_counts[interval_index],
            sibling_modifier: note_id.and_then(|note_id| interval_day.has_sibling(&note_id).then_some(SIBLING_PENALTY)).unwrap_or(1.0),
            easy_days_modifier: easy_days_modifier[interval_index],
        });
        select_weighted_interval(intervals, fuzz_seed)
    }
```

## 4. 实际调用链概览
1. **队列/取卡**：`scheduler/queue/*` 构建新/学/复习队列。
2. **答题**：前端发送 `CardAnswer`（`service/answering.rs` 转换）→ `CardStateUpdater` 计算当前 `CardState`（`answering/current.rs`），再根据按钮选择目标状态（`states/*.rs`）。
3. **状态落地**：`apply_*_state` 将新状态写回卡片属性（due/interval/ease_factor/memory_state）并生成 `RevlogEntry`。
4. **FSRS 更新**：后台任务或用户触发“计算 FSRS/记忆状态/最优保持率”走第 2 章的管道。

## 5. 关键点速记
- 传统 SM2 逻辑仍保留，但若卡片具备 FSRS 记忆态，则优先使用 FSRS 的 `NextStates` 与记忆状态更新。
- 早于到期的复习使用特殊“提前复习”公式避免过度奖励；迟到复习则在 SM2 中增加实际间隔的惩罚/奖励。
- Fuzz 与负载均衡贯穿所有间隔选择；若启用 FSRS 重排，负载均衡使用实际 due 分布与 Easy Days 权重重新挑选日子。
- 记忆态缺失时，会从当前 SM2 参数（易度/间隔）推断初始 FSRS 状态，避免空白。

---
如需进一步追踪，可直接跳转至上述路径查阅实现代码。旁路探索：`fsrs::FSRS` 的具体数学模型位于外部 crate（本仓库通过 FFI/依赖使用）。

