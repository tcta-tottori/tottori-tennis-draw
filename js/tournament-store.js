/**
 * tournament-store.js - 大会日程データの管理
 * メモリ + localStorageで管理
 * グローバルスコープ（window.TournamentStore）にエクスポート
 */
window.TournamentStore = {
  tournaments: [],
  nextId: 1,
  STORAGE_KEY: 'drawSystem_tournaments',

  init() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        this.tournaments = data.tournaments || [];
        this.nextId = data.nextId || 1;
        if (this.tournaments.length > 0) {
          const maxId = Math.max(...this.tournaments.map(t => t.id));
          if (this.nextId <= maxId) this.nextId = maxId + 1;
        }
      } else {
        // メインデータがない場合、バックアップから復元を試みる
        this.restoreFromBackup();
      }
    } catch (e) {
      console.warn('TournamentStore: localStorageからの復元に失敗:', e);
      this.tournaments = [];
      this.nextId = 1;
      // 復元失敗時もバックアップから復元を試みる
      this.restoreFromBackup();
    }
  },

  save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        tournaments: this.tournaments,
        nextId: this.nextId,
      }));
      this._saveBackup();
    } catch (e) {
      console.error('TournamentStore: 保存に失敗:', e);
    }
  },

  add(t) {
    const item = {
      id: this.nextId++,
      name: t.name || '',
      events: t.events || '',
      date: t.date || '',
      dayOfWeek: t.dayOfWeek || '',
      reserveDate: t.reserveDate || '',
      venue: t.venue || '',
      reserveVenue: t.reserveVenue || '',
      deadline: t.deadline || '',
    };
    this.tournaments.push(item);
    this.save();
    return item;
  },

  update(id, data) {
    const t = this.tournaments.find(t => t.id === id);
    if (!t) return null;
    const fields = ['name', 'events', 'date', 'dayOfWeek', 'reserveDate', 'venue', 'reserveVenue', 'deadline'];
    for (const f of fields) {
      if (data[f] !== undefined) t[f] = data[f];
    }
    this.save();
    return { ...t };
  },

  remove(id) {
    const idx = this.tournaments.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tournaments.splice(idx, 1);
    this.save();
    return true;
  },

  getAll() {
    return this.tournaments.map(t => ({ ...t }));
  },

  getById(id) {
    const t = this.tournaments.find(t => t.id === id);
    return t ? { ...t } : null;
  },

  /**
   * Excelシリアル日付値を「M月D日」形式に変換
   */
  _excelDateToString(val) {
    if (val === null || val === undefined || val === '') return '';
    // 数値の場合はExcelシリアル日付として変換
    if (typeof val === 'number' && val > 1000) {
      // Excelの日付シリアル値（1900年1月1日 = 1）
      const utcDays = Math.floor(val - 25569);
      const date = new Date(utcDays * 86400000);
      const m = date.getUTCMonth() + 1;
      const d = date.getUTCDate();
      return m + '月' + d + '日';
    }
    // 文字列の場合はそのまま返す
    return String(val).trim();
  },

  /**
   * 予備日・締切のシリアル値を「M/D」形式に変換
   */
  _excelDateToShort(val) {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number' && val > 1000) {
      const utcDays = Math.floor(val - 25569);
      const date = new Date(utcDays * 86400000);
      return (date.getUTCMonth() + 1) + '/' + date.getUTCDate();
    }
    return String(val).trim();
  },

  /**
   * 会場名を正規化（「テニスコート」のみ → 「ヤマタスポーツパーク・テニスコート」）
   */
  _normalizeVenue(val) {
    if (!val) return '';
    let v = String(val).replace(/\n/g, '').trim();
    // 「テニスコート」のみ、または改行付きで「テニスコート」だけの場合
    if (v === 'テニスコート') {
      return 'ヤマタスポーツパーク・テニスコート';
    }
    return v;
  },

  /**
   * Excelファイルからインポート
   */
  importFromExcel(workbook) {
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    // raw:true（デフォルト）で数値をそのまま取得し、日付変換を自前で行う
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    let imported = 0;
    // ヘッダー行を探す（「№」が含まれる行）
    let startRow = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (row && row.some(c => String(c).includes('№'))) {
        startRow = i + 1;
        break;
      }
    }
    if (startRow === -1) startRow = 3; // デフォルト

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 5) continue;
      const no = row[0];
      if (no === undefined || no === '' || no === null) continue;
      if (typeof no === 'string' && no.trim() === '') continue;

      const name = String(row[1] || '').trim();
      if (!name) continue;

      const events = String(row[2] || '').trim();
      const dateStr = this._excelDateToString(row[3]);
      const dayOfWeek = String(row[4] || '').trim();
      const reserveDate = this._excelDateToShort(row[5]);
      const venue = this._normalizeVenue(row[6]);
      const reserveVenue = String(row[7] || '').trim();
      const deadline = this._excelDateToShort(row[8]);

      this.add({
        name, events, date: dateStr, dayOfWeek,
        reserveDate, venue, reserveVenue, deadline,
      });
      imported++;
    }
    return imported;
  },

  clear() {
    this.tournaments = [];
    this.nextId = 1;
    this.save();
  },

  // ==========================================================
  // バックアップ機能
  // ==========================================================

  BACKUP_KEY: 'drawSystem_tournamentBackup',

  _saveBackup() {
    try {
      const backup = {
        tournaments: this.tournaments,
        nextId: this.nextId,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(backup));
    } catch (e) {
      console.warn('TournamentStore: バックアップ保存に失敗:', e);
    }
  },

  restoreFromBackup() {
    try {
      const saved = localStorage.getItem(this.BACKUP_KEY);
      if (!saved) return false;
      const backup = JSON.parse(saved);
      if (!backup.tournaments || !Array.isArray(backup.tournaments)) return false;
      this.tournaments = backup.tournaments;
      this.nextId = backup.nextId || 1;
      if (this.tournaments.length > 0) {
        const maxId = Math.max(...this.tournaments.map(t => t.id));
        if (this.nextId <= maxId) this.nextId = maxId + 1;
      }
      return true;
    } catch (e) {
      console.warn('TournamentStore: バックアップ復元に失敗:', e);
      return false;
    }
  },

  getBackupDate() {
    try {
      const saved = localStorage.getItem(this.BACKUP_KEY);
      if (!saved) return null;
      const backup = JSON.parse(saved);
      return backup.savedAt || null;
    } catch (e) {
      return null;
    }
  },
};
