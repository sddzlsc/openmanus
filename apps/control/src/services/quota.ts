import type { UsageSnapshot } from '@wiwana/protocol'
import type { AppConfig, QuotaLimits } from '../config.js'
import { QuotaExceededError } from '../lib/errors.js'
import { today } from '../lib/ids.js'
import type { Store, UsageDelta } from '../store/types.js'

/**
 * Quota is enforced outside the sandbox on purpose: a sandboxed agent must not
 * be able to raise its own limits by editing files it can reach.
 */
export class QuotaService {
  constructor(
    private readonly store: Store,
    private readonly defaults: QuotaLimits,
  ) {}

  static fromConfig(store: Store, config: AppConfig): QuotaService {
    return new QuotaService(store, config.quotas)
  }

  async limitsFor(userId: string): Promise<QuotaLimits> {
    const override = await this.store.getUserQuota(userId)
    return {
      dailyTokens: override?.dailyTokens ?? this.defaults.dailyTokens,
      dailyImages: override?.dailyImages ?? this.defaults.dailyImages,
      dailyVideos: override?.dailyVideos ?? this.defaults.dailyVideos,
      maxRunningTasks: override?.maxRunningTasks ?? this.defaults.maxRunningTasks,
    }
  }

  async snapshot(userId: string, day = today()): Promise<UsageSnapshot> {
    const [usage, limits] = await Promise.all([this.store.getUsage(userId, day), this.limitsFor(userId)])
    const running = (await this.store.listTasksByStatus('running')).filter((task) => task.userId === userId).length
    return {
      day,
      tokens: { used: usage.tokens, limit: limits.dailyTokens },
      images: { used: usage.images, limit: limits.dailyImages },
      videos: { used: usage.videos, limit: limits.dailyVideos },
      tasks: { used: usage.tasks },
      runningTasks: { used: running, limit: limits.maxRunningTasks },
    }
  }

  async assertCanStartTask(userId: string): Promise<void> {
    const [usage, limits] = await Promise.all([this.store.getUsage(userId), this.limitsFor(userId)])
    if (usage.tokens >= limits.dailyTokens) {
      throw new QuotaExceededError(`今日 Token 额度已用完（${limits.dailyTokens}），请明天再试或联系管理员提升额度。`)
    }
    const running = (await this.store.listTasksByStatus('running')).filter((task) => task.userId === userId).length
    if (running >= limits.maxRunningTasks) {
      throw new QuotaExceededError(`同时运行的任务不能超过 ${limits.maxRunningTasks} 个，请等待当前任务完成。`)
    }
    if (usage.images >= limits.dailyImages) {
      throw new QuotaExceededError(`今日图片生成次数已用完（${limits.dailyImages} 张）。`)
    }
  }

  async record(userId: string, delta: UsageDelta, day = today()): Promise<void> {
    if (!delta.tokens && !delta.images && !delta.videos && !delta.containerMinutes && !delta.tasks) return
    await this.store.addUsage(userId, day, delta)
  }
}
