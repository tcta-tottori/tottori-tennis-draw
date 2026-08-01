/**
 * ranking-loader.js - SheetJS (XLSX) を使ってrank.xlsxを読み込む
 * グローバルスコープ（window.RankingLoader）にエクスポート
 * 依存: XLSX (SheetJS), window.AppConfig
 */
window.RankingLoader = {
  rankings: {},      // { 'ms': [{rank, name, affiliation, points}, ...], ... }
  furiganaMap: {},   // { '山田　太郎': 'やまだ　たろう', ... }
  furiganaKeyMap: {},// 正規化キー（空白除去・NFKC）→ ふりがな。表記ゆれ吸収用の索引
  allPlayers: [],    // 全種目の全選手リスト（重複あり）
  listMembers: [],   // リストシートの全登録者 [{name, furigana}]（ランキング外含む）

  /**
   * 氏名の照合キーを生成する。
   * 「田中　芳宏」「田中 芳宏」「田中芳宏」「ﾀﾅｶ ﾖｼﾋﾛ」を同一キーに寄せることで、
   * データソース（スプレッドシート／ふりがなJSON／手入力）ごとの表記ゆれを吸収する。
   * @param {string} name 氏名
   * @returns {string} 照合キー（空白を全て除去した正規形）
   */
  nameKey(name) {
    if (!name) return '';
    let s = String(name);
    try { s = s.normalize('NFKC'); } catch (e) { /* 未対応環境ではそのまま */ }
    return s
      .replace(/[\s　 ]+/g, '')   // 半角/全角/NBSPの空白を全除去
      .replace(/[・･.,、。]/g, '')          // 区切り記号も無視
      .toLowerCase();
  },

  /**
   * 氏名からふりがなを取得する（表記ゆれ吸収つき）
   * @param {string} name 氏名
   * @returns {string} ふりがな。見つからなければ空文字
   */
  getFurigana(name) {
    if (!name) return '';
    if (this.furiganaMap[name]) return this.furiganaMap[name];
    const key = this.nameKey(name);
    if (!key) return '';
    return this.furiganaKeyMap[key] || '';
  },

  /**
   * furiganaMap から正規化キー索引を作り直す
   */
  rebuildFuriganaKeyMap() {
    this.furiganaKeyMap = {};
    for (const name of Object.keys(this.furiganaMap || {})) {
      const key = this.nameKey(name);
      if (key && this.furiganaMap[name]) this.furiganaKeyMap[key] = this.furiganaMap[name];
    }
  },

  /**
   * FileオブジェクトからArrayBufferを読み込むヘルパー
   */
  _readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * 氏名の正規化: 半角スペースを全角スペースに統一し、前後の空白を除去
   */
  _normalizeName(name) {
    if (!name) return '';
    return String(name)
      .replace(/[\s\u3000\u00a0]+/g, '\u3000')
      .replace(/^\u3000+|\u3000+$/g, '');
  },

  /**
   * シート名からイベントコードへのマッピングを取得
   * シート名がイベントコードそのもの、またはイベント名に一致するものを探す
   */
  _resolveEventCode(sheetName) {
    const normalizedName = sheetName.trim().toLowerCase();
    // イベントコードに直接一致
    if (AppConfig.RANK_SHEETS[normalizedName]) {
      return normalizedName;
    }
    // イベント名やshortNameから逆引き
    for (const evt of AppConfig.EVENTS) {
      if (evt.name === sheetName.trim() || evt.shortName === sheetName.trim()) {
        return evt.code;
      }
    }
    return null;
  },

  /**
   * rank.xlsxを読み込み、各シートをパースしてrankingsに格納
   */
  async loadRankingFile(file) {
    const data = await this._readFileAsArrayBuffer(file);
    const workbook = XLSX.read(data, { type: 'array' });

    // 初期化
    this.rankings = {};
    this.allPlayers = [];

    for (const sheetName of workbook.SheetNames) {
      const eventCode = this._resolveEventCode(sheetName);
      if (!eventCode || !AppConfig.RANK_SHEETS[eventCode]) {
        continue; // 定義されていないシートはスキップ
      }

      const sheet = workbook.Sheets[sheetName];
      // シート全体を2次元配列として取得（ヘッダーなし）
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      const config = AppConfig.RANK_SHEETS[eventCode];
      const dataStartRow = config.headerRow; // headerRowはヘッダー行番号（1-indexed）、データ開始はその次の行
      // msシートはheaderRow=2なのでデータ開始は行index 2（0-indexed、つまり3行目）
      // 他シートはheaderRow=3なのでデータ開始は行index 3（0-indexed、つまり4行目）

      const players = [];
      const COL = AppConfig.RANK_COL;

      for (let i = dataStartRow; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const tiedMark = String(row[COL.TIED] || '').trim();
        const rankVal = row[COL.RANK];
        const name = row[COL.NAME];
        const affiliation = row[COL.AFFILIATION];
        const points = row[COL.POINTS];

        // A列が'*'の行はスキップ
        if (tiedMark === '*') continue;

        // B列が数値の行のみデータ行として扱う
        const rankNum = Number(rankVal);
        if (isNaN(rankNum) || rankNum <= 0) continue;

        const normalizedName = this._normalizeName(name);
        if (!normalizedName) continue;

        const aff = String(affiliation || '').trim();
        const player = {
          rank: rankNum,
          name: normalizedName,
          affiliation: aff || 'フリー',
          points: Number(points) || 0,
          eventCode: eventCode,
        };

        players.push(player);
        this.allPlayers.push(player);
      }

      this.rankings[eventCode] = players;
    }

    this._saveBackup();
    return this.getStatus();
  },

  /**
   * @deprecated ふりがなはApp側のJSON管理に移行。互換性のため残置。
   * ふりがなデータ読み込み
   * A列=氏名, B列=ふりがな のデータを持つExcelファイルを読み込む
   */
  async loadFuriganaFile(file) {
    const data = await this._readFileAsArrayBuffer(file);
    const workbook = XLSX.read(data, { type: 'array' });

    this.furiganaMap = {};

    // 「ふりがな」シートを優先、なければ最初のシートを使用
    let sheetName = workbook.SheetNames.find(s => s.includes('ふりがな') || s.includes('フリガナ'));
    if (!sheetName) sheetName = workbook.SheetNames[0];
    if (!sheetName) return;

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      const name = this._normalizeName(row[0]);
      const furigana = String(row[1] || '').trim();

      if (name && furigana) {
        this.furiganaMap[name] = furigana;
      }
    }

    // 既存のallPlayersにふりがな情報を付与
    this.rebuildFuriganaKeyMap();
    for (const player of this.allPlayers) {
      const furigana = this.getFurigana(player.name);
      if (furigana) player.furigana = furigana;
    }
  },

  /**
   * 氏名からランキング情報を検索（完全一致）
   * @param {string} name - 検索する氏名
   * @param {string} [eventCode] - 種目コード（省略時は全種目検索）
   * @returns {object|null} マッチした選手情報
   */
  findPlayer(name, eventCode) {
    const normalizedName = this._normalizeName(name);
    const key = this.nameKey(normalizedName);

    if (eventCode && this.rankings[eventCode]) {
      const found = this.rankings[eventCode].find(p => p.name === normalizedName)
        || this.rankings[eventCode].find(p => this.nameKey(p.name) === key);
      if (found) return { ...found };
    }

    if (!eventCode) {
      const found = this.allPlayers.find(p => p.name === normalizedName)
        || this.allPlayers.find(p => this.nameKey(p.name) === key);
      if (found) return { ...found };
    }

    return null;
  },

  /**
   * 全種目横断で氏名検索（部分一致）
   * @param {string} query - 検索クエリ
   * @returns {Array} マッチした選手リスト
   */
  searchPlayers(query) {
    if (!query) return [];
    const normalizedQuery = this._normalizeName(query);

    const results = [];
    const seen = new Set();

    for (const player of this.allPlayers) {
      const key = player.name + '|' + player.eventCode;
      if (seen.has(key)) continue;

      if (player.name.includes(normalizedQuery)) {
        results.push({ ...player });
        seen.add(key);
      } else if (player.furigana && player.furigana.includes(normalizedQuery)) {
        results.push({ ...player });
        seen.add(key);
      }
    }

    return results;
  },

  /**
   * シートデータのカテゴリ検証
   * タイトル行に含まれるキーワードが期待する種目と一致するか確認
   * gviz APIが存在しないシート名でも200を返し最初のシートを返す問題への対策
   */
  _validateSheetCategory(rows, eventCode) {
    if (!rows || rows.length === 0) return false;

    // 最初の行からタイトルテキストを取得し、全角数字を半角に変換
    let titleText = '';
    if (rows[0]) {
      titleText = rows[0].join(' ');
    }
    titleText = titleText.replace(/[０-９]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30)
    );

    // 種目に応じた期待キーワード
    const expectations = {
      'ms':   { must: ['男子'], mustNot: ['45', '55', '65'] },
      'ls':   { must: ['女子'], mustNot: ['45', '55', '65'] },
      'm45s': { must: ['男子', '45'] },
      'm55s': { must: ['男子', '55'] },
      'm65s': { must: ['男子', '65'] },
      'l45s': { must: ['女子', '45'] },
    };

    const rule = expectations[eventCode];
    if (!rule) return true;

    for (const keyword of rule.must) {
      if (!titleText.includes(keyword)) return false;
    }
    if (rule.mustNot) {
      for (const keyword of rule.mustNot) {
        if (titleText.includes(keyword)) return false;
      }
    }

    return true;
  },

  // ==========================================================
  // Google スプレッドシートから読み込み
  // ==========================================================

  /**
   * スプレッドシートのURLまたはIDからスプレッドシートIDを抽出
   */
  _extractSpreadsheetId(urlOrId) {
    if (!urlOrId) return null;
    const str = urlOrId.trim();
    // URL形式: https://docs.google.com/spreadsheets/d/{ID}/...
    const urlMatch = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    // IDのみ（英数字とハイフン、アンダースコア）
    if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) return str;
    return null;
  },

  /**
   * Google スプレッドシートから1シートをCSVとして取得（シート名指定）
   */
  async _fetchSheetAsRows(spreadsheetId, sheetName) {
    const encodedSheet = encodeURIComponent(sheetName);
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`シート "${sheetName}" の取得に失敗 (HTTP ${response.status})`);
    }
    const csvText = await response.text();
    return this._parseCSV(csvText);
  },

  /**
   * Google スプレッドシートから1シートをCSVとして取得（gid指定）
   */
  async _fetchSheetByGid(spreadsheetId, gid) {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`gid=${gid} の取得に失敗 (HTTP ${response.status})`);
    }
    const csvText = await response.text();
    return this._parseCSV(csvText);
  },

  /**
   * CSV文字列を2次元配列にパース（引用符対応）
   */
  _parseCSV(csvText) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i];
      const next = csvText[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(current);
          current = '';
        } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
          row.push(current);
          current = '';
          rows.push(row);
          row = [];
          if (ch === '\r') i++;
        } else if (ch === '\r') {
          row.push(current);
          current = '';
          rows.push(row);
          row = [];
        } else {
          current += ch;
        }
      }
    }
    if (current || row.length > 0) {
      row.push(current);
      rows.push(row);
    }
    return rows;
  },

  /**
   * Google スプレッドシートからランキングデータを読み込み（gidベース）
   * RANK_SHEETS_BY_GID に定義された全シートを読み込む
   * @param {string} urlOrId スプレッドシートのURLまたはID
   * @returns {Promise<object>} ステータスオブジェクト
   */
  async loadRankingFromSpreadsheet(urlOrId) {
    const spreadsheetId = this._extractSpreadsheetId(urlOrId);
    if (!spreadsheetId) {
      throw new Error('有効なスプレッドシートのURLまたはIDを入力してください');
    }

    // 初期化
    this.rankings = {};
    this.allPlayers = [];

    const sheetDefs = AppConfig.RANK_SHEETS_BY_GID;
    const gids = Object.keys(sheetDefs);

    for (const gid of gids) {
      const def = sheetDefs[gid];
      const eventCode = def.eventCode;

      let rows;
      try {
        rows = await this._fetchSheetByGid(spreadsheetId, gid);
      } catch (e) {
        console.warn(`シート "${def.title}" (gid=${gid}) の読み込みをスキップ:`, e.message);
        continue;
      }

      if (!rows || rows.length < 2) continue;

      const players = [];
      const COL = AppConfig.RANK_COL;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const tiedMark = String(row[COL.TIED] || '').trim();
        const rankVal = row[COL.RANK];
        const name = row[COL.NAME];
        const affiliation = row[COL.AFFILIATION];
        const points = row[COL.POINTS];

        if (tiedMark === '*') continue;

        const rankNum = Number(rankVal);
        if (isNaN(rankNum) || rankNum <= 0) continue;

        const normalizedName = this._normalizeName(name);
        if (!normalizedName) continue;

        const aff = String(affiliation || '').trim();
        const player = {
          rank: rankNum,
          name: normalizedName,
          affiliation: aff || 'フリー',
          points: Number(points) || 0,
          eventCode: eventCode,
        };
        players.push(player);
        this.allPlayers.push(player);
      }

      this.rankings[eventCode] = players;
    }

    if (this.allPlayers.length === 0) {
      throw new Error('データが取得できませんでした。スプレッドシートの共有設定を確認してください。');
    }

    this._saveBackup();
    return this.getStatus();
  },

  /**
   * @deprecated ふりがなはApp側のJSON管理に移行。互換性のため残置。
   * Google スプレッドシートからふりがなデータを読み込み
   * @param {string} urlOrId スプレッドシートのURLまたはID
   */
  async loadFuriganaFromSpreadsheet(urlOrId) {
    const spreadsheetId = this._extractSpreadsheetId(urlOrId);
    if (!spreadsheetId) {
      throw new Error('有効なスプレッドシートのURLまたはIDを入力してください');
    }

    this.furiganaMap = {};

    // 「ふりがな」シートを試す
    const sheetCandidates = ['ふりがな', 'フリガナ', 'furigana', 'Sheet1', 'シート1'];
    let rows = null;

    for (const sheetName of sheetCandidates) {
      try {
        rows = await this._fetchSheetAsRows(spreadsheetId, sheetName);
        if (rows && rows.length > 0) break;
      } catch (e) { /* try next */ }
    }

    if (!rows || rows.length === 0) {
      throw new Error('ふりがなシートが見つかりません');
    }

    this.listMembers = [];
    const rankedNames = new Set(this.allPlayers.map(p => p.name));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      const name = this._normalizeName(row[0]);
      const furigana = String(row[1] || '').trim();
      if (name && furigana && !name.includes('氏名') && !name.includes('ひらがな')) {
        this.furiganaMap[name] = furigana;
        // ランキングに載っていない人をlistMembersに追加
        if (!rankedNames.has(name)) {
          this.listMembers.push({ name, furigana });
        }
      }
    }

    // allPlayersにふりがな付与
    this.rebuildFuriganaKeyMap();
    for (const player of this.allPlayers) {
      const furigana = this.getFurigana(player.name);
      if (furigana) player.furigana = furigana;
    }

    this._saveBackup();
  },

  /**
   * ふりがなマップに新規追加（エントリー時にリストにない人を自動登録）
   */
  addToFuriganaMap(name, furigana) {
    const normalizedName = this._normalizeName(name);
    if (!normalizedName || !furigana) return;
    if (!this.furiganaMap[normalizedName]) {
      this.furiganaMap[normalizedName] = furigana;
    }
    const key = this.nameKey(normalizedName);
    if (key && !this.furiganaKeyMap[key]) {
      this.furiganaKeyMap[key] = furigana;
    }
  },

  /**
   * ふりがなを上書き登録する（DB側で確定した読みを反映する用途）
   */
  setFurigana(name, furigana) {
    const normalizedName = this._normalizeName(name);
    if (!normalizedName || !furigana) return;
    this.furiganaMap[normalizedName] = furigana;
    const key = this.nameKey(normalizedName);
    if (key) this.furiganaKeyMap[key] = furigana;
  },

  // ==========================================================
  // localStorageバックアップ
  // ==========================================================

  BACKUP_KEY: 'drawSystem_rankingBackup',

  /**
   * 読み込んだデータをlocalStorageにバックアップ保存
   */
  _saveBackup() {
    try {
      const backup = {
        rankings: this.rankings,
        allPlayers: this.allPlayers,
        furiganaMap: this.furiganaMap,
        listMembers: this.listMembers,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(backup));
    } catch (e) {
      console.warn('RankingLoader: バックアップ保存に失敗:', e);
    }
  },

  /**
   * localStorageからバックアップを復元
   * @returns {boolean} 復元できたかどうか
   */
  restoreFromBackup() {
    try {
      const saved = localStorage.getItem(this.BACKUP_KEY);
      if (!saved) return false;
      const backup = JSON.parse(saved);
      if (!backup.rankings || !backup.allPlayers) return false;

      this.rankings = backup.rankings || {};
      this.allPlayers = backup.allPlayers || [];
      this.furiganaMap = backup.furiganaMap || {};
      this.listMembers = backup.listMembers || [];
      this.rebuildFuriganaKeyMap();
      return true;
    } catch (e) {
      console.warn('RankingLoader: バックアップ復元に失敗:', e);
      return false;
    }
  },

  /**
   * バックアップの保存日時を取得
   * @returns {string|null} ISO日時文字列
   */
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

  /**
   * 読み込み状態の取得
   * @returns {object} 各種目の選手数
   */
  getStatus() {
    const status = {};
    for (const evt of AppConfig.EVENTS) {
      status[evt.code] = {
        name: evt.name,
        count: (this.rankings[evt.code] || []).length,
      };
    }
    status.total = this.allPlayers.length;
    status.furiganaCount = Object.keys(this.furiganaMap).length;
    return status;
  },
};
