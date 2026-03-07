/**
 * entry-store.js - エントリーデータの管理
 * メモリ + localStorageで管理
 * グローバルスコープ（window.EntryStore）にエクスポート
 * 依存: window.AppConfig
 */
window.EntryStore = {
  entries: [],
  nextId: 1,
  STORAGE_KEY: 'drawSystem_entries',

  _syncChannel: null,

  /**
   * 初期化（localStorageから復元 + 同期チャンネル開設）
   */
  init() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        this.entries = data.entries || [];
        this.nextId = data.nextId || 1;
        if (this.entries.length > 0) {
          const maxId = Math.max(...this.entries.map(e => e.id));
          if (this.nextId <= maxId) {
            this.nextId = maxId + 1;
          }
        }
      }
    } catch (e) {
      console.warn('EntryStore: localStorageからの復元に失敗:', e);
      this.entries = [];
      this.nextId = 1;
    }

    // 複数タブ間同期: storageイベント
    window.addEventListener('storage', (e) => {
      if (e.key === this.STORAGE_KEY && e.newValue) {
        this._reloadFromStorage();
        this._notifyUI();
      }
    });

    // 同一オリジン内同期: BroadcastChannel
    try {
      this._syncChannel = new BroadcastChannel('drawSystem_sync');
      this._syncChannel.onmessage = (e) => {
        if (e.data && e.data.type === 'entries_updated') {
          this._reloadFromStorage();
          this._notifyUI();
        }
      };
    } catch (err) {
      // BroadcastChannel非対応ブラウザはstorageイベントのみで同期
    }
  },

  /**
   * localStorageから再読込（他タブからの変更を反映）
   */
  _reloadFromStorage() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        this.entries = data.entries || [];
        this.nextId = data.nextId || 1;
        if (this.entries.length > 0) {
          const maxId = Math.max(...this.entries.map(e => e.id));
          if (this.nextId <= maxId) this.nextId = maxId + 1;
        }
      }
    } catch (e) { /* ignore */ }
  },

  /**
   * UIに同期通知を送る
   */
  _notifyUI() {
    if (typeof App !== 'undefined') {
      if (App.currentScreen === 'screen-entry') App.refreshEntryTable();
      if (App.currentScreen === 'screen-events') App.refreshEventsScreen();
      if (App.currentScreen === 'screen-ranking') App._renderRankingRows();
      App.showMessage('他の端末からデータが更新されました', 'info');
    }
  },

  /**
   * 同期チャンネルに変更を通知
   */
  _broadcastChange() {
    try {
      if (this._syncChannel) {
        this._syncChannel.postMessage({ type: 'entries_updated', timestamp: Date.now() });
      }
    } catch (e) { /* ignore */ }
  },

  /**
   * エントリー追加
   * @param {object} entry - エントリーデータ
   * @returns {object} 追加されたエントリー（id付き）
   */
  add(entry) {
    const newEntry = {
      id: this.nextId++,
      name: entry.name || '',
      furigana: entry.furigana || '',
      affiliation: entry.affiliation || '',
      eventCode: entry.eventCode || '',
      rank: entry.rank || null,
      points: entry.points || 0,
      fee: entry.fee || 0,
      paid: entry.paid || false,
      confirmed: entry.confirmed || false,
      notes: entry.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.entries.push(newEntry);
    this.save();
    return newEntry;
  },

  /**
   * エントリー更新
   * @param {number} id - エントリーID
   * @param {object} data - 更新データ（部分更新可）
   * @returns {object|null} 更新されたエントリー、見つからない場合はnull
   */
  update(id, data) {
    const index = this.entries.findIndex(e => e.id === id);
    if (index === -1) return null;

    const entry = this.entries[index];
    const updatableFields = [
      'name', 'furigana', 'affiliation', 'eventCode',
      'rank', 'points', 'fee', 'paid', 'confirmed', 'notes'
    ];

    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        entry[field] = data[field];
      }
    }
    entry.updatedAt = new Date().toISOString();

    this.save();
    return { ...entry };
  },

  /**
   * エントリー削除
   * @param {number} id - エントリーID
   * @returns {boolean} 削除成功したかどうか
   */
  remove(id) {
    const index = this.entries.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.entries.splice(index, 1);
    this.save();
    return true;
  },

  /**
   * 種目別フィルター（確認済みのみ、ポイント降順）
   * @param {string} eventCode - 種目コード
   * @returns {Array} フィルターされたエントリー
   */
  getByEvent(eventCode) {
    return this.entries
      .filter(e => e.eventCode === eventCode)
      .sort((a, b) => (b.points || 0) - (a.points || 0));
  },

  /**
   * localStorageに保存
   */
  save() {
    try {
      const data = {
        entries: this.entries,
        nextId: this.nextId,
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      this._broadcastChange();
    } catch (e) {
      console.error('EntryStore: localStorageへの保存に失敗:', e);
    }
  },

  /**
   * IDでエントリー取得
   * @param {number} id - エントリーID
   * @returns {object|null} エントリー
   */
  getById(id) {
    const entry = this.entries.find(e => e.id === id);
    return entry ? { ...entry } : null;
  },

  /**
   * 全エントリー取得
   * @returns {Array} 全エントリーのコピー
   */
  getAll() {
    return this.entries.map(e => ({ ...e }));
  },

  /**
   * エントリー数サマリー
   * @returns {object} 種目ごとの件数と合計
   */
  getSummary() {
    const summary = {};
    for (const evt of AppConfig.EVENTS) {
      const all = this.entries.filter(e => e.eventCode === evt.code);
      const confirmed = all.filter(e => e.confirmed);
      summary[evt.code] = {
        name: evt.name,
        shortName: evt.shortName,
        total: all.length,
        confirmed: confirmed.length,
      };
    }
    summary.grandTotal = {
      total: this.entries.length,
      confirmed: this.entries.filter(e => e.confirmed).length,
    };
    return summary;
  },

  /**
   * JSONエクスポート
   * @returns {string} JSON文字列
   */
  exportJSON() {
    return JSON.stringify({
      entries: this.entries,
      nextId: this.nextId,
      exportedAt: new Date().toISOString(),
    }, null, 2);
  },

  /**
   * JSONインポート
   * @param {string} json - JSON文字列
   * @returns {number} インポートされたエントリー数
   */
  importJSON(json) {
    const data = JSON.parse(json);
    if (!data.entries || !Array.isArray(data.entries)) {
      throw new Error('不正なJSONフォーマット: entriesが見つかりません');
    }

    this.entries = data.entries;
    this.nextId = data.nextId || 1;

    // nextIdの整合性チェック
    if (this.entries.length > 0) {
      const maxId = Math.max(...this.entries.map(e => e.id));
      if (this.nextId <= maxId) {
        this.nextId = maxId + 1;
      }
    }

    this.save();
    return this.entries.length;
  },

  /**
   * 全クリア
   */
  clear() {
    this.entries = [];
    this.nextId = 1;
    this.save();
  },
};
