'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  workMin: 45,
  shortMin: 5,
  longMin: 15,
  roundsBeforeLong: 4,
  openAtLogin: false,
};

function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.paths = {
      config: path.join(dir, 'config.json'),
      state: path.join(dir, 'state.json'),
      stats: path.join(dir, 'stats.json'),
    };
    fs.mkdirSync(dir, { recursive: true });
    this.config = this._loadJSON('config', DEFAULT_CONFIG);
    this.state = this._loadJSON('state', null);
    this.stats = this._loadJSON('stats', null) || this._freshStats();
    this._rollStats();
  }

  _loadJSON(key, fallback) {
    try {
      const obj = JSON.parse(fs.readFileSync(this.paths[key], 'utf8'));
      if (fallback && typeof fallback === 'object') return Object.assign({}, fallback, obj);
      return obj;
    } catch (e) {
      return fallback && typeof fallback === 'object' ? Object.assign({}, fallback) : null;
    }
  }

  _saveJSON(key, obj) {
    try {
      const tmp = this.paths[key] + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, this.paths[key]);
    } catch (e) {
      console.error(`[store] cannot save ${key}:`, e.message);
    }
  }

  _freshStats() {
    return { day: todayKey(), workRounds: 0, shortRests: 0, longRests: 0, skippedRests: 0, skippedWorks: 0 };
  }

  _rollStats() {
    if (!this.stats || this.stats.day !== todayKey()) {
      this.stats = this._freshStats();
      this._saveJSON('stats', this.stats);
      return;
    }
    let changed = false;
    for (const k of Object.keys(this._freshStats())) {
      if (k === 'day') continue;
      if (typeof this.stats[k] !== 'number') {
        this.stats[k] = 0;
        changed = true;
      }
    }
    if (changed) this._saveJSON('stats', this.stats);
  }

  getConfig() {
    return Object.assign({}, this.config);
  }

  updateConfig(patch) {
    this.config = Object.assign({}, this.config, patch || {});
    this._saveJSON('config', this.config);
    return this.getConfig();
  }

  getState() {
    return this.state;
  }

  setState(obj) {
    this.state = obj;
    this._saveJSON('state', obj);
  }

  clearState() {
    this.state = null;
    this._saveJSON('state', null);
  }

  getStats() {
    this._rollStats();
    return Object.assign({}, this.stats);
  }

  bump(key, n) {
    this._rollStats();
    if (typeof this.stats[key] !== 'number') this.stats[key] = 0;
    this.stats[key] += (n || 1);
    this._saveJSON('stats', this.stats);
    return this.getStats();
  }
}

module.exports = { Store, DEFAULT_CONFIG };
