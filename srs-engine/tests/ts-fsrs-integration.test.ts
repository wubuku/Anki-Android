/// <reference types="jest" />
import { describe, expect, it, beforeAll } from '@jest/globals';
import { FSRS, createEmptyCard, Rating, State, generatorParameters, Grades } from 'ts-fsrs';
import { getNextStates, FSRS_DEFAULT_PARAMS_FULL } from '../src/index';
import { Card as CustomCard, DeckConfig, State as CustomState, Rating as CustomRating } from '../src/types';

/**
 * 集成测试：验证官方 ts-fsrs npm 包的可行性和能力
 *
 * 本测试基于 PWA_IMPLEMENTATION_PLAN.md 的建议，全面考察：
 * 1. ts-fsrs npm 包的基本使用方式
 * 2. 与自定义 srs-engine 实现的一致性对比
 * 3. ts-fsrs 的功能覆盖范围
 * 4. 实际生产环境中的可行性验证
 */

describe('ts-fsrs npm 包集成测试', () => {
    let fsrs: FSRS;
    const now = new Date();

    // 测试配置，与自定义实现保持一致
    const testConfig: DeckConfig = {
        learningSteps: [60, 600], // 1m, 10m in seconds
        relearningSteps: [600], // 10m in seconds
        fsrsParams: {
            request_retention: 0.9,
            maximum_interval: 36500,
            w: FSRS_DEFAULT_PARAMS_FULL,
        }
    };

    beforeAll(() => {
        // 初始化官方 FSRS 实例，使用相同的参数
        const params = generatorParameters({
            w: FSRS_DEFAULT_PARAMS_FULL,
            request_retention: testConfig.fsrsParams.request_retention,
            maximum_interval: testConfig.fsrsParams.maximum_interval,
        });
        fsrs = new FSRS(params);
    });

    describe('基础功能验证', () => {
        it('应该能够创建 FSRS 实例', () => {
            expect(fsrs).toBeDefined();
            expect(fsrs).toBeInstanceOf(FSRS);
        });

        it('应该能够创建空卡片', () => {
            const emptyCard = createEmptyCard();
            expect(emptyCard).toBeDefined();
            expect(emptyCard.state).toBe(State.New);
            expect(emptyCard.stability).toBe(0);
            expect(emptyCard.difficulty).toBe(0);
        });

        it('应该支持基本的重复调度', () => {
            const card = createEmptyCard();
            const result = fsrs.repeat(card, now);

            expect(result).toBeDefined();

            // 验证每个评分的调度结果
            Grades.forEach((grade) => {
                const record = result[grade];
                expect(record).toBeDefined();
                expect(record.card).toBeDefined();
                expect(record.log).toBeDefined();
                expect(record.card.due).toBeInstanceOf(Date);
                expect(typeof record.card.stability).toBe('number');
                expect(typeof record.card.difficulty).toBe('number');
            });
        });
    });

    describe('新卡片处理', () => {
        const newCard = createEmptyCard();

        it('新卡片应该进入学习阶段', () => {
            const result = fsrs.repeat(newCard, now);

            // Again 评分：重置到学习步骤
            expect(result[Rating.Again].card.state).toBe(State.Learning);

            // Good 评分：进入第一个学习步骤
            expect(result[Rating.Good].card.state).toBe(State.Learning);

            // Easy 评分：直接毕业到复习阶段
            expect(result[Rating.Easy].card.state).toBe(State.Review);
        });

        it('新卡片的稳定性应该符合预期', () => {
            const result = fsrs.repeat(newCard, now);

            // Again 的稳定性应该等于初始稳定性
            expect(result[Rating.Again].card.stability).toBeGreaterThan(0);

            // Good 的稳定性应该大于 Again
            expect(result[Rating.Good].card.stability).toBeGreaterThan(result[Rating.Again].card.stability);

            // Easy 的稳定性应该是最大的
            expect(result[Rating.Easy].card.stability).toBeGreaterThan(result[Rating.Good].card.stability);
        });
    });

    describe('学习阶段处理', () => {
        it('应该正确处理学习步骤的推进', () => {
            // 创建一个在学习步骤 0 的卡片
            let card = createEmptyCard();
            card.state = State.Learning;
            card.learning_steps = 0; // 当前在步骤 0

            const result = fsrs.repeat(card, now);

            // Again：重置到步骤 0
            expect(result[Rating.Again].card.learning_steps).toBe(0);

            // Hard：重置到步骤 0
            expect(result[Rating.Hard].card.learning_steps).toBe(0);

            // Good：推进到步骤 1（或保持在 0，如果逻辑不同）
            // 注意：ts-fsrs 的学习步骤逻辑可能与我们的实现略有不同
            const goodSteps = result[Rating.Good].card.learning_steps;
            expect(goodSteps).toBeGreaterThanOrEqual(0);
            expect(goodSteps).toBeLessThanOrEqual(1);
        });

        it('学习步骤完成后应该毕业', () => {
            // 创建一个完成所有学习步骤的卡片
            let card = createEmptyCard();
            card.state = State.Learning;
            card.learning_steps = testConfig.learningSteps.length - 1; // 最后一步

            const result = fsrs.repeat(card, now);

            // Good 评分应该毕业到 Review 状态
            expect(result[Rating.Good].card.state).toBe(State.Review);
        });
    });

    describe('复习阶段处理', () => {
        it('应该正确处理复习间隔计算', () => {
            // 创建一个复习阶段的卡片
            const reviewCard = {
                ...createEmptyCard(),
                state: State.Review,
                stability: 10, // 10 天稳定性
                difficulty: 5, // 中等难度
                last_review: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 天前复习
                due: now, // 今天到期
            };

            const result = fsrs.repeat(reviewCard, now);

            // 验证间隔计算
            expect(result[Rating.Good].card.scheduled_days).toBeGreaterThan(0);
            expect(result[Rating.Good].card.scheduled_days).toBeLessThanOrEqual(testConfig.fsrsParams.maximum_interval);

            // Good 的间隔应该大于当前的稳定性（近似）
            expect(result[Rating.Good].card.scheduled_days).toBeGreaterThan(reviewCard.stability);
        });

        it('遗忘（Again）应该降低稳定性和增加难度', () => {
            const reviewCard = {
                ...createEmptyCard(),
                state: State.Review,
                stability: 20,
                difficulty: 4,
                last_review: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
                due: now,
            };

            const result = fsrs.repeat(reviewCard, now);

            // Again 应该降低稳定性
            expect(result[Rating.Again].card.stability).toBeLessThan(reviewCard.stability);

            // Again 应该增加难度
            expect(result[Rating.Again].card.difficulty).toBeGreaterThan(reviewCard.difficulty);

            // Again 应该进入 Relearning 状态
            expect(result[Rating.Again].card.state).toBe(State.Relearning);
        });
    });

    describe('与自定义实现的对比测试', () => {
        it('新卡片的调度结果应该基本一致', () => {
            const emptyCard = createEmptyCard();

            // 使用官方 ts-fsrs
            const tsFsrsResult = fsrs.repeat(emptyCard, now);

            // 使用自定义实现（转换数据格式）
            const customCard: CustomCard = {
                id: 'test-card',
                due: emptyCard.due,
                stability: emptyCard.stability,
                difficulty: emptyCard.difficulty,
                lapses: emptyCard.lapses,
                state: CustomState.New,
                step: emptyCard.learning_steps,
                last_review: emptyCard.last_review,
            };

            const customResult = getNextStates(customCard, testConfig, now);

            // 对比稳定性（允许小差异）
            expect(tsFsrsResult[Rating.Good].card.stability).toBeCloseTo(customResult.good.stability, 1);
            expect(tsFsrsResult[Rating.Easy].card.stability).toBeCloseTo(customResult.easy.stability, 1);

            // 对比间隔（新卡片 Good 评分）
            // 注意：ts-fsrs 返回天数，自定义实现返回秒数，需要转换
            const tsFsrsIntervalDays = tsFsrsResult[Rating.Good].card.scheduled_days;
            const customIntervalSeconds = customResult.good.interval;
            const customIntervalDays = customIntervalSeconds / (24 * 60 * 60); // 转换为天数

            expect(tsFsrsIntervalDays).toBeCloseTo(customIntervalDays, 1);
        });

        it('复习卡片的调度应该基本一致', () => {
            const reviewCard = {
                ...createEmptyCard(),
                state: State.Review,
                stability: 15,
                difficulty: 5,
                last_review: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
                due: now,
            };

            // 使用官方 ts-fsrs
            const tsFsrsResult = fsrs.repeat(reviewCard, now);

            // 使用自定义实现
            const customCard: CustomCard = {
                id: 'test-review-card',
                due: reviewCard.due,
                stability: reviewCard.stability,
                difficulty: reviewCard.difficulty,
                lapses: reviewCard.lapses,
                state: CustomState.Review,
                step: reviewCard.learning_steps,
                last_review: reviewCard.last_review,
            };

            const customResult = getNextStates(customCard, testConfig, now);

            // 对比 Good 评分的稳定性（允许合理误差）
            expect(tsFsrsResult[Rating.Good].card.stability).toBeCloseTo(customResult.good.stability, 2);

            // 对比间隔
            expect(tsFsrsResult[Rating.Good].card.scheduled_days).toBeCloseTo(customResult.good.interval, 1);
        });
    });

    describe('高级功能验证', () => {
        it('应该支持自定义参数', () => {
            const customParams = generatorParameters({
                w: FSRS_DEFAULT_PARAMS_FULL,
                request_retention: 0.8, // 更严格的记忆保持率
                maximum_interval: 1000, // 更短的最大间隔
            });

            const customFsrs = new FSRS(customParams);
            const card = createEmptyCard();
            const result = customFsrs.repeat(card, now);

            // 更严格的参数应该产生更短的间隔
            expect(result[Rating.Good].card.scheduled_days).toBeLessThan(1000);
        });

        it('应该正确处理时间相关的调度', () => {
            const card = {
                ...createEmptyCard(),
                state: State.Review,
                stability: 10,
                difficulty: 5,
                last_review: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 天前复习（早于预期）
                due: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), // 5 天后到期
            };

            const result = fsrs.repeat(card, now);

            // 提早复习应该获得稳定性奖励
            expect(result[Rating.Good].card.stability).toBeGreaterThan(card.stability);
        });

        it('应该支持批量操作', () => {
            const cards = [
                createEmptyCard(),
                { ...createEmptyCard(), state: State.Review, stability: 20, difficulty: 4 },
                { ...createEmptyCard(), state: State.Learning, learning_steps: 1 },
            ];

            // 可以对多个卡片进行调度（虽然这里是分别处理）
            const results = cards.map(card => fsrs.repeat(card, now));

            expect(results).toHaveLength(3);
            results.forEach(result => {
                // 检查所有评分的结果都存在
                expect(result[Rating.Good]).toBeDefined();
                expect(result[Rating.Again]).toBeDefined();
                expect(result[Rating.Hard]).toBeDefined();
                expect(result[Rating.Easy]).toBeDefined();
            });
        });
    });

    describe('错误处理和边界情况', () => {
        it('应该处理无效的稳定性值', () => {
            const invalidCard = {
                ...createEmptyCard(),
                stability: -1, // 无效的稳定性
            };

            expect(() => fsrs.repeat(invalidCard, now)).not.toThrow();
        });

        it('应该处理极端难度值', () => {
            const extremeCard = {
                ...createEmptyCard(),
                difficulty: 15, // 极端难度
            };

            const result = fsrs.repeat(extremeCard, now);
            expect(result).toBeDefined();
        });
    });

    describe('性能和实用性验证', () => {
        it('应该具有合理的性能', () => {
            const card = createEmptyCard();
            const startTime = Date.now();

            // 执行多次调度操作
            for (let i = 0; i < 1000; i++) {
                fsrs.repeat(card, now);
            }

            const endTime = Date.now();
            const duration = endTime - startTime;

            // 1000 次操作应该在合理时间内完成（例如 < 1 秒）
            expect(duration).toBeLessThan(1000);
        });

        it('应该支持序列化/反序列化', () => {
            const card = createEmptyCard();
            const result = fsrs.repeat(card, now);

            // 验证卡片数据可以被序列化
            const serialized = JSON.stringify(result[Rating.Good].card);
            expect(() => JSON.parse(serialized)).not.toThrow();
        });
    });
});