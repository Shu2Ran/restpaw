'use strict';

const MINUTE = 60000;

const PHASE = { IDLE: 'idle', WORK: 'work', SHORT: 'short', LONG: 'long' };

function dayKey(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const DEFAULT_CONFIG = {
  workMin: 45,
  shortMin: 5,
  longMin: 15,
  roundsBeforeLong: 4,
};

class PomodoraError extends Error {}

class Pomodoro {
  constructor(config, onEvent, now) {
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._emit = typeof onEvent === 'function' ? onEvent : () => {};
    this.configure(config);
    this.reset();
    this.workedMs = 0;
    this.workedDay = dayKey(this._now());
    this.lastAccrued = this._now();
  }

  configure(config) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    const clamp = (v, min, max, dflt) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
    };
    this.cfg = {
      workMin: clamp(cfg.workMin, 1, 240, DEFAULT_CONFIG.workMin),
      shortMin: clamp(cfg.shortMin, 1, 60, DEFAULT_CONFIG.shortMin),
      longMin: clamp(cfg.longMin, 5, 120, DEFAULT_CONFIG.longMin),
      roundsBeforeLong: clamp(cfg.roundsBeforeLong, 2, 8, DEFAULT_CONFIG.roundsBeforeLong),
    };
  }

  applyConfigNow(config, now) {
    now = now === undefined ? this._now() : now;
    const oldTotal = this.totalMs();
    const elapsed = Math.max(0, oldTotal - this.remainingMs(now));
    this.configure(config);
    if (this.phase === PHASE.IDLE || this.awaiting) return;
    const newTotal = this.totalMs();
    let remaining = newTotal - elapsed;
    if (remaining <= 0) {
      this.deadline = now;
      this.frozen = false;
      this.frozenRemaining = 0;
      if (this.phase === PHASE.WORK) {
        this._onWorkEnd(now, 'complete');
      } else {
        this._onBreakEnd(now, false);
      }
      return;
    }
    this.frozenRemaining = remaining;
    if (!this.frozen) this.deadline = now + remaining;
  }

  reset() {
    this.phase = PHASE.IDLE;
    this.deadline = 0;
    this.round = 0;
    this.awaiting = null;
    this.snoozeUntil = 0;
    this.muteUntil = 0;
    this.muteMode = null;
    this.frozen = false;
    this.frozenRemaining = 0;
    this.nextBreak = null;
    this.lastBreak = null;
    this.lastReason = null;
    this.mutedEndPending = false;
  }

  restore(data) {
    this.reset();
    if (!data || typeof data !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(data, 'phase')) this.phase = data.phase;
    this.deadline = Number(data.deadline) || 0;
    this.round = Number(data.round) || 0;
    this.awaiting = data.awaiting === 'work-end' || data.awaiting === 'break-end' ? data.awaiting : null;
    this.snoozeUntil = Number(data.snoozeUntil) || 0;
    const mu = data.muteUntil;
    this.muteUntil = mu === 'manual' || mu === Infinity ? Infinity : (Number(mu) || 0);
    this.muteMode = data.muteMode || null;
    this.frozen = !!data.frozen;
    this.frozenRemaining = Number(data.frozenRemaining) || 0;
    this.nextBreak = data.nextBreak === PHASE.LONG || data.nextBreak === PHASE.SHORT ? data.nextBreak : null;
    this.lastBreak = data.lastBreak === PHASE.LONG || data.lastBreak === PHASE.SHORT ? data.lastBreak : null;
    this.lastReason = data.lastReason === 'skip' ? 'skip' : data.lastReason === 'complete' ? 'complete' : null;
    if (this.phase !== PHASE.WORK && this.phase !== PHASE.SHORT && this.phase !== PHASE.LONG) {
      this.phase = PHASE.IDLE;
    }
    this.workedMs = Math.max(0, Number(data.workedMs) || 0);
    this.workedDay = typeof data.workedDay === 'string' ? data.workedDay : dayKey(this._now());
    this.lastAccrued = this._now();
    this.mutedEndPending = !!(this.awaiting && (this.muteUntil === Infinity || this.muteUntil > this._now()));
  }

  toJSON() {
    return {
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      awaiting: this.awaiting,
      snoozeUntil: this.snoozeUntil === Infinity ? 'manual' : this.snoozeUntil,
      muteUntil: this.muteUntil === Infinity ? 'manual' : this.muteUntil,
      muteMode: this.muteMode,
      frozen: this.frozen,
      frozenRemaining: this.frozenRemaining,
      nextBreak: this.nextBreak,
      lastBreak: this.lastBreak,
      lastReason: this.lastReason,
      workedMs: this.workedMs,
      workedDay: this.workedDay,
    };
  }

  muted(now) {
    if (!this.muteUntil) return false;
    if (this.muteUntil === Infinity) return true;
    return now < this.muteUntil;
  }

  remainingMs(now) {
    if (this.phase === PHASE.IDLE) return 0;
    if (this.frozen) return Math.max(0, this.frozenRemaining);
    return Math.max(0, this.deadline - now);
  }

  totalMs() {
    if (this.phase === PHASE.WORK) return this.cfg.workMin * MINUTE;
    if (this.phase === PHASE.SHORT) return this.cfg.shortMin * MINUTE;
    if (this.phase === PHASE.LONG) return this.cfg.longMin * MINUTE;
    return 0;
  }

  getState(now) {
    now = now === undefined ? this._now() : now;
    return {
      phase: this.phase,
      round: this.round,
      awaiting: this.awaiting,
      nextBreak: this.nextBreak,
      lastReason: this.lastReason,
      frozen: this.frozen,
      muted: this.muted(now),
      muteUntil: this.muteUntil,
      muteMode: this.muteMode,
      snoozeUntil: this.snoozeUntil,
      remainingMs: this.remainingMs(now),
      totalMs: this.totalMs(),
      workedMs: this.workedMs,
      // 已超时：仅在工作结束、弹窗等决策期间有值。派生量，不落盘——
      // deadline 在 _onWorkEnd 就被钉住了，now - deadline 天然就是超时秒数；
      // 重启后 restore() 读回 deadline，超时也能接上。
      overMs: this.overMs(now),
    };
  }

  overMs(now) {
    now = now === undefined ? this._now() : now;
    if (this.awaiting !== 'work-end' || this.frozen) return 0;
    return Math.max(0, now - this.deadline);
  }

  start(now) {
    now = now === undefined ? this._now() : now;
    if (this.phase !== PHASE.IDLE) throw new PomodoraError('not idle');
    this._startWork(now);
    this._fire('started', this.getState(now));
  }

  _startWork(now) {
    this.phase = PHASE.WORK;
    this.deadline = now + this.cfg.workMin * MINUTE;
    this.awaiting = null;
    this.snoozeUntil = 0;
    this.frozen = false;
    this.frozenRemaining = 0;
    this.lastAccrued = now;
  }

  pause(now) {
    now = now === undefined ? this._now() : now;
    if (this.phase === PHASE.IDLE || this.frozen) throw new PomodoraError('cannot pause');
    this.frozenRemaining = this.remainingMs(now);
    this.frozen = true;
    this._fire('paused', this.getState(now));
  }

  resume(now) {
    now = now === undefined ? this._now() : now;
    if (!this.frozen) throw new PomodoraError('not paused');
    if (!this.awaiting && this.phase !== PHASE.IDLE) {
      this.deadline = now + this.frozenRemaining;
    }
    this.frozen = false;
    this.frozenRemaining = 0;
    this.lastAccrued = now;
    this._fire('resumed', this.getState(now));
  }

  setMute(minutes, now) {
    now = now === undefined ? this._now() : now;
    if (minutes === null || minutes === undefined) {
      this.muteUntil = Infinity;
      this.muteMode = 'manual';
    } else {
      this.muteUntil = now + Math.max(1, Number(minutes)) * MINUTE;
      this.muteMode = 'timed';
    }
    this._fire('muted', this.getState(now));
  }

  setMuteForWork(now) {
    now = now === undefined ? this._now() : now;
    const running = this.phase === PHASE.WORK && !this.awaiting && !this.frozen;
    if (!running) {
      this.setMute(60, now);
      return;
    }
    this.muteUntil = now + Math.max(1000, this.remainingMs(now));
    this.muteMode = 'work';
    this._fire('muted', this.getState(now));
  }

  clearMute(now) {
    now = now === undefined ? this._now() : now;
    if (!this.muteUntil) return;
    const mode = this.muteMode;
    this.muteUntil = 0;
    this.muteMode = null;
    this._fire('unmuted', this.getState(now));
    this._flushMutedEnd(now, mode);
  }

  clearExpiredMute(now) {
    now = now === undefined ? this._now() : now;
    if (!this.muteUntil || this.muteUntil === Infinity || now < this.muteUntil) return;
    const mode = this.muteMode;
    this.muteUntil = 0;
    this.muteMode = null;
    this._fire('unmuted', this.getState(now));
    this._flushMutedEnd(now, mode);
  }

  _flushMutedEnd(now, mode) {
    if (!this.mutedEndPending) return;
    this.mutedEndPending = false;
    if (mode === 'manual') return;
    if (this.awaiting === 'work-end') {
      this._fire('work-end', { nextBreak: this.nextBreak, reason: this.lastReason || 'complete', deferred: true });
    } else if (this.awaiting === 'break-end') {
      this._fire('break-end', { auto: false, deferred: true });
    }
  }

  beginBreak(now) {
    now = now === undefined ? this._now() : now;
    if (this.awaiting !== 'work-end' || !this.nextBreak) throw new PomodoraError('nothing to begin');
    const next = this.nextBreak;
    this.phase = next;
    this.deadline = now + this.totalMs();
    this.awaiting = null;
    this.snoozeUntil = 0;
    this.frozen = false;
    this.frozenRemaining = 0;
    this._fire('break-start', { phase: next });
    this._fire('phase', this.getState(now));
  }

  skipRest(now) {
    now = now === undefined ? this._now() : now;
    if (this.awaiting !== 'work-end') throw new PomodoraError('nothing to skip');
    this._startWork(now);
    this._fire('skipped', this.getState(now));
    this._fire('phase', this.getState(now));
  }

  snooze(minutes, now) {
    now = now === undefined ? this._now() : now;
    if (this.awaiting !== 'work-end') throw new PomodoraError('nothing to snooze');
    this.snoozeUntil = now + Math.max(1, Number(minutes) || 5) * MINUTE;
    this._fire('snoozed', this.getState(now));
  }

  endBreakEarly(now) {
    now = now === undefined ? this._now() : now;
    if (this.phase !== PHASE.SHORT && this.phase !== PHASE.LONG) throw new PomodoraError('not in break');
    this._onBreakEnd(now, true);
  }

  beginWork(now) {
    now = now === undefined ? this._now() : now;
    if (this.awaiting !== 'break-end') throw new PomodoraError('nothing to begin');
    this._startWork(now);
    this._fire('phase', this.getState(now));
  }

  extendBreak(minutes, now) {
    now = now === undefined ? this._now() : now;
    if (this.awaiting !== 'break-end') throw new PomodoraError('nothing to extend');
    this.phase = this.lastBreak || PHASE.SHORT;
    this.deadline = now + Math.max(1, Number(minutes) || 5) * MINUTE;
    this.awaiting = null;
    this._fire('phase', this.getState(now));
  }

  skipWork(now) {
    now = now === undefined ? this._now() : now;
    if (this.phase !== PHASE.WORK || this.awaiting) throw new PomodoraError('cannot skip work');
    this._onWorkEnd(now, 'skip');
  }

  tick(now) {
    now = now === undefined ? this._now() : now;
    const day = dayKey(now);
    if (day !== this.workedDay) {
      this.workedDay = day;
      this.workedMs = 0;
      this.lastAccrued = now;
    }
    this._accrueWork(now);
    this.clearExpiredMute(now);

    if (this.snoozeUntil && this.awaiting === 'work-end') {
      if (now >= this.snoozeUntil) {
        this.snoozeUntil = 0;
        if (this.muted(now)) {
          this.mutedEndPending = true;
        } else {
          this._fire('work-end', { nextBreak: this.nextBreak, reason: this.lastReason || 'complete', deferred: false });
        }
      }
      return;
    }

    if (this.phase === PHASE.IDLE || this.awaiting || this.frozen) return;

    if (this.deadline - now <= 0) {
      if (this.phase === PHASE.WORK) {
        this._onWorkEnd(now, 'complete');
      } else {
        this._onBreakEnd(now, false);
      }
    }
  }

  _accrueWork(now) {
    // 工作结束后的「等待决策」期（awaiting === 'work-end'）仍然算工作时间——
    // 人本来就在干别的，只是弹窗还没点。这段时间不计入，等于白送工时。
    // 注意 break-end 不在条件里：phase 已是 short/long，第一个条件就挡住了。
    const working =
      this.phase === PHASE.WORK && !this.frozen && (!this.awaiting || this.awaiting === 'work-end');
    if (!working) {
      this.lastAccrued = now;
      return;
    }
    // 等待期 deadline 已过（_onWorkEnd 把它钉在结束那一刻），Math.min 会把增量压成 0，
    // 所以这里必须用 now 封顶。
    const cap = this.awaiting === 'work-end' ? now : Math.min(now, this.deadline);
    if (cap > this.lastAccrued) this.workedMs += cap - this.lastAccrued;
    this.lastAccrued = cap;
  }

  _onWorkEnd(now, reason) {
    this.round += 1;
    this.nextBreak = this.round % this.cfg.roundsBeforeLong === 0 ? PHASE.LONG : PHASE.SHORT;
    this.awaiting = 'work-end';
    this.deadline = now;
    this.frozen = false;
    this.frozenRemaining = 0;
    this.lastAccrued = now;
    this.lastReason = reason || 'complete';
    if (this.muted(now)) {
      this.mutedEndPending = true;
      return;
    }
    this._fire('work-end', { nextBreak: this.nextBreak, reason: this.lastReason, deferred: false });
  }

  _onBreakEnd(now, early) {
    const wasLong = this.phase === PHASE.LONG;
    this.lastBreak = this.phase;
    this.awaiting = 'break-end';
    this.deadline = now;
    if (this.muted(now)) {
      this.mutedEndPending = true;
      return;
    }
    this._fire('break-end', { auto: false, early, wasLong });
  }

  _fire(type, payload) {
    this._emit(type, payload);
  }
}

Pomodoro.PHASE = PHASE;
Pomodoro.DEFAULT_CONFIG = DEFAULT_CONFIG;

Pomodoro.isStaleSession = function isStaleSession(saved, cfg, now) {
  if (!saved || typeof saved !== 'object') return false;
  if (saved.awaiting) return false;
  if (saved.phase !== PHASE.WORK && saved.phase !== PHASE.SHORT && saved.phase !== PHASE.LONG) return false;
  const deadline = Number(saved.deadline) || 0;
  const mins = saved.phase === PHASE.WORK ? cfg.workMin : saved.phase === PHASE.SHORT ? cfg.shortMin : cfg.longMin;
  const startAt = deadline - mins * MINUTE;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return startAt < dayStart.getTime();
};

module.exports = Pomodoro;
