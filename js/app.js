/**
 * app.js - アプリケーション初期化とUI制御
 * グローバルスコープ (window.App) にエクスポート
 * 依存: window.AppConfig, window.RankingLoader, window.FuzzyMatch,
 *        window.EntryStore, window.DrawEngine, window.DrawRenderer
 *        (window.OCREngine は任意)
 */
window.App = {
  currentScreen: 'screen-data',
  drawResults: {},      // 種目別ドロー結果 { eventCode: drawResult }
  confirmedEvents: {}, // 確定済み種目 { eventCode: true }
  _editingEntryId: null, // 編集中エントリーID

  /**
   * アプリケーション初期化
   */
  init() {
    // EntryStore の初期化
    if (typeof window.EntryStore !== 'undefined' && EntryStore.init) {
      EntryStore.init();
    } else if (typeof window.EntryStore === 'undefined') {
      window.EntryStore = this._createEntryStoreStub();
    }

    // タブ切り替えイベント
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchScreen(btn.dataset.screen);
      });
    });

    // ドロー結果の復元
    this._restoreDrawResults();

    // 各画面の初期化
    this.initDataScreen();
    this.initRankingScreen();
    this.initOCRScreen();
    this.initEntryScreen();
    this.initDrawScreen();
    this.initBracketScreen();
    this.initManualScreen();
    this.initBackupScreen();

    // モーダル閉じるボタンの共通処理
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) modal.style.display = 'none';
      });
    });

    // スクロール時のフェードインを初期化
    this._initScrollReveal();

    // デフォルトURLをセットして自動読み込み
    this._autoLoadSpreadsheets();
  },

  /**
   * IntersectionObserver でスクロール時にふわっと表示
   */
  _initScrollReveal() {
    if (typeof IntersectionObserver === 'undefined') return;

    this._revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          this._revealObserver.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    this._observeRevealElements();

    // MutationObserver で動的に追加された要素も監視
    this._mutationObserver = new MutationObserver(() => {
      this._observeRevealElements();
    });
    this._mutationObserver.observe(document.querySelector('.app-main'), {
      childList: true, subtree: true
    });
  },

  _observeRevealElements() {
    document.querySelectorAll('.card:not(.revealed):not(.reveal-observed), .table-wrapper:not(.revealed):not(.reveal-observed), .toolbar:not(.revealed):not(.reveal-observed), .flow-step:not(.revealed):not(.reveal-observed), .trouble-item:not(.revealed):not(.reveal-observed), .ocr-preview-area:not(.revealed):not(.reveal-observed), .data-load-grid:not(.revealed):not(.reveal-observed), .manual-tabs:not(.revealed):not(.reveal-observed)').forEach(el => {
      el.classList.add('reveal-observed');
      // 初期状態で画面内にあるかチェック
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('revealed');
      } else {
        this._revealObserver.observe(el);
      }
    });
  },

  async _autoLoadSpreadsheets() {
    // まずlocalStorageのバックアップから復元を試みる
    if (RankingLoader.restoreFromBackup()) {
      const backupDate = RankingLoader.getBackupDate();
      const status = RankingLoader.getStatus();
      this._updateRankingStatus(status);
      const dateStr = backupDate ? new Date(backupDate).toLocaleString('ja-JP') : '';
      this.showMessage('バックアップからデータを復元しました (' + status.total + '名' + (dateStr ? ' / ' + dateStr : '') + ')', 'info');

      // ステータス表示を更新
      const gsRankingStatus = document.getElementById('gs-ranking-status');
      if (gsRankingStatus) {
        gsRankingStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">バックアップから復元: ' + status.total + '名' + (dateStr ? ' (' + dateStr + ')' : '') + '</span>';
      }
      const gsFuriganaStatus = document.getElementById('gs-furigana-status');
      const furiganaCount = Object.keys(RankingLoader.furiganaMap).length;
      if (gsFuriganaStatus && furiganaCount > 0) {
        gsFuriganaStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">バックアップから復元: ' + furiganaCount + '件' + (dateStr ? ' (' + dateStr + ')' : '') + '</span>';
      }

      // バックグラウンドでスプレッドシートから最新データを取得
      this._silentRefreshFromSpreadsheets();
      return;
    }

    // バックアップがない場合はスプレッドシートから読み込み
    await this._loadRankingFromGS();
    await this._loadFuriganaFromGS();
  },

  async _silentRefreshFromSpreadsheets() {
    try {
      const urlInput = document.getElementById('gs-ranking-url');
      if (urlInput && urlInput.value.trim()) {
        await RankingLoader.loadRankingFromSpreadsheet(urlInput.value.trim());
        const status = RankingLoader.getStatus();
        this._updateRankingStatus(status);
        const gsRankingStatus = document.getElementById('gs-ranking-status');
        const now = new Date().toLocaleString('ja-JP');
        if (gsRankingStatus) {
          gsRankingStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">最新データ読込済: ' + status.total + '名 (' + now + ')</span>';
        }
      }
      const furiInput = document.getElementById('gs-furigana-url');
      if (furiInput && furiInput.value.trim()) {
        await RankingLoader.loadFuriganaFromSpreadsheet(furiInput.value.trim());
        const count = Object.keys(RankingLoader.furiganaMap).length;
        const gsFuriganaStatus = document.getElementById('gs-furigana-status');
        const now2 = new Date().toLocaleString('ja-JP');
        if (gsFuriganaStatus) {
          gsFuriganaStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">最新データ読込済: ' + count + '件 (' + now2 + ')</span>';
        }
      }
    } catch (e) {
      console.warn('バックグラウンド更新に失敗（バックアップデータを使用中）:', e.message);
    }
  },

  /**
   * 画面切り替え
   * @param {string} screenId 画面要素のid
   */
  switchScreen(screenId) {
    // 全画面を非表示
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    // 対象画面を表示
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
      this.currentScreen = screenId;
    }

    // タブのアクティブ状態を更新
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === screenId);
    });

    // 画面切り替え時のリフレッシュ
    if (screenId === 'screen-ranking') this.refreshRankingTable();
    if (screenId === 'screen-entry') this.refreshEntryTable();
    if (screenId === 'screen-draw') this._refreshDrawEventSelect();
    if (screenId === 'screen-bracket') this._refreshBracketEventSelect();
    if (screenId === 'screen-backup') this.refreshBackupTable();
  },

  // ================================================================
  // データ読込画面
  // ================================================================

  initDataScreen() {
    // ローカルファイル読み込み
    const dropRanking = document.getElementById('drop-ranking');
    const fileRanking = document.getElementById('file-ranking');
    const dropFurigana = document.getElementById('drop-furigana');
    const fileFurigana = document.getElementById('file-furigana');

    if (dropRanking) {
      this._setupDropZone(dropRanking, fileRanking, (file) => this._loadRankingFile(file));
    }
    if (dropFurigana) {
      this._setupDropZone(dropFurigana, fileFurigana, (file) => this._loadFuriganaFile(file));
    }

    // Google スプレッドシートから読み込み
    const btnGsRanking = document.getElementById('btn-gs-ranking');
    if (btnGsRanking) {
      btnGsRanking.addEventListener('click', () => this._loadRankingFromGS());
    }
    const btnGsFurigana = document.getElementById('btn-gs-furigana');
    if (btnGsFurigana) {
      btnGsFurigana.addEventListener('click', () => this._loadFuriganaFromGS());
    }

    // Enterキーでも読込実行
    const gsRankingUrl = document.getElementById('gs-ranking-url');
    if (gsRankingUrl) {
      gsRankingUrl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._loadRankingFromGS();
      });
    }
    const gsFuriganaUrl = document.getElementById('gs-furigana-url');
    if (gsFuriganaUrl) {
      gsFuriganaUrl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._loadFuriganaFromGS();
      });
    }

    // localStorageに保存されたURL、またはデフォルトURLで初期値セット
    try {
      const savedRankingUrl = localStorage.getItem('drawSystem_gsRankingUrl');
      const savedFuriganaUrl = localStorage.getItem('drawSystem_gsFuriganaUrl');
      if (gsRankingUrl) gsRankingUrl.value = savedRankingUrl || AppConfig.DEFAULT_RANKING_SPREADSHEET || '';
      if (gsFuriganaUrl) gsFuriganaUrl.value = savedFuriganaUrl || AppConfig.DEFAULT_FURIGANA_SPREADSHEET || '';
    } catch (e) { /* ignore */ }

    // リンクボタンの更新
    this._updateGSLinkButtons();
    if (gsRankingUrl) gsRankingUrl.addEventListener('input', () => this._updateGSLinkButtons());
    if (gsFuriganaUrl) gsFuriganaUrl.addEventListener('input', () => this._updateGSLinkButtons());

    // 大会一覧の初期化（データ読込画面に統合）
    this.initTournamentsScreen();
  },

  _updateGSLinkButtons() {
    const rankingUrl = (document.getElementById('gs-ranking-url') || {}).value || '';
    const furiganaUrl = (document.getElementById('gs-furigana-url') || {}).value || '';
    const rankingLink = document.getElementById('btn-gs-ranking-link');
    const furiganaLink = document.getElementById('btn-gs-furigana-link');
    if (rankingLink) {
      if (rankingUrl.trim()) {
        rankingLink.style.display = '';
        rankingLink.href = rankingUrl.trim().startsWith('http') ? rankingUrl.trim() : 'https://docs.google.com/spreadsheets/d/' + rankingUrl.trim();
      } else {
        rankingLink.style.display = 'none';
      }
    }
    if (furiganaLink) {
      if (furiganaUrl.trim()) {
        furiganaLink.style.display = '';
        furiganaLink.href = furiganaUrl.trim().startsWith('http') ? furiganaUrl.trim() : 'https://docs.google.com/spreadsheets/d/' + furiganaUrl.trim();
      } else {
        furiganaLink.style.display = 'none';
      }
    }
  },

  async _loadRankingFromGS() {
    const urlInput = document.getElementById('gs-ranking-url');
    const statusEl = document.getElementById('gs-ranking-status');
    const btnEl = document.getElementById('btn-gs-ranking');
    const progressEl = document.getElementById('gs-ranking-progress');
    const progressBar = document.getElementById('gs-ranking-progress-bar');
    const progressText = document.getElementById('gs-ranking-progress-text');
    if (!urlInput || !urlInput.value.trim()) {
      this.showMessage('スプレッドシートのURLまたはIDを入力してください', 'error');
      return;
    }

    try { localStorage.setItem('drawSystem_gsRankingUrl', urlInput.value.trim()); } catch (e) {}
    this._updateGSLinkButtons();

    // プログレスバー表示
    if (progressEl) progressEl.style.display = '';
    if (progressBar) progressBar.style.width = '20%';
    if (progressText) progressText.textContent = 'ランキングデータ読込中...';
    if (statusEl) statusEl.style.display = 'none';
    if (btnEl) btnEl.disabled = true;

    try {
      if (progressBar) progressBar.style.width = '50%';
      const status = await RankingLoader.loadRankingFromSpreadsheet(urlInput.value.trim());
      if (progressBar) progressBar.style.width = '100%';
      this._updateRankingStatus(status);
      const now = new Date().toLocaleString('ja-JP');
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">読込済: ' + status.total + '名 (' + now + ')</span>';
      }
      this.showMessage('ランキングデータを読み込みました (' + status.total + '名)', 'success');
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.innerHTML = '<span class="status-icon status-error">&#9679;</span><span class="status-text">エラー: ' + err.message + '</span>';
      }
      this.showMessage('読み込み失敗: ' + err.message, 'error');
    } finally {
      if (btnEl) btnEl.disabled = false;
      setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 500);
    }
  },

  async _loadFuriganaFromGS() {
    const urlInput = document.getElementById('gs-furigana-url');
    const statusEl = document.getElementById('gs-furigana-status');
    const btnEl = document.getElementById('btn-gs-furigana');
    const progressEl = document.getElementById('gs-furigana-progress');
    const progressBar = document.getElementById('gs-furigana-progress-bar');
    const progressText = document.getElementById('gs-furigana-progress-text');
    if (!urlInput || !urlInput.value.trim()) {
      this.showMessage('スプレッドシートのURLまたはIDを入力してください', 'error');
      return;
    }

    try { localStorage.setItem('drawSystem_gsFuriganaUrl', urlInput.value.trim()); } catch (e) {}
    this._updateGSLinkButtons();

    if (progressEl) progressEl.style.display = '';
    if (progressBar) progressBar.style.width = '20%';
    if (progressText) progressText.textContent = 'ふりがなデータ読込中...';
    if (statusEl) statusEl.style.display = 'none';
    if (btnEl) btnEl.disabled = true;

    try {
      if (progressBar) progressBar.style.width = '50%';
      await RankingLoader.loadFuriganaFromSpreadsheet(urlInput.value.trim());
      if (progressBar) progressBar.style.width = '100%';
      const count = Object.keys(RankingLoader.furiganaMap).length;
      const now = new Date().toLocaleString('ja-JP');
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">読込済: ' + count + '件 (' + now + ')</span>';
      }
      this.showMessage('ふりがなデータを読み込みました (' + count + '件)', 'success');
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.innerHTML = '<span class="status-icon status-error">&#9679;</span><span class="status-text">エラー: ' + err.message + '</span>';
      }
      this.showMessage('読み込み失敗: ' + err.message, 'error');
    } finally {
      if (btnEl) btnEl.disabled = false;
      setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 500);
    }
  },

  _setupDropZone(dropZone, fileInput, handler) {
    // ドラッグ&ドロップ
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handler(e.dataTransfer.files[0]);
      }
    });
    // クリックでファイル選択
    dropZone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handler(e.target.files[0]);
        }
      });
    }
  },

  async _loadRankingFile(file) {
    try {
      const status = await RankingLoader.loadRankingFile(file);
      this._updateRankingStatus(status);
      this.showMessage('ランキングデータを読み込みました', 'success');
    } catch (err) {
      console.error(err);
      this.showMessage('ランキングデータの読み込みに失敗しました: ' + err.message, 'error');
    }
  },

  async _loadFuriganaFile(file) {
    try {
      await RankingLoader.loadFuriganaFile(file);
      const statusEl = document.getElementById('status-furigana');
      if (statusEl) {
        const count = Object.keys(RankingLoader.furiganaMap).length;
        statusEl.innerHTML =
          '<span class="status-icon status-ok">&#9679;</span>' +
          '<span class="status-text">読込済: ' + count + '件</span>';
      }
      this.showMessage('ふりがなデータを読み込みました', 'success');
    } catch (err) {
      console.error(err);
      this.showMessage('ふりがなデータの読み込みに失敗しました: ' + err.message, 'error');
    }
  },

  _updateRankingStatus(status) {
    // ファイル読込ステータス更新
    const statusEl = document.getElementById('status-ranking');
    if (statusEl) {
      statusEl.innerHTML =
        '<span class="status-icon status-ok">&#9679;</span>' +
        '<span class="status-text">読込済: ' + status.total + '名</span>';
    }
    // サマリー表示
    const summaryEl = document.getElementById('data-summary');
    if (summaryEl) {
      summaryEl.style.display = '';
      const playerCount = document.getElementById('summary-player-count');
      const eventCount = document.getElementById('summary-event-count');
      const maleCount = document.getElementById('summary-male-count');
      const femaleCount = document.getElementById('summary-female-count');
      const furiganaCountEl = document.getElementById('summary-furigana-count');
      if (playerCount) playerCount.textContent = status.total;

      // 男子/女子を種目コードから集計（m=男子, l=女子）
      let maleTotal = 0, femaleTotal = 0;
      let evtCount = 0;
      const detailLines = [];
      for (const evt of AppConfig.EVENTS) {
        if (status[evt.code] && status[evt.code].count > 0) {
          evtCount++;
          detailLines.push(evt.shortName + ': ' + status[evt.code].count + '名');
          if (evt.code.startsWith('m')) {
            maleTotal += status[evt.code].count;
          } else if (evt.code.startsWith('l')) {
            femaleTotal += status[evt.code].count;
          }
        }
      }
      if (maleCount) maleCount.textContent = maleTotal;
      if (femaleCount) femaleCount.textContent = femaleTotal;
      if (eventCount) eventCount.textContent = evtCount;

      // ふりがなデータ件数
      const furiganaTotal = Object.keys(RankingLoader.furiganaMap || {}).length;
      if (furiganaCountEl) furiganaCountEl.textContent = furiganaTotal + '件';

      // 種目別の詳細表示
      const detailEl = document.getElementById('data-summary-detail');
      if (detailEl && detailLines.length > 0) {
        detailEl.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px;color:#555;">' +
          detailLines.map(l => '<span>' + l + '</span>').join('') + '</div>';
      }
    }
  },

  // ================================================================
  // ランキング閲覧画面
  // ================================================================

  _rankingFilter: { eventCode: '', query: '', showList: false, category: 'singles' },

  initRankingScreen() {
    const searchInput = document.getElementById('ranking-search');
    if (searchInput) {
      let timer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          this._rankingFilter.query = searchInput.value.trim();
          this._renderRankingRows();
        }, 200);
      });
    }

    // カテゴリ切替ボタン
    const toggleEl = document.getElementById('ranking-category-toggle');
    if (toggleEl) {
      toggleEl.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._rankingFilter.category = btn.dataset.category;
          this._rankingFilter.eventCode = '';
          this._rankingFilter.showList = false;
          toggleEl.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.refreshRankingTable();
        });
      });
    }
  },

  refreshRankingTable() {
    const tabsEl = document.getElementById('ranking-event-tabs');
    const currentCategory = this._rankingFilter.category;
    const categoryEvents = AppConfig.EVENTS.filter(e => e.category === currentCategory);

    if (tabsEl) {
      tabsEl.innerHTML = '';

      for (const evt of categoryEvents) {
        const count = (RankingLoader.rankings[evt.code] || []).length;
        if (count === 0) continue;
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm ' + (!this._rankingFilter.showList && this._rankingFilter.eventCode === evt.code ? 'btn-primary' : 'btn-secondary');
        btn.textContent = evt.shortName + ' (' + count + ')';
        btn.addEventListener('click', () => {
          this._rankingFilter.eventCode = evt.code;
          this._rankingFilter.showList = false;
          this.refreshRankingTable();
        });
        tabsEl.appendChild(btn);
      }

      // リスト登録者タブ
      const listCount = (RankingLoader.listMembers || []).length;
      if (listCount > 0) {
        const sep = document.createElement('span');
        sep.style.cssText = 'width:1px;height:20px;background:#d1d5db;margin:0 4px;';
        tabsEl.appendChild(sep);

        const listBtn = document.createElement('button');
        listBtn.className = 'btn btn-sm ' + (this._rankingFilter.showList ? 'btn-primary' : 'btn-secondary');
        listBtn.textContent = 'リスト登録者 (' + listCount + ')';
        listBtn.addEventListener('click', () => {
          this._rankingFilter.showList = true;
          this._rankingFilter.eventCode = '';
          this.refreshRankingTable();
        });
        tabsEl.appendChild(listBtn);
      }

      // 全種目タブ（最後）
      const sep2 = document.createElement('span');
      sep2.style.cssText = 'width:1px;height:20px;background:#d1d5db;margin:0 4px;';
      tabsEl.appendChild(sep2);
      const allBtn = document.createElement('button');
      allBtn.className = 'btn btn-sm ' + (!this._rankingFilter.showList && this._rankingFilter.eventCode === '' ? 'btn-primary' : 'btn-secondary');
      allBtn.textContent = '全種目';
      allBtn.addEventListener('click', () => {
        this._rankingFilter.eventCode = '';
        this._rankingFilter.showList = false;
        this.refreshRankingTable();
      });
      tabsEl.appendChild(allBtn);
    }

    this._renderRankingRows();
  },

  _renderRankingRows() {
    const tbody = document.getElementById('ranking-table-body');
    const countEl = document.getElementById('ranking-count');
    const emptyMsg = document.getElementById('ranking-empty-msg');
    const table = document.getElementById('ranking-table');
    if (!tbody) return;

    let players = [];
    let isListView = this._rankingFilter.showList;
    const currentCategory = this._rankingFilter.category;
    const categoryEventCodes = new Set(AppConfig.EVENTS.filter(e => e.category === currentCategory).map(e => e.code));

    if (isListView) {
      // リスト登録者（ランキング外）
      players = (RankingLoader.listMembers || []).map(m => ({
        rank: '-',
        name: m.name,
        furigana: m.furigana,
        affiliation: '',
        points: 0,
        eventCode: '',
      }));
    } else if (this._rankingFilter.eventCode) {
      players = (RankingLoader.rankings[this._rankingFilter.eventCode] || []).map(p => ({ ...p }));
    } else {
      // 全種目 → 現在のカテゴリでフィルタ
      players = (RankingLoader.allPlayers || []).filter(p => categoryEventCodes.has(p.eventCode)).map(p => ({ ...p }));
    }

    // 検索フィルター
    const q = this._rankingFilter.query.toLowerCase().replace(/ /g, '\u3000');
    if (q) {
      players = players.filter(p => {
        const furigana = p.furigana || RankingLoader.furiganaMap[p.name] || '';
        return p.name.toLowerCase().includes(q) ||
               furigana.toLowerCase().includes(q) ||
               (p.affiliation || '').toLowerCase().includes(q);
      });
    }

    tbody.innerHTML = '';

    if (players.length === 0 && RankingLoader.allPlayers.length === 0 && (RankingLoader.listMembers || []).length === 0) {
      if (emptyMsg) emptyMsg.style.display = '';
      if (table) table.style.display = 'none';
      if (countEl) countEl.textContent = '';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (table) table.style.display = '';
    if (countEl) countEl.textContent = players.length + '名' + (q ? '（検索結果）' : '');

    // エントリー済み名簿をチェック用に構築
    const enteredSet = new Set();
    const allEntries = EntryStore.getAll();
    for (const e of allEntries) {
      enteredSet.add(e.name + '|' + e.eventCode);
    }

    const maxStagger = 30; // アニメーション付与は最初の30行まで
    players.forEach((p, idx) => {
      const tr = document.createElement('tr');
      if (idx < maxStagger) {
        tr.classList.add('row-enter');
        tr.style.animationDelay = (idx * 20) + 'ms';
      }
      const evtObj = p.eventCode ? AppConfig.EVENTS.find(e => e.code === p.eventCode) : null;
      const furigana = p.furigana || RankingLoader.furiganaMap[p.name] || '';
      const isEntered = p.eventCode ? enteredSet.has(p.name + '|' + p.eventCode) : false;
      if (isEntered) tr.classList.add('row-entered');

      const furiganaHtml = furigana ? '<span style="display:block;font-size:10px;color:#9ca3af;line-height:1;">' + this._esc(furigana) + '</span>' : '';
      tr.innerHTML =
        '<td class="text-center">' + (p.rank === '-' ? '<span style="color:#9ca3af;">-</span>' : p.rank) + '</td>' +
        '<td>' + furiganaHtml + '<strong style="white-space:nowrap;">' + this._esc(p.name) + '</strong></td>' +
        '<td style="white-space:nowrap;">' + this._esc(p.affiliation || '') + '</td>' +
        '<td class="text-center">' + (p.points || '-') + '</td>' +
        '<td class="action-cell"></td>';

      const actionCell = tr.querySelector('.action-cell');

      if (isEntered) {
        tr.classList.add('row-entered');
        const badge = document.createElement('span');
        badge.className = 'entered-badge';
        badge.textContent = '登録済';
        actionCell.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-entry-quick';
        btn.textContent = 'エントリー';
        btn.addEventListener('click', () => {
          this._quickEntryInline(p, tr, btn);
        });
        actionCell.appendChild(btn);
      }

      tbody.appendChild(tr);
    });
  },

  /**
   * ランキング画面からのクイックエントリー（インライン・画面更新なし）
   */
  _quickEntryInline(player, tr, btn) {
    if (player.eventCode) {
      const furigana = player.furigana || RankingLoader.furiganaMap[player.name] || '';
      EntryStore.add({
        name: player.name,
        furigana: furigana,
        affiliation: player.affiliation || '',
        eventCode: player.eventCode,
        points: player.points || 0,
      });
      RankingLoader.addToFuriganaMap(player.name, furigana);

      // ボタンを「登録済」バッジに変更
      btn.remove();
      const badge = document.createElement('span');
      badge.className = 'entered-badge';
      badge.textContent = '登録済';
      tr.querySelector('.action-cell').appendChild(badge);

      // 行を目立つ色にフラッシュしてからグレーに
      tr.style.transition = 'background-color 0.3s';
      tr.style.backgroundColor = '#ffeb3b';
      setTimeout(() => {
        tr.style.backgroundColor = '#e0e0e0';
        tr.classList.add('row-entered');
      }, 800);
    } else {
      this._showQuickEntryModal(player);
    }
  },

  /**
   * ランキング画面からのクイックエントリー（モーダル経由）
   */
  _quickEntry(player) {
    if (player.eventCode) {
      const furigana = player.furigana || RankingLoader.furiganaMap[player.name] || '';
      EntryStore.add({
        name: player.name,
        furigana: furigana,
        affiliation: player.affiliation || '',
        eventCode: player.eventCode,
        points: player.points || 0,
      });
      RankingLoader.addToFuriganaMap(player.name, furigana);
      this._renderRankingRows();
    } else {
      this._showQuickEntryModal(player);
    }
  },

  _showQuickEntryModal(player) {
    // エントリー追加モーダルを流用
    const modal = document.getElementById('modal-entry-add');
    const title = document.getElementById('modal-entry-title');
    if (!modal) return;

    this._editingEntryId = null;
    if (title) title.textContent = 'エントリー追加';

    const furigana = player.furigana || RankingLoader.furiganaMap[player.name] || '';
    document.getElementById('entry-name').value = player.name || '';
    document.getElementById('entry-furigana').value = furigana;
    document.getElementById('entry-club').value = player.affiliation || '';
    document.getElementById('entry-event').value = player.eventCode || '';
    document.getElementById('entry-point').value = player.points || 0;

    this._clearSuggestions();
    modal.style.display = '';
  },

  // ================================================================
  // OCR入力画面
  // ================================================================

  initOCRScreen() {
    const btnCamera = document.getElementById('btn-camera');
    const btnFileSelect = document.getElementById('btn-file-select');
    const fileInput = document.getElementById('file-ocr-input');
    const btnCapture = document.getElementById('btn-capture');
    const btnCameraClose = document.getElementById('btn-camera-close');
    const btnOCRExecute = document.getElementById('btn-ocr-execute');
    const btnOCRRegister = document.getElementById('btn-ocr-register');
    const checkAll = document.getElementById('ocr-check-all');

    // カメラ撮影ボタン
    if (btnCamera && fileInput) {
      btnCamera.addEventListener('click', () => {
        fileInput.setAttribute('capture', 'environment');
        fileInput.click();
      });
    }

    // ファイル選択ボタン
    if (btnFileSelect && fileInput) {
      btnFileSelect.addEventListener('click', () => {
        fileInput.removeAttribute('capture');
        fileInput.click();
      });
    }

    // ファイル選択/カメラ撮影の結果
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this._handleOCRImage(e.target.files[0]);
        }
      });
    }

    // カメラプレビューの撮影・閉じる
    if (btnCapture) {
      btnCapture.addEventListener('click', () => this._captureFromCamera());
    }
    if (btnCameraClose) {
      btnCameraClose.addEventListener('click', () => this._closeCamera());
    }

    // OCR 実行
    if (btnOCRExecute) {
      btnOCRExecute.addEventListener('click', () => this._executeOCR());
    }

    // OCR 結果の全選択
    if (checkAll) {
      checkAll.addEventListener('change', () => {
        document.querySelectorAll('#ocr-result-body input[type="checkbox"]').forEach(cb => {
          cb.checked = checkAll.checked;
        });
        this._updateOCRSelectedCount();
      });
    }

    // OCR 結果の登録
    if (btnOCRRegister) {
      btnOCRRegister.addEventListener('click', () => this._registerOCRResults());
    }

    // Gemini APIキーの復元
    const geminiKeyInput = document.getElementById('gemini-api-key');
    if (geminiKeyInput) {
      try {
        const savedKey = localStorage.getItem('drawSystem_geminiApiKey');
        if (savedKey) geminiKeyInput.value = savedKey;
      } catch (e) {}
    }

    // エンジン切替でAPIキー欄の表示/非表示
    const engineSelect = document.getElementById('ocr-engine-select');
    const apiKeyGroup = document.getElementById('gemini-api-key-group');
    if (engineSelect && apiKeyGroup) {
      const toggleApiKey = () => {
        apiKeyGroup.style.display = engineSelect.value === 'gemini' ? '' : 'none';
      };
      engineSelect.addEventListener('change', toggleApiKey);
      toggleApiKey();
    }
  },

  _handleOCRImage(file) {
    const previewArea = document.getElementById('ocr-preview-area');
    const previewImg = document.getElementById('ocr-preview-img');
    if (!previewArea || !previewImg) return;

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.style.display = 'block';
    previewArea.style.display = '';
    this._ocrImageFile = file;

    // 結果エリアを隠す
    const resultArea = document.getElementById('ocr-result-area');
    if (resultArea) resultArea.style.display = 'none';
  },

  _captureFromCamera() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('ocr-canvas');
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      this._handleOCRImage(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
      this._closeCamera();
    }, 'image/jpeg');
  },

  _closeCamera() {
    const cameraContainer = document.getElementById('camera-container');
    const video = document.getElementById('camera-video');
    if (cameraContainer) cameraContainer.style.display = 'none';
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
  },

  async _executeOCR() {
    if (!this._ocrImageFile) {
      this.showMessage('画像を選択してください', 'error');
      return;
    }

    const progressEl = document.getElementById('ocr-progress');
    const progressBar = document.getElementById('ocr-progress-bar');
    const progressText = document.getElementById('ocr-progress-text');
    if (progressEl) progressEl.style.display = '';

    const engineSelect = document.getElementById('ocr-engine-select');
    const useGemini = engineSelect && engineSelect.value === 'gemini';

    try {
      if (useGemini) {
        await this._executeGeminiOCR(progressBar, progressText);
      } else {
        await this._executeTesseractOCR(progressBar, progressText);
      }
    } catch (err) {
      console.error(err);
      this.showMessage('OCR認識に失敗しました: ' + err.message, 'error');
    } finally {
      if (progressEl) progressEl.style.display = 'none';
    }
  },

  async _executeTesseractOCR(progressBar, progressText) {
    if (typeof Tesseract === 'undefined') {
      this.showMessage('OCRライブラリ(Tesseract.js)が読み込まれていません', 'error');
      return;
    }

    const result = await Tesseract.recognize(this._ocrImageFile, 'jpn', {
      logger: (m) => {
        if (m.status === 'recognizing text' && progressBar) {
          const pct = Math.round(m.progress * 100);
          progressBar.style.width = pct + '%';
          if (progressText) progressText.textContent = '認識中... ' + pct + '%';
        }
      },
    });

    const text = result.data.text;
    this._displayOCRResults(text);
    this.showMessage('OCR認識が完了しました', 'success');
  },

  async _executeGeminiOCR(progressBar, progressText) {
    const apiKeyInput = document.getElementById('gemini-api-key');
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    if (!apiKey) {
      this.showMessage('Gemini APIキーを入力してください', 'error');
      return;
    }

    // APIキーをlocalStorageに保存
    try { localStorage.setItem('drawSystem_geminiApiKey', apiKey); } catch (e) {}

    if (progressBar) progressBar.style.width = '30%';
    if (progressText) progressText.textContent = 'Gemini AIで認識中...';

    // 画像をBase64に変換
    const base64 = await this._fileToBase64(this._ocrImageFile);
    const mimeType = this._ocrImageFile.type || 'image/jpeg';

    if (progressBar) progressBar.style.width = '50%';

    const requestBody = {
      contents: [{
        parts: [
          {
            text: 'この画像はテニス大会のエントリー申込用紙です。手書きの氏名を読み取ってください。\n' +
              '以下のフォーマットで全ての氏名を1行ずつ出力してください。所属が読み取れる場合はカンマ区切りで追加してください。\n' +
              'フォーマット: 氏名,所属\n' +
              '例:\n山田 太郎,鳥取TC\n鈴木 花子,米子クラブ\n\n' +
              '注意:\n- 姓と名の間にスペースを入れてください\n- 読み取れない文字は?で表記してください\n- ヘッダーや説明文は不要です。氏名のみ出力してください'
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64,
            }
          }
        ]
      }]
    };

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error('Gemini API エラー: ' + (errorData.error?.message || response.statusText));
    }

    const data = await response.json();
    if (progressBar) progressBar.style.width = '90%';

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text.trim()) {
      this.showMessage('テキストが認識できませんでした', 'error');
      return;
    }

    this._displayOCRResults(text);
    this.showMessage('Gemini AIで認識が完了しました', 'success');
  },

  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // data:image/jpeg;base64,XXXX の XXXX 部分を取得
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  _displayOCRResults(text) {
    const resultArea = document.getElementById('ocr-result-area');
    const tbody = document.getElementById('ocr-result-body');
    if (!resultArea || !tbody) return;

    resultArea.style.display = '';
    tbody.innerHTML = '';

    // テキストから氏名候補を抽出
    const extracted = FuzzyMatch.extractNames(text);

    for (const item of extracted) {
      // マッチング実行
      const candidates = item.possibleName ? FuzzyMatch.matchName(item.possibleName) : [];
      const bestMatch = candidates.length > 0 ? candidates[0] : null;

      const tr = document.createElement('tr');

      // チェックボックス
      const tdCheck = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = bestMatch !== null && bestMatch.score >= 60;
      cb.addEventListener('change', () => this._updateOCRSelectedCount());
      tdCheck.appendChild(cb);
      tr.appendChild(tdCheck);

      // 認識テキスト
      const tdRaw = document.createElement('td');
      tdRaw.textContent = item.rawText;
      tr.appendChild(tdRaw);

      // 氏名候補（ドロップダウン）
      const tdName = document.createElement('td');
      if (candidates.length > 0) {
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-sm';
        sel.innerHTML = '<option value="">-- 候補なし --</option>';
        for (const c of candidates.slice(0, 5)) {
          const opt = document.createElement('option');
          opt.value = c.name;
          opt.textContent = c.name + ' (' + c.score + ')';
          opt.dataset.affiliation = c.affiliation || '';
          opt.dataset.points = c.points || 0;
          opt.dataset.eventCode = c.eventCode || '';
          if (c === bestMatch) opt.selected = true;
          sel.appendChild(opt);
        }
        tdName.appendChild(sel);
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'form-input form-input-sm';
        inp.value = item.possibleName || '';
        tdName.appendChild(inp);
      }
      tr.appendChild(tdName);

      // 所属候補
      const tdClub = document.createElement('td');
      const clubInput = document.createElement('input');
      clubInput.type = 'text';
      clubInput.className = 'form-input form-input-sm';
      clubInput.value = bestMatch ? bestMatch.affiliation : (item.possibleAffiliation || '');
      tdClub.appendChild(clubInput);
      tr.appendChild(tdClub);

      // 種目（ドロップダウン）
      const tdEvent = document.createElement('td');
      const evtSel = document.createElement('select');
      evtSel.className = 'form-select form-select-sm';
      evtSel.innerHTML = '<option value="">選択</option>';
      for (const evt of AppConfig.EVENTS) {
        const opt = document.createElement('option');
        opt.value = evt.code;
        opt.textContent = evt.shortName;
        if (bestMatch && bestMatch.eventCode === evt.code) opt.selected = true;
        evtSel.appendChild(opt);
      }
      tdEvent.appendChild(evtSel);
      tr.appendChild(tdEvent);

      // 信頼度
      const tdConf = document.createElement('td');
      tdConf.textContent = bestMatch ? bestMatch.score + '%' : '-';
      if (bestMatch && bestMatch.score >= 80) {
        tdConf.style.color = '#2E7D32';
        tdConf.style.fontWeight = 'bold';
      } else if (bestMatch && bestMatch.score >= 60) {
        tdConf.style.color = '#F57F17';
      } else {
        tdConf.style.color = '#C62828';
      }
      tr.appendChild(tdConf);

      tbody.appendChild(tr);
    }

    this._updateOCRSelectedCount();
  },

  _updateOCRSelectedCount() {
    const count = document.querySelectorAll('#ocr-result-body input[type="checkbox"]:checked').length;
    const el = document.getElementById('ocr-selected-count');
    if (el) el.textContent = count + '件選択中';
  },

  _registerOCRResults() {
    const rows = document.querySelectorAll('#ocr-result-body tr');
    let registered = 0;

    rows.forEach(tr => {
      const cb = tr.querySelector('input[type="checkbox"]');
      if (!cb || !cb.checked) return;

      const cells = tr.querySelectorAll('td');
      // cells: [check, rawText, name, club, event, confidence]

      // 氏名取得
      let name = '';
      const nameSelect = cells[2].querySelector('select');
      const nameInput = cells[2].querySelector('input');
      if (nameSelect && nameSelect.value) {
        name = nameSelect.value;
      } else if (nameInput && nameInput.value) {
        name = nameInput.value.trim();
      }
      if (!name) return;

      // 所属
      const clubInput = cells[3].querySelector('input');
      const affiliation = clubInput ? clubInput.value.trim() : '';

      // 種目
      const evtSelect = cells[4].querySelector('select');
      const eventCode = evtSelect ? evtSelect.value : '';
      if (!eventCode) return;

      // ポイント取得（select の場合、選択中の option から）
      let points = 0;
      if (nameSelect && nameSelect.value) {
        const selectedOpt = nameSelect.options[nameSelect.selectedIndex];
        points = Number(selectedOpt.dataset.points) || 0;
      }

      // ふりがな
      const furigana = RankingLoader.furiganaMap[name] || '';

      // EntryStore に追加
      EntryStore.add({
        name: name,
        furigana: furigana,
        affiliation: affiliation,
        eventCode: eventCode,
        points: points,
      });
      registered++;
    });

    if (registered > 0) {
      this.showMessage(registered + '件をエントリーに登録しました', 'success');
      // チェックを外す
      document.querySelectorAll('#ocr-result-body input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
      this._updateOCRSelectedCount();
    } else {
      this.showMessage('登録する項目が選択されていません', 'error');
    }
  },

  // ================================================================
  // 大会設定
  // ================================================================

  _initTournamentSettings() {
    const tournamentSelect = document.getElementById('tournament-select');
    const dateInput = document.getElementById('tournament-date-input');
    const venueSelect = document.getElementById('tournament-venue-input');
    const formatSelect = document.getElementById('tournament-format-select');
    const formatCustom = document.getElementById('tournament-format-custom');

    // 大会プルダウンを構築
    this._refreshTournamentSelect();

    // 大会選択時に情報を自動セット
    if (tournamentSelect) {
      tournamentSelect.addEventListener('change', () => {
        const id = parseInt(tournamentSelect.value);
        if (!id) return;
        const t = TournamentStore.getById(id);
        if (!t) return;
        AppConfig.TOURNAMENT_NAME = t.name;
        if (dateInput) dateInput.value = t.date + (t.dayOfWeek ? ' ' + t.dayOfWeek : '');
        if (venueSelect) {
          // 会場を選択肢から探してセット、なければ最初の選択肢
          const venueMatch = (AppConfig.VENUE_OPTIONS || []).find(v => t.venue && v.includes(t.venue));
          if (venueMatch) venueSelect.value = venueMatch;
        }
        updateConfig();
      });
    }

    // 会場選択肢を構築
    if (venueSelect) {
      venueSelect.innerHTML = '';
      (AppConfig.VENUE_OPTIONS || []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        venueSelect.appendChild(opt);
      });
      venueSelect.value = AppConfig.TOURNAMENT_VENUE || '';
    }

    // ゲームルール選択肢を構築
    if (formatSelect) {
      formatSelect.innerHTML = '<option value="">-- 選択 --</option>';
      (AppConfig.MATCH_FORMAT_OPTIONS || []).forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        formatSelect.appendChild(opt);
      });
      const defaultFormat = AppConfig.MATCH_FORMAT || '';
      if ((AppConfig.MATCH_FORMAT_OPTIONS || []).includes(defaultFormat)) {
        formatSelect.value = defaultFormat;
      }
    }

    // 初期値セット
    if (dateInput) dateInput.value = AppConfig.TOURNAMENT_DATE || '';

    // 変更時にAppConfigに反映
    const updateConfig = () => {
      if (dateInput) AppConfig.TOURNAMENT_DATE = dateInput.value.trim();
      if (venueSelect) AppConfig.TOURNAMENT_VENUE = venueSelect.value;
      if (formatCustom && formatCustom.value.trim()) {
        AppConfig.MATCH_FORMAT = formatCustom.value.trim();
      } else if (formatSelect && formatSelect.value) {
        AppConfig.MATCH_FORMAT = formatSelect.value;
      }
    };

    if (dateInput) dateInput.addEventListener('change', updateConfig);
    if (venueSelect) venueSelect.addEventListener('change', updateConfig);
    if (formatSelect) formatSelect.addEventListener('change', () => {
      if (formatCustom && formatSelect.value) formatCustom.value = '';
      updateConfig();
    });
    if (formatCustom) formatCustom.addEventListener('input', updateConfig);
  },

  _refreshTournamentSelect() {
    const select = document.getElementById('tournament-select');
    if (!select) return;
    const prevValue = select.value;
    select.innerHTML = '<option value="">-- 大会を選択 --</option>';
    const tournaments = TournamentStore.getAll();
    tournaments.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      select.appendChild(opt);
    });
    if (prevValue) select.value = prevValue;
  },

  // ================================================================
  // エントリー一覧画面
  // ================================================================

  initEntryScreen() {
    // 大会設定の初期化
    this._initTournamentSettings();

    // 種目フィルタードロップダウン（refreshEntryTable内で動的に更新）
    const filterSelect = document.getElementById('entry-event-filter');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => this.refreshEntryTable());
    }

    // 手動追加ボタン
    const btnAdd = document.getElementById('btn-entry-add');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => this._showEntryModal());
    }

    // モーダル内の種目セレクト（refreshEntryTable内で動的に更新）

    // 保存ボタン
    const btnSave = document.getElementById('btn-entry-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => this._saveEntry());
    }

    // エクスポート
    const btnExport = document.getElementById('btn-entry-export');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const json = EntryStore.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'entries_' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        this.showMessage('エントリーデータをエクスポートしました', 'success');
      });
    }

    // インポート
    const btnImport = document.getElementById('btn-entry-import');
    const fileImport = document.getElementById('file-entry-import');
    if (btnImport && fileImport) {
      btnImport.addEventListener('click', () => fileImport.click());
      fileImport.addEventListener('change', (e) => {
        if (e.target.files.length === 0) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const count = EntryStore.importJSON(ev.target.result);
            this.refreshEntryTable();
            this.showMessage(count + '件のエントリーをインポートしました', 'success');
          } catch (err) {
            this.showMessage('インポートに失敗: ' + err.message, 'error');
          }
        };
        reader.readAsText(e.target.files[0]);
        fileImport.value = '';
      });
    }

    // 全クリア
    const btnClear = document.getElementById('btn-entry-clear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('全エントリーを削除しますか？この操作は取り消せません。')) {
          EntryStore.clear();
          this.refreshEntryTable();
          this.showMessage('全エントリーを削除しました', 'info');
        }
      });
    }

    // 氏名入力でサジェスト
    const entryName = document.getElementById('entry-name');
    if (entryName) {
      let debounceTimer = null;
      entryName.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => this._suggestPlayer(entryName.value), 300);
      });
    }
  },

  _showEntryModal(entryId) {
    const modal = document.getElementById('modal-entry-add');
    const title = document.getElementById('modal-entry-title');
    if (!modal) return;

    this._editingEntryId = entryId || null;

    if (entryId) {
      if (title) title.textContent = 'エントリー編集';
      const entry = EntryStore.getById(entryId);
      if (entry) {
        document.getElementById('entry-name').value = entry.name || '';
        document.getElementById('entry-furigana').value = entry.furigana || '';
        document.getElementById('entry-club').value = entry.affiliation || '';
        const evtEl = document.getElementById('entry-event');
        if (evtEl) { evtEl.disabled = false; evtEl.value = entry.eventCode || ''; }
        document.getElementById('entry-point').value = entry.points || 0;
      }
    } else {
      if (title) title.textContent = 'エントリー追加';
      document.getElementById('entry-name').value = '';
      document.getElementById('entry-furigana').value = '';
      document.getElementById('entry-club').value = '';
      document.getElementById('entry-point').value = 0;
      // 現在フィルターで選択中の種目に固定
      const filterSelect = document.getElementById('entry-event-filter');
      const currentFilter = filterSelect ? filterSelect.value : '';
      const evtSelect = document.getElementById('entry-event');
      if (evtSelect) {
        if (currentFilter) {
          evtSelect.value = currentFilter;
          evtSelect.disabled = true;
        } else {
          const allEntries = EntryStore.getAll();
          const entryEventCodes = [...new Set(allEntries.map(e => e.eventCode))];
          evtSelect.disabled = false;
          evtSelect.value = entryEventCodes.length === 1 ? entryEventCodes[0] : '';
        }
      }
    }

    // サジェストリストクリア
    this._clearSuggestions();

    modal.style.display = '';
  },

  _saveEntry() {
    const name = document.getElementById('entry-name').value.trim();
    const furigana = document.getElementById('entry-furigana').value.trim();
    const affiliation = document.getElementById('entry-club').value.trim();
    const eventCode = document.getElementById('entry-event').value;
    const points = Number(document.getElementById('entry-point').value) || 0;

    if (!name) {
      this.showMessage('氏名を入力してください', 'error');
      return;
    }
    if (!eventCode) {
      this.showMessage('種目を選択してください', 'error');
      return;
    }

    const data = { name, furigana, affiliation: affiliation || 'フリー', eventCode, points };

    if (this._editingEntryId) {
      EntryStore.update(this._editingEntryId, data);
      this.showMessage('エントリーを更新しました', 'success');
    } else {
      EntryStore.add(data);
      this.showMessage('エントリーを追加しました', 'success');
    }

    // リストにない人はふりがなマップに自動追加
    RankingLoader.addToFuriganaMap(name, furigana);

    this._editingEntryId = null;
    const modal = document.getElementById('modal-entry-add');
    if (modal) modal.style.display = 'none';

    this.refreshEntryTable();
  },

  _suggestPlayer(query) {
    this._clearSuggestions();
    if (!query || query.length < 1) return;

    // 現在選択中の種目でフィルター
    const evtSelect = document.getElementById('entry-event');
    const currentEventCode = evtSelect ? evtSelect.value : '';
    let results = RankingLoader.searchPlayers(query);
    if (currentEventCode) {
      results = results.filter(p => p.eventCode === currentEventCode);
    }
    if (results.length === 0) return;

    const nameInput = document.getElementById('entry-name');
    if (!nameInput) return;

    const list = document.createElement('ul');
    list.className = 'suggestion-list';
    list.id = 'entry-suggestions';
    list.style.cssText = 'position:absolute;z-index:1000;background:#fff;border:1px solid #ccc;' +
      'list-style:none;padding:0;margin:0;max-height:200px;overflow-y:auto;width:100%;';

    for (const p of results.slice(0, 8)) {
      const li = document.createElement('li');
      li.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #eee;';
      const evtName = AppConfig.EVENTS.find(e => e.code === p.eventCode);
      li.textContent = p.name + '  (' + p.affiliation + ')  [' + (evtName ? evtName.shortName : p.eventCode) + ' ' + p.points + 'pt]';
      li.addEventListener('click', () => {
        document.getElementById('entry-name').value = p.name;
        document.getElementById('entry-furigana').value = p.furigana || RankingLoader.furiganaMap[p.name] || '';
        document.getElementById('entry-club').value = p.affiliation || '';
        const evtEl = document.getElementById('entry-event');
        if (evtEl && !evtEl.disabled) {
          evtEl.value = p.eventCode || '';
        }
        document.getElementById('entry-point').value = p.points || 0;
        this._clearSuggestions();
      });
      li.addEventListener('mouseenter', () => { li.style.background = '#E3F2FD'; });
      li.addEventListener('mouseleave', () => { li.style.background = ''; });
      list.appendChild(li);
    }

    // 入力フィールドの親に追加
    const parent = nameInput.parentElement;
    parent.style.position = 'relative';
    parent.appendChild(list);
  },

  _clearSuggestions() {
    const existing = document.getElementById('entry-suggestions');
    if (existing) existing.remove();
  },

  refreshEntryTable() {
    const tbody = document.getElementById('entry-table-body');
    const totalCount = document.getElementById('entry-total-count');
    if (!tbody) return;

    // 大会プルダウンを更新
    this._refreshTournamentSelect();

    // エントリー済み種目を取得
    const allEntries = EntryStore.getAll();
    const entryEventCodes = [...new Set(allEntries.map(e => e.eventCode))];

    // 種目フィルターを動的に構築（エントリーがある種目のみ）
    const filterSelect = document.getElementById('entry-event-filter');
    if (filterSelect) {
      const prevValue = filterSelect.value;
      filterSelect.innerHTML = '';
      for (const code of entryEventCodes) {
        const evt = AppConfig.EVENTS.find(e => e.code === code);
        const count = allEntries.filter(e => e.eventCode === code).length;
        const isConfirmed = this.confirmedEvents && this.confirmedEvents[code];
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = (evt ? evt.name : code) + ' (' + count + ')' + (isConfirmed ? ' [確定済]' : '');
        filterSelect.appendChild(opt);
      }
      // エントリーが1種目だけならその種目を自動選択
      if (entryEventCodes.length === 1) {
        filterSelect.value = entryEventCodes[0];
      } else if (prevValue && entryEventCodes.includes(prevValue)) {
        filterSelect.value = prevValue;
      }
    }

    // モーダル内の種目セレクトも更新（エントリーが1種目のみならその種目に固定）
    const entryEventSelect = document.getElementById('entry-event');
    if (entryEventSelect) {
      entryEventSelect.innerHTML = '<option value="">選択してください</option>';
      for (const evt of AppConfig.EVENTS) {
        const opt = document.createElement('option');
        opt.value = evt.code;
        opt.textContent = evt.name;
        entryEventSelect.appendChild(opt);
      }
      // 1種目のみの場合は自動選択
      if (entryEventCodes.length === 1) {
        entryEventSelect.value = entryEventCodes[0];
      }
    }

    const filter = filterSelect ? filterSelect.value : '';

    let entries = allEntries;
    if (filter) {
      entries = entries.filter(e => e.eventCode === filter);
    }

    const targetCode = filter || (entryEventCodes.length === 1 ? entryEventCodes[0] : '');
    let isDoubles = false;
    try {
      isDoubles = !!(targetCode && EntryStore.isDoublesEvent(targetCode));
    } catch (e) {
      console.warn('isDoublesEvent error:', e);
    }

    // テーブルヘッダーを切り替え
    const thead = document.getElementById('entry-table-head');
    if (thead) {
      if (isDoubles) {
        thead.innerHTML = '<tr><th>P</th><th>氏名</th><th>所属</th><th>種目</th><th>個人pt</th><th>合計pt</th><th>操作</th></tr>';
      } else {
        thead.innerHTML = '<tr><th>No.</th><th>氏名</th><th>所属</th><th>種目</th><th>ポイント</th><th>操作</th></tr>';
      }
    }

    // ダブルスの場合はペア単位で表示
    if (isDoubles && targetCode) {
      try {
        this._renderDoublesEntryTable(tbody, targetCode, totalCount);
      } catch (e) {
        console.error('ダブルスエントリー表示エラー:', e);
        isDoubles = false; // フォールバック: シングルスとして表示
      }
    }
    if (!isDoubles) {
      // シングルス: ランキング順（ポイント降順）でソート
      entries.sort((a, b) => (b.points || 0) - (a.points || 0));
      tbody.innerHTML = '';
      if (totalCount) totalCount.textContent = entries.length;

      // シード・ドロー情報の表示（フィルター下部）
      try {
        const seedInfoEl = document.getElementById('entry-seed-info');
        if (seedInfoEl) {
          seedInfoEl.innerHTML = '';
          if (targetCode && entries.length > 3) {
            const drawSize = DrawEngine.getDrawSize(entries.length);
            const seedRule = AppConfig.SEED_RULES[drawSize];
            const seedCount = seedRule ? seedRule.seeds : 0;
            const sorted = [...entries].sort((a, b) => (b.points || 0) - (a.points || 0));
            const seedPlayers = sorted.slice(0, seedCount);

            let html = '<div class="draw-info-grid">' +
              '<div class="draw-info-item"><span class="draw-info-label">エントリー</span><span class="draw-info-value">' + entries.length + '名</span></div>' +
              '<div class="draw-info-item"><span class="draw-info-label">ドローサイズ</span><span class="draw-info-value">' + drawSize + '</span></div>' +
              '<div class="draw-info-item"><span class="draw-info-label">BYE</span><span class="draw-info-value">' + (drawSize - entries.length) + '</span></div>' +
              '<div class="draw-info-item"><span class="draw-info-label">シード</span><span class="draw-info-value">' + seedCount + '名</span></div>' +
              '</div>';
            if (seedPlayers.length > 0) {
              html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">';
              seedPlayers.forEach((p, i) => {
                html += '<span class="seed-chip">[' + (i + 1) + '] ' + this._esc(p.name) + ' <small>(' + (p.points || 0) + 'pt)</small></span>';
              });
              html += '</div>';
            }
            seedInfoEl.innerHTML = html;
          }
        }
      } catch (e) {
        console.warn('シード情報の表示エラー:', e);
      }

      entries.forEach((entry, idx) => {
        const tr = document.createElement('tr');
        if (idx < 30) {
          tr.classList.add('row-enter');
          tr.style.animationDelay = (idx * 20) + 'ms';
        }
        const evtObj = AppConfig.EVENTS.find(e => e.code === entry.eventCode);
        const evtName = evtObj ? evtObj.shortName : entry.eventCode;
        const entryFuriganaHtml = entry.furigana ? '<span style="display:block;font-size:10px;color:#9ca3af;line-height:1;">' + this._esc(entry.furigana) + '</span>' : '';

        tr.innerHTML =
          '<td>' + (idx + 1) + '</td>' +
          '<td>' + entryFuriganaHtml + this._esc(entry.name) + '</td>' +
          '<td>' + this._esc(entry.affiliation || '') + '</td>' +
          '<td>' + this._esc(evtName) + '</td>' +
          '<td>' + (entry.points || 0) + '</td>' +
          '<td class="action-cell"></td>';

        const actionCell = tr.querySelector('.action-cell');

        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn-sm btn-secondary';
        btnEdit.textContent = '編集';
        btnEdit.addEventListener('click', () => this._showEntryModal(entry.id));
        actionCell.appendChild(btnEdit);

        const btnDel = document.createElement('button');
        btnDel.className = 'btn btn-sm btn-danger';
        btnDel.textContent = '削除';
        btnDel.style.marginLeft = '4px';
        btnDel.addEventListener('click', () => {
          if (confirm(entry.name + ' を削除しますか？')) {
            EntryStore.remove(entry.id);
            this.refreshEntryTable();
            this.showMessage('エントリーを削除しました', 'info');
          }
        });
        actionCell.appendChild(btnDel);

        tbody.appendChild(tr);
      });
    }
  },

  /**
   * ダブルスのエントリーテーブル表示（ペア単位・合計ランキング順）
   */
  _renderDoublesEntryTable(tbody, eventCode, totalCountEl) {
    const pairs = EntryStore.getDoublesPairs(eventCode);
    // 合計ポイント降順でソート
    pairs.sort((a, b) => (b.points || 0) - (a.points || 0));
    const allEntries = EntryStore.entries.filter(e => e.eventCode === eventCode);
    tbody.innerHTML = '';
    if (totalCountEl) totalCountEl.textContent = allEntries.length + '名 (' + pairs.length + 'ペア)';

    // シード・ドロー情報
    const seedInfoEl = document.getElementById('entry-seed-info');
    if (seedInfoEl) {
      seedInfoEl.innerHTML = '';
      const completePairs = pairs.filter(p => !p.incomplete);
      if (completePairs.length > 3) {
        const drawSize = DrawEngine.getDrawSize(completePairs.length);
        const seedRule = AppConfig.SEED_RULES[drawSize];
        const seedCount = seedRule ? seedRule.seeds : 0;
        const seedPairs = completePairs.slice(0, seedCount);

        let html = '<div class="draw-info-grid">' +
          '<div class="draw-info-item"><span class="draw-info-label">ペア数</span><span class="draw-info-value">' + completePairs.length + '</span></div>' +
          '<div class="draw-info-item"><span class="draw-info-label">ドローサイズ</span><span class="draw-info-value">' + drawSize + '</span></div>' +
          '<div class="draw-info-item"><span class="draw-info-label">BYE</span><span class="draw-info-value">' + (drawSize - completePairs.length) + '</span></div>' +
          '<div class="draw-info-item"><span class="draw-info-label">シード</span><span class="draw-info-value">' + seedCount + '</span></div>' +
          '</div>';
        if (seedPairs.length > 0) {
          html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">';
          seedPairs.forEach((p, i) => {
            html += '<span class="seed-chip">[' + (i + 1) + '] ' + this._esc(p.name) + ' <small>(' + p.points + 'pt)</small></span>';
          });
          html += '</div>';
        }
        seedInfoEl.innerHTML = html;
      }
    }

    // 入れ替え選択中の状態
    this._swapSelectedEntryId = this._swapSelectedEntryId || null;
    this._swapEventCode = eventCode;

    // ペアごとに2行でグループ表示（水色/白の2色交互、不完全ペアは赤）
    pairs.forEach((pair, pairIdx) => {
      const isIncomplete = pair.incomplete;
      const bgColor = isIncomplete ? '#ffebee' : (pairIdx % 2 === 0 ? '#e3f2fd' : '#ffffff');
      pair.entries.forEach((entry, entryIdx) => {
        const tr = document.createElement('tr');
        if (pairIdx < 15) {
          tr.classList.add('row-enter');
          tr.style.animationDelay = (pairIdx * 30) + 'ms';
        }
        tr.style.backgroundColor = bgColor;
        if (isIncomplete) {
          tr.style.borderLeft = '3px solid #ef5350';
        }

        // 選択中の行をハイライト
        if (this._swapSelectedEntryId === entry.id) {
          tr.style.backgroundColor = '#bbdefb';
          tr.style.outline = '2px solid #1976d2';
        }

        // ペア番号・合計ptは最初の行にのみ表示
        const pairLabel = entryIdx === 0
          ? '<span style="font-weight:bold;color:#1a56db;">P' + (pairIdx + 1) + '</span>'
          : '';
        const combinedPtsLabel = entryIdx === 0
          ? '<span style="font-weight:bold;color:#1a56db;">' + pair.points + '</span>'
          : '';

        const dblFuriganaHtml = entry.furigana ? '<span style="display:block;font-size:10px;color:#9ca3af;line-height:1;">' + this._esc(entry.furigana) + '</span>' : '';
        tr.innerHTML =
          '<td class="text-center">' + pairLabel + '</td>' +
          '<td class="doubles-swap-cell" style="cursor:pointer;">' + dblFuriganaHtml + this._esc(entry.name) + '</td>' +
          '<td>' + this._esc(entry.affiliation || '') + '</td>' +
          '<td>' + this._esc(AppConfig.EVENTS.find(e => e.code === entry.eventCode)?.shortName || entry.eventCode) + '</td>' +
          '<td>' + (entry.points || 0) + '</td>' +
          '<td class="text-center">' + combinedPtsLabel + '</td>' +
          '<td class="action-cell"></td>';

        // 名前セルクリックで入れ替え
        const nameCell = tr.querySelector('.doubles-swap-cell');
        nameCell.addEventListener('click', () => {
          if (this._swapSelectedEntryId === null) {
            // 1人目を選択
            this._swapSelectedEntryId = entry.id;
            this.showMessage(entry.name + ' を選択中 — 入れ替え先をクリックしてください', 'info');
            this.refreshEntryTable();
          } else if (this._swapSelectedEntryId === entry.id) {
            // 同じ人を再クリック → キャンセル
            this._swapSelectedEntryId = null;
            this.refreshEntryTable();
          } else {
            // 2人目をクリック → 入れ替え実行
            EntryStore.swapDoublesOrder(eventCode, this._swapSelectedEntryId, entry.id);
            this._swapSelectedEntryId = null;
            this.refreshEntryTable();
            this.showMessage('ペアを入れ替えました', 'success');
          }
        });

        const actionCell = tr.querySelector('.action-cell');

        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn-sm btn-secondary';
        btnEdit.textContent = '編集';
        btnEdit.addEventListener('click', () => this._showEntryModal(entry.id));
        actionCell.appendChild(btnEdit);

        const btnDel = document.createElement('button');
        btnDel.className = 'btn btn-sm btn-danger';
        btnDel.textContent = '削除';
        btnDel.style.marginLeft = '4px';
        btnDel.addEventListener('click', () => {
          if (confirm(entry.name + ' を削除しますか？')) {
            EntryStore.remove(entry.id);
            this._swapSelectedEntryId = null;
            this.refreshEntryTable();
            this.showMessage('エントリーを削除しました', 'info');
          }
        });
        actionCell.appendChild(btnDel);

        tbody.appendChild(tr);
      });

      // ペア間の区切り線
      if (pairIdx < pairs.length - 1) {
        const separatorTr = document.createElement('tr');
        separatorTr.innerHTML = '<td colspan="7" style="padding:0;height:2px;background:#cbd5e1;"></td>';
        tbody.appendChild(separatorTr);
      }
    });
  },

  // ================================================================
  // 大会一覧画面
  // ================================================================

  initTournamentsScreen() {
    TournamentStore.init();

    // デフォルト大会を初期登録（データがない場合のみ）
    if (TournamentStore.getAll().length === 0 && AppConfig.DEFAULT_TOURNAMENTS) {
      for (const t of AppConfig.DEFAULT_TOURNAMENTS) {
        TournamentStore.add(t);
      }
    }

    const btnAdd = document.getElementById('btn-tournament-add');
    if (btnAdd) btnAdd.addEventListener('click', () => this._showTournamentModal());

    const btnClear = document.getElementById('btn-tournament-clear');
    if (btnClear) btnClear.addEventListener('click', () => {
      if (confirm('全大会データを削除しますか？')) {
        TournamentStore.clear();
        this.refreshTournamentsTable();
        this.showMessage('全大会データを削除しました', 'info');
      }
    });

    const fileInput = document.getElementById('file-tournament-import');
    if (fileInput) fileInput.addEventListener('change', (e) => this._importTournamentExcel(e));

    const btnSave = document.getElementById('btn-tournament-save');
    if (btnSave) btnSave.addEventListener('click', () => this._saveTournament());
  },

  refreshTournamentsTable() {
    const tbody = document.getElementById('tournament-table-body');
    const countEl = document.getElementById('tournament-count');
    if (!tbody) return;

    const tournaments = TournamentStore.getAll();
    if (countEl) countEl.textContent = tournaments.length;
    tbody.innerHTML = '';

    tournaments.forEach((t, idx) => {
      const tr = document.createElement('tr');
      if (idx < 30) {
        tr.classList.add('row-enter');
        tr.style.animationDelay = (idx * 20) + 'ms';
      }
      tr.innerHTML =
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + this._esc(t.name) + '</td>' +
        '<td>' + this._esc(t.events || '') + '</td>' +
        '<td>' + this._esc(t.date + (t.dayOfWeek ? ' ' + t.dayOfWeek : '')) + '</td>' +
        '<td>' + this._esc(t.venue || '') + '</td>' +
        '<td>' + this._esc(t.reserveDate || '') + '</td>' +
        '<td>' + this._esc(t.reserveVenue || '') + '</td>' +
        '<td class="action-cell"></td>';

      const actionCell = tr.querySelector('.action-cell');
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-sm btn-secondary';
      btnEdit.textContent = '編集';
      btnEdit.addEventListener('click', () => this._showTournamentModal(t.id));
      actionCell.appendChild(btnEdit);

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-sm btn-danger';
      btnDel.textContent = '削除';
      btnDel.style.marginLeft = '4px';
      btnDel.addEventListener('click', () => {
        if (confirm(t.name + ' を削除しますか？')) {
          TournamentStore.remove(t.id);
          this.refreshTournamentsTable();
          this.showMessage('大会を削除しました', 'info');
        }
      });
      actionCell.appendChild(btnDel);
      tbody.appendChild(tr);
    });
  },

  _showTournamentModal(id) {
    const modal = document.getElementById('modal-tournament-edit');
    const title = document.getElementById('modal-tournament-title');
    const btnDup = document.getElementById('btn-tournament-duplicate');
    if (!modal) return;

    this._editingTournamentId = id || null;

    if (id) {
      if (title) title.textContent = '大会編集';
      const t = TournamentStore.getById(id);
      if (t) {
        document.getElementById('tournament-edit-name').value = t.name || '';
        document.getElementById('tournament-edit-events').value = t.events || '';
        document.getElementById('tournament-edit-date').value = t.date || '';
        document.getElementById('tournament-edit-dow').value = t.dayOfWeek || '';
        document.getElementById('tournament-edit-venue').value = t.venue || '';
        document.getElementById('tournament-edit-reserve-date').value = t.reserveDate || '';
        document.getElementById('tournament-edit-reserve-venue').value = t.reserveVenue || '';
      }
      if (btnDup) {
        btnDup.style.display = '';
        btnDup.onclick = () => {
          TournamentStore.add({
            name: (t.name || '') + '（コピー）',
            events: t.events,
            date: t.date,
            dayOfWeek: t.dayOfWeek,
            reserveDate: t.reserveDate,
            venue: t.venue,
            reserveVenue: t.reserveVenue,
            deadline: t.deadline,
          });
          modal.style.display = 'none';
          this.refreshTournamentsTable();
          this.showMessage('大会を複製しました', 'success');
        };
      }
    } else {
      if (title) title.textContent = '大会追加';
      document.getElementById('tournament-edit-name').value = '';
      document.getElementById('tournament-edit-events').value = '';
      document.getElementById('tournament-edit-date').value = '';
      document.getElementById('tournament-edit-dow').value = '';
      document.getElementById('tournament-edit-venue').value = '';
      document.getElementById('tournament-edit-reserve-date').value = '';
      document.getElementById('tournament-edit-reserve-venue').value = '';
      if (btnDup) btnDup.style.display = 'none';
    }
    modal.style.display = '';
  },

  /**
   * 日付をM/D形式に正規化
   * 入力例: "3月4日", "2025/3/4", "2025-03-04", "3/4", "令和7年3月4日" → "3/4"
   */
  _normalizeDate(str) {
    if (!str) return '';
    str = str.trim();
    // "M月D日" 形式
    let m = str.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) return m[1] + '/' + m[2];
    // "YYYY/M/D" or "YYYY-M-D" 形式
    m = str.match(/\d{4}[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return m[1] + '/' + m[2];
    // "M/D" 形式（すでに正規）
    m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return m[1] + '/' + m[2];
    return str;
  },

  /**
   * 曜日を(曜)形式に正規化
   * 入力例: "日", "（日）", "(日)", "日曜日", "Sunday" → "(日)"
   */
  _normalizeDayOfWeek(str) {
    if (!str) return '';
    str = str.trim();
    // すでに(X)形式
    let m = str.match(/[\(（]([日月火水木金土])[\)）]/);
    if (m) return '(' + m[1] + ')';
    // 曜日だけ
    m = str.match(/^([日月火水木金土])$/);
    if (m) return '(' + m[1] + ')';
    // X曜日
    m = str.match(/([日月火水木金土])曜/);
    if (m) return '(' + m[1] + ')';
    return str;
  },

  _saveTournament() {
    const name = document.getElementById('tournament-edit-name').value.trim();
    if (!name) { this.showMessage('大会名を入力してください', 'error'); return; }

    const data = {
      name,
      events: document.getElementById('tournament-edit-events').value.trim(),
      date: this._normalizeDate(document.getElementById('tournament-edit-date').value.trim()),
      dayOfWeek: this._normalizeDayOfWeek(document.getElementById('tournament-edit-dow').value.trim()),
      venue: document.getElementById('tournament-edit-venue').value.trim(),
      reserveDate: this._normalizeDate(document.getElementById('tournament-edit-reserve-date').value.trim()),
      reserveVenue: document.getElementById('tournament-edit-reserve-venue').value.trim(),
    };

    if (this._editingTournamentId) {
      TournamentStore.update(this._editingTournamentId, data);
      this.showMessage('大会情報を更新しました', 'success');
    } else {
      TournamentStore.add(data);
      this.showMessage('大会を追加しました', 'success');
    }

    this._editingTournamentId = null;
    const modal = document.getElementById('modal-tournament-edit');
    if (modal) modal.style.display = 'none';
    this.refreshTournamentsTable();
  },

  _importTournamentExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const count = TournamentStore.importFromExcel(wb);
        this.refreshTournamentsTable();
        this.showMessage(count + '件の大会を読み込みました', 'success');
      } catch (err) {
        this.showMessage('Excelの読み込みに失敗しました: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  // ================================================================
  // シード・抽選画面
  // ================================================================

  initDrawScreen() {
    const eventSelect = document.getElementById('draw-event-select');
    if (eventSelect) {
      eventSelect.addEventListener('change', () => this._onDrawEventChange());
    }

    // ドロー確定・リセット
    const btnConfirm = document.getElementById('btn-draw-confirm');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => this._confirmDraw());
    }
    const btnDrawReset = document.getElementById('btn-draw-reset');
    if (btnDrawReset) {
      btnDrawReset.addEventListener('click', () => this._resetDraw());
    }

    // 全自動配置（未配置選手をランダムに空き位置に配置）
    const btnAutoPlace = document.getElementById('btn-draw-auto-place');
    if (btnAutoPlace) {
      btnAutoPlace.addEventListener('click', () => this._autoPlaceAll());
    }
  },

  // 手動配置用の一時データ
  _manualDraw: null,        // ドロー配列
  _unplacedPlayers: [],     // 未配置選手リスト
  _selectedPlayer: null,    // 選択中の選手

  _refreshDrawEventSelect() {
    const select = document.getElementById('draw-event-select');
    if (!select) return;

    // 現在の選択値を保存
    const prevValue = select.value;

    select.innerHTML = '';
    let firstCode = '';
    for (const evt of AppConfig.EVENTS) {
      const isDoubles = evt.category === 'doubles';
      let count, label;
      if (isDoubles) {
        const pairs = EntryStore.getDoublesPairs(evt.code).filter(p => !p.incomplete);
        count = pairs.length;
        label = evt.name + ' (' + count + 'ペア)';
      } else {
        const entries = EntryStore.getByEvent(evt.code);
        count = entries.length;
        label = evt.name + ' (' + count + '名)';
      }
      // 確定済み種目はスキップ
      if (this.confirmedEvents && this.confirmedEvents[evt.code]) continue;
      if (count > 3) {
        const opt = document.createElement('option');
        opt.value = evt.code;
        opt.textContent = label;
        select.appendChild(opt);
        if (!firstCode) firstCode = evt.code;
      }
    }
    if (!firstCode) {
      select.innerHTML = '<option value="">エントリーがありません</option>';
      const lotterySection = document.getElementById('lottery-section');
      if (lotterySection) lotterySection.style.display = 'none';
      return;
    }

    // 抽選中の状態を維持: 前回の種目が選択肢に残っていて配置中なら復元
    if (prevValue && this._currentDrawData && this._currentDrawData.eventCode === prevValue && this._manualDraw) {
      // 選択肢に前回の種目があるか確認
      const stillExists = Array.from(select.options).some(o => o.value === prevValue);
      if (stillExists) {
        select.value = prevValue;
        // 既存のUIを再描画するだけ（リセットしない）
        const lotterySection = document.getElementById('lottery-section');
        if (lotterySection) lotterySection.style.display = '';
        const placementArea = document.getElementById('draw-placement-area');
        if (placementArea) placementArea.style.display = '';
        this._renderManualPlacement();
        return;
      }
    }

    // スケールスライダーのイベント（初回のみ）
    if (!this._drawSliderInit) {
      this._drawSliderInit = true;
      const scaleSlider = document.getElementById('bracket-scale-slider');
      if (scaleSlider) {
        scaleSlider.addEventListener('input', () => {
          const val = document.getElementById('bracket-scale-value');
          if (val) val.textContent = Math.round(parseFloat(scaleSlider.value) * 100) + '%';
          this._renderLiveBracket();
        });
      }
      const hScaleSlider = document.getElementById('bracket-hscale-slider');
      if (hScaleSlider) {
        hScaleSlider.addEventListener('input', () => {
          const val = document.getElementById('bracket-hscale-value');
          if (val) val.textContent = Math.round(parseFloat(hScaleSlider.value) * 100) + '%';
          this._renderLiveBracket();
        });
      }
    }

    // 最初の種目を自動選択して抽選画面を表示
    select.value = firstCode;
    this._onDrawEventChange();
  },

  _onDrawEventChange() {
    const select = document.getElementById('draw-event-select');
    const lotterySection = document.getElementById('lottery-section');

    if (!select || !select.value) {
      if (lotterySection) lotterySection.style.display = 'none';
      return;
    }

    const eventCode = select.value;
    const isDoubles = EntryStore.isDoublesEvent(eventCode);

    // ダブルスの場合はペア単位で処理
    let drawEntries;
    if (isDoubles) {
      const allPairs = EntryStore.getDoublesPairs(eventCode);
      const incompletePairs = allPairs.filter(p => p.incomplete);
      if (incompletePairs.length > 0) {
        if (lotterySection) lotterySection.style.display = 'none';
        this.showMessage('ペアが未確定の選手がいます（' + incompletePairs.length + '名）。エントリー画面でペアを確定してください。', 'error');
        return;
      }
      const pairs = allPairs.filter(p => !p.incomplete);
      if (pairs.length <= 1) {
        if (lotterySection) lotterySection.style.display = 'none';
        this.showMessage('完全なペアが2組以上必要です', 'error');
        return;
      }
      drawEntries = pairs.map(p => ({
        name: p.name,
        furigana: p.furigana,
        affiliation: p.affiliation,
        points: p.points,
        seed: 0,
      }));
    } else {
      drawEntries = EntryStore.getByEvent(eventCode);
    }

    if (drawEntries.length <= 3) {
      if (lotterySection) lotterySection.style.display = 'none';
      this.showMessage(isDoubles ? '完全なペアが4組以上必要です' : 'エントリーが4名以上必要です', 'error');
      return;
    }

    if (lotterySection) lotterySection.style.display = '';

    // シード自動計算
    const drawSize = DrawEngine.getDrawSize(drawEntries.length);
    const sorted = [...drawEntries].sort((a, b) => (b.points || 0) - (a.points || 0));
    const withSeeds = DrawEngine.assignSeeds(sorted, drawSize);
    const seeds = withSeeds.filter(p => p.seed > 0);

    // シード情報バーを更新
    const seedInfoBar = document.getElementById('draw-seed-info');
    if (seedInfoBar) {
      const entryLabel = isDoubles ? 'ペア数' : 'エントリー';
      const entryUnit = isDoubles ? '' : '名';
      let html = '<div class="draw-info-grid">' +
        '<div class="draw-info-item"><span class="draw-info-label">' + entryLabel + '</span><span class="draw-info-value">' + drawEntries.length + entryUnit + '</span></div>' +
        '<div class="draw-info-item"><span class="draw-info-label">ドローサイズ</span><span class="draw-info-value">' + drawSize + '</span></div>' +
        '<div class="draw-info-item"><span class="draw-info-label">BYE</span><span class="draw-info-value">' + (drawSize - drawEntries.length) + '</span></div>' +
        '<div class="draw-info-item"><span class="draw-info-label">シード</span><span class="draw-info-value">' + seeds.length + '</span></div>' +
        '</div>';
      if (seeds.length > 0) {
        html += '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">';
        seeds.forEach(s => {
          html += '<span class="seed-chip">[' + s.seed + '] ' + this._esc(s.name) + ' <small>(' + (s.points || 0) + 'pt)</small></span>';
        });
        html += '</div>';
      }
      seedInfoBar.innerHTML = html;
    }

    this._currentDrawData = { eventCode, entries: withSeeds, drawSize, seeds };

    // シード位置選択UIを構築
    this._buildSeedPositionUI(withSeeds, drawSize, seeds);
  },

  /**
   * シード位置選択UIを構築
   */
  _buildSeedPositionUI(players, drawSize, seeds) {
    const container = document.getElementById('seed-position-selection');
    const sel34 = document.getElementById('seed34-selection');
    const sel58 = document.getElementById('seed58-selection');
    const ctrl34 = document.getElementById('seed34-controls');
    const ctrl58 = document.getElementById('seed58-controls');
    const btnApply = document.getElementById('btn-apply-seed-positions');
    const placementArea = document.getElementById('draw-placement-area');

    // 配置エリアを一旦非表示
    if (placementArea) placementArea.style.display = 'none';

    const seeded = players.filter(p => p.seed > 0).sort((a, b) => a.seed - b.seed);

    // シード3,4もシード5-8もない場合はそのまま配置
    if (seeded.length <= 2) {
      if (container) container.style.display = 'none';
      this._initManualPlacement(players, drawSize, seeds, {});
      return;
    }

    if (container) container.style.display = '';

    // シード3,4の位置選択
    if (seeded.length >= 3 && sel34 && ctrl34) {
      sel34.style.display = '';
      ctrl34.innerHTML = '';
      const pos34 = DrawEngine.getSeed34Positions(drawSize);

      // シード3（ランク3位の選手）
      const seed3player = seeded.find(s => s.seed === 3);
      const seed4player = seeded.find(s => s.seed === 4);

      if (seed3player) {
        const label3 = document.createElement('span');
        label3.style.cssText = 'font-size:13px;min-width:120px;';
        label3.textContent = '[3] ' + seed3player.name + ' →';
        ctrl34.appendChild(label3);
        const select3 = document.createElement('select');
        select3.id = 'seed3-position';
        select3.className = 'form-select';
        select3.style.cssText = 'width:auto;min-width:100px;';
        pos34.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = 'No.' + p;
          select3.appendChild(opt);
        });
        ctrl34.appendChild(select3);
      }

      if (seed4player) {
        const label4 = document.createElement('span');
        label4.style.cssText = 'font-size:13px;min-width:120px;margin-left:16px;';
        label4.textContent = '[4] ' + seed4player.name + ' →';
        ctrl34.appendChild(label4);
        const select4 = document.createElement('select');
        select4.id = 'seed4-position';
        select4.className = 'form-select';
        select4.style.cssText = 'width:auto;min-width:100px;';
        pos34.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = 'No.' + p;
          select4.appendChild(opt);
        });
        // デフォルトでシード4は2番目の位置
        select4.value = pos34[1];
        ctrl34.appendChild(select4);

        // 連動: 片方を選ぶともう片方は自動で残りに
        const syncSelects = () => {
          const s3 = document.getElementById('seed3-position');
          const s4 = document.getElementById('seed4-position');
          if (s3 && s4) {
            const other = pos34.find(p => String(p) !== s3.value);
            if (other !== undefined) s4.value = String(other);
          }
        };
        const s3el = document.getElementById('seed3-position');
        if (s3el) s3el.addEventListener('change', syncSelects);
        select4.addEventListener('change', () => {
          const s3 = document.getElementById('seed3-position');
          if (s3) {
            const other = pos34.find(p => String(p) !== select4.value);
            if (other !== undefined) s3.value = String(other);
          }
        });
      }
    } else if (sel34) {
      sel34.style.display = 'none';
    }

    // シード5-8の位置選択
    if (seeded.length >= 5 && sel58 && ctrl58) {
      sel58.style.display = '';
      ctrl58.innerHTML = '';
      const pos58 = DrawEngine.getSeed58Positions(drawSize);
      const seeds58 = seeded.filter(s => s.seed >= 5 && s.seed <= 8);

      seeds58.forEach((sp, idx) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
        const label = document.createElement('span');
        label.style.cssText = 'font-size:13px;min-width:120px;';
        label.textContent = '[' + sp.seed + '] ' + sp.name + ' →';
        wrap.appendChild(label);
        const sel = document.createElement('select');
        sel.id = 'seed' + sp.seed + '-position';
        sel.className = 'form-select';
        sel.style.cssText = 'width:auto;min-width:100px;';
        pos58.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = 'No.' + p;
          sel.appendChild(opt);
        });
        // デフォルト: 順番に異なる位置を割り当て
        if (idx < pos58.length) sel.value = pos58[idx];
        wrap.appendChild(sel);
        ctrl58.appendChild(wrap);
      });

      // 連動: 選択済みの位置を他のセレクトから使えないようにし、重複を自動解消
      const syncSeed58 = (changedSeed) => {
        const selects = seeds58.map(sp => document.getElementById('seed' + sp.seed + '-position')).filter(Boolean);
        const usedValues = new Map();
        // 変更されたセレクトを優先
        selects.forEach((sel, i) => {
          if (seeds58[i].seed === changedSeed) {
            usedValues.set(sel.value, i);
          }
        });
        // 重複があれば別の位置に振り替え
        selects.forEach((sel, i) => {
          if (seeds58[i].seed !== changedSeed && usedValues.has(sel.value)) {
            const available = pos58.map(String).find(p => !usedValues.has(p));
            if (available) sel.value = available;
          }
          usedValues.set(sel.value, i);
        });
        // disabled更新
        const allUsed = selects.map(s => s.value);
        selects.forEach((sel) => {
          const currentVal = sel.value;
          Array.from(sel.options).forEach(opt => {
            opt.disabled = allUsed.includes(opt.value) && opt.value !== currentVal;
          });
        });
      };
      seeds58.forEach(sp => {
        const sel = document.getElementById('seed' + sp.seed + '-position');
        if (sel) sel.addEventListener('change', () => syncSeed58(sp.seed));
      });
      syncSeed58(null);
    } else if (sel58) {
      sel58.style.display = 'none';
    }

    // ルーレットボタン
    const btnRoulette = document.getElementById('btn-roulette-seed-positions');
    if (btnRoulette) {
      const newRouletteBtn = btnRoulette.cloneNode(true);
      btnRoulette.parentNode.replaceChild(newRouletteBtn, btnRoulette);
      newRouletteBtn.addEventListener('click', () => this._rouletteSeedPositions());
    }

    // 確定ボタン
    if (btnApply) {
      // 既存のリスナーを削除するためクローン
      const newBtn = btnApply.cloneNode(true);
      btnApply.parentNode.replaceChild(newBtn, btnApply);
      newBtn.addEventListener('click', () => {
        const seedPositionMap = {};

        // シード3,4の位置を取得
        const s3el = document.getElementById('seed3-position');
        const s4el = document.getElementById('seed4-position');
        if (s3el) seedPositionMap[3] = parseInt(s3el.value);
        if (s4el) seedPositionMap[4] = parseInt(s4el.value);

        // シード5-8の位置を取得
        const seeds58 = seeded.filter(s => s.seed >= 5 && s.seed <= 8);
        const usedPos58 = new Set();
        let hasDuplicate = false;
        seeds58.forEach(sp => {
          const el = document.getElementById('seed' + sp.seed + '-position');
          if (el) {
            const pos = parseInt(el.value);
            if (usedPos58.has(pos)) hasDuplicate = true;
            usedPos58.add(pos);
            seedPositionMap[sp.seed] = pos;
          }
        });

        // シード3と4が同じ位置の場合
        if (s3el && s4el && s3el.value === s4el.value) {
          this.showMessage('シード3と4を同じ位置にすることはできません', 'error');
          return;
        }
        if (hasDuplicate) {
          this.showMessage('シード5〜8に同じ位置が選択されています', 'error');
          return;
        }

        // 配置実行
        this._initManualPlacement(players, drawSize, seeds, seedPositionMap);
      });
    }
  },

  /**
   * 手動配置の初期化
   * シード選手とBYEは自動配置、非シード選手は未配置リストへ
   * @param {object} seedPositionMap シード番号→位置(1-indexed)のマップ
   */
  _initManualPlacement(players, drawSize, seeds, seedPositionMap) {
    seedPositionMap = seedPositionMap || {};

    // ドロー配列を初期化（全ポジション空）
    const draw = [];
    for (let i = 0; i < drawSize; i++) {
      draw.push({ position: i + 1, name: '', furigana: '', affiliation: '', points: 0, seed: 0, isBye: false, isEmpty: true });
    }

    // シード配置
    const seeded = players.filter(p => p.seed > 0).sort((a, b) => a.seed - b.seed);
    // シード1 → 最上段
    if (seeded.length >= 1) {
      this._placeInDraw(draw, 0, seeded[0]);
    }
    // シード2 → 最下段
    if (seeded.length >= 2) {
      this._placeInDraw(draw, drawSize - 1, seeded[1]);
    }
    // シード3,4 → ユーザー選択またはランダム
    if (seeded.length >= 3) {
      const seed3 = seeded.find(s => s.seed === 3);
      const seed4 = seeded.find(s => s.seed === 4);
      if (seed3 && seedPositionMap[3]) {
        this._placeInDraw(draw, seedPositionMap[3] - 1, seed3);
      } else if (seed3) {
        const pos34 = DrawEngine.getSeed34Positions(drawSize);
        this._placeInDraw(draw, pos34[0] - 1, seed3);
      }
      if (seed4 && seedPositionMap[4]) {
        this._placeInDraw(draw, seedPositionMap[4] - 1, seed4);
      } else if (seed4) {
        const pos34 = DrawEngine.getSeed34Positions(drawSize);
        this._placeInDraw(draw, pos34[1] - 1, seed4);
      }
    }
    // シード5-8 → ユーザー選択またはランダム
    if (seeded.length >= 5) {
      const pos58 = DrawEngine.getSeed58Positions(drawSize);
      const seeds58 = seeded.filter(s => s.seed >= 5 && s.seed <= 8);
      seeds58.forEach((sp, idx) => {
        if (seedPositionMap[sp.seed]) {
          this._placeInDraw(draw, seedPositionMap[sp.seed] - 1, sp);
        } else if (idx < pos58.length) {
          this._placeInDraw(draw, pos58[idx] - 1, sp);
        }
      });
    }
    // シード9-16 → 自動配置
    if (seeded.length >= 9) {
      const pos916 = DrawEngine.getSeed916Positions(drawSize);
      const shuffled916 = DrawEngine.shuffleArray([...pos916]);
      const seeds916 = seeded.filter(s => s.seed >= 9 && s.seed <= 16);
      seeds916.forEach((sp, idx) => {
        if (idx < shuffled916.length) {
          this._placeInDraw(draw, shuffled916[idx] - 1, sp);
        }
      });
    }

    // BYE配置
    const byeCount = drawSize - players.length;
    const byePositions = DrawEngine._determineBYEPositions(draw, drawSize, byeCount);
    for (const pos of byePositions) {
      draw[pos] = { position: pos + 1, name: '', furigana: '', affiliation: '', points: 0, seed: 0, isBye: true, isEmpty: false };
    }

    // 非シード選手を未配置リストへ
    this._unplacedPlayers = players.filter(p => !p.seed || p.seed <= 0).map(p => ({ ...p }));
    this._manualDraw = draw;
    this._selectedPlayer = null;
    this._unplacedByes = 0;

    // UIを表示
    const placementArea = document.getElementById('draw-placement-area');
    if (placementArea) placementArea.style.display = '';

    this._renderManualPlacement();
  },

  _placeInDraw(draw, index, player) {
    draw[index] = {
      position: index + 1,
      name: player.name,
      furigana: player.furigana || '',
      affiliation: player.affiliation || '',
      points: player.points || 0,
      seed: player.seed || 0,
      isBye: false,
      isEmpty: false,
    };
  },

  /**
   * 手動配置UIの描画
   */
  _renderManualPlacement() {
    if (!this._manualDraw) return;
    const draw = this._manualDraw;
    const halfSize = draw.length / 2;

    // 未配置選手リスト
    const unplacedList = document.getElementById('unplaced-list');
    if (unplacedList) {
      unplacedList.innerHTML = '';
      if (this._unplacedByes > 0) {
        const byeChip = document.createElement('span');
        byeChip.className = 'unplaced-chip';
        byeChip.style.background = '#FFF3E0';
        byeChip.style.color = '#E65100';
        byeChip.style.border = '1px solid #FFB74D';
        byeChip.textContent = 'BYE x ' + this._unplacedByes + ' (空き位置に配置してください)';
        unplacedList.appendChild(byeChip);
      }
      if (this._unplacedPlayers.length === 0 && !this._unplacedByes) {
        unplacedList.innerHTML = '<span style="color:#2E7D32;font-size:13px;">全選手が配置済みです</span>';
      } else if (this._unplacedPlayers.length > 0) {
        this._unplacedPlayers.forEach((p, idx) => {
          const chip = document.createElement('button');
          chip.className = 'unplaced-chip' + (this._selectedPlayer === idx ? ' selected' : '');
          chip.textContent = p.name + (p.points ? ' (' + p.points + 'pt)' : '');
          chip.addEventListener('click', () => {
            this._selectedPlayer = (this._selectedPlayer === idx) ? null : idx;
            this._renderManualPlacement();
          });
          unplacedList.appendChild(chip);
        });
      }
    }

    // 上の山
    this._renderHalfTable('draw-top-half-body', draw, 0, halfSize);
    // 下の山
    this._renderHalfTable('draw-bottom-half-body', draw, halfSize, draw.length);

    // ライブトーナメント表プレビュー描画
    this._renderLiveBracket();
  },

  _renderHalfTable(tbodyId, draw, start, end) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';

    for (let i = start; i < end; i++) {
      const entry = draw[i];
      const tr = document.createElement('tr');

      if (entry.isBye) {
        tr.innerHTML =
          '<td class="text-center">' + entry.position + '</td>' +
          '<td colspan="2" style="color:#999;font-style:italic;">BYE</td>' +
          '<td></td>';
        // BYEは移動可能（取り消してから別の位置に配置可能）
        const byeActionCell = tr.querySelector('td:last-child');
        const btnRemoveBye = document.createElement('button');
        btnRemoveBye.className = 'btn btn-sm btn-warning';
        btnRemoveBye.textContent = '移動';
        btnRemoveBye.addEventListener('click', () => this._removeBye(i));
        byeActionCell.appendChild(btnRemoveBye);
      } else if (!entry.isEmpty) {
        // 配置済み
        const seedMark = entry.seed > 0 ? '<span class="seed-mark">[' + entry.seed + ']</span> ' : '';
        tr.innerHTML =
          '<td class="text-center">' + entry.position + '</td>' +
          '<td>' + seedMark + this._esc(entry.name) + '</td>' +
          '<td style="font-size:12px;color:#666;">' + this._esc(entry.affiliation || '') + '</td>' +
          '<td></td>';
        if (entry.seed === 0) {
          // 非シードの配置済み選手は取り消し可能
          const actionCell = tr.querySelector('td:last-child');
          const btnRemove = document.createElement('button');
          btnRemove.className = 'btn btn-sm btn-danger';
          btnRemove.textContent = '取消';
          btnRemove.addEventListener('click', () => this._removeFromDraw(i));
          actionCell.appendChild(btnRemove);
        }
      } else {
        // 空きスロット
        tr.className = 'empty-slot' + (this._selectedPlayer !== null ? ' placeable' : '');
        tr.innerHTML =
          '<td class="text-center">' + entry.position + '</td>' +
          '<td colspan="2" style="color:#ccc;">---</td>' +
          '<td></td>';
        const actionCell = tr.querySelector('td:last-child');
        if (this._selectedPlayer !== null) {
          const btnPlace = document.createElement('button');
          btnPlace.className = 'btn btn-sm btn-primary';
          btnPlace.textContent = '配置';
          btnPlace.addEventListener('click', () => this._placePlayerAt(i));
          actionCell.appendChild(btnPlace);
        }
        if (this._unplacedByes > 0) {
          const btnBye = document.createElement('button');
          btnBye.className = 'btn btn-sm btn-warning';
          btnBye.textContent = 'BYE';
          btnBye.style.marginLeft = '4px';
          btnBye.addEventListener('click', () => this._placeBye(i));
          actionCell.appendChild(btnBye);
        }
      }

      tbody.appendChild(tr);
    }
  },

  /**
   * ライブトーナメント表プレビューを描画
   */
  _renderLiveBracket() {
    const wrapper = document.getElementById('live-bracket-svg-wrapper');
    if (!wrapper || !this._manualDraw || !this._currentDrawData) return;

    const evt = AppConfig.EVENTS.find(e => e.code === this._currentDrawData.eventCode);
    const isDoubles = evt ? evt.category === 'doubles' : false;
    const drawData = {
      draw: this._manualDraw,
      drawSize: this._currentDrawData.drawSize,
      eventName: evt ? evt.name : this._currentDrawData.eventCode,
      tournamentName: AppConfig.TOURNAMENT_NAME || '',
      date: AppConfig.TOURNAMENT_DATE || '',
      venue: AppConfig.TOURNAMENT_VENUE || '',
      matchFormat: AppConfig.MATCH_FORMAT || '',
      entryCount: this._currentDrawData.entries.filter(e => !e.isBye).length,
      seeds: this._currentDrawData.seeds || [],
      isDoubles: isDoubles,
    };

    const scaleSlider = document.getElementById('bracket-scale-slider');
    const hScaleSlider = document.getElementById('bracket-hscale-slider');
    const scale = scaleSlider ? parseFloat(scaleSlider.value) || 1.0 : 1.0;
    const hScale = hScaleSlider ? parseFloat(hScaleSlider.value) || 1.0 : 1.0;
    DrawRenderer.render(wrapper, drawData, { scale: scale, hScale: hScale });

    const svg = wrapper.querySelector('svg');
    if (!svg) return;

    const draw = this._manualDraw;
    const P = DrawRenderer.PARAMS;
    const halfSize = draw.length / 2;
    const rounds = Math.log2(draw.length);
    const halfRounds = rounds - 1;
    const bodyTop = P.headerHeight;
    const halfWidth = P.drawNumWidth + P.nameAreaWidth + halfRounds * P.roundWidth;

    const getSlotRect = (i) => {
      const isLeft = i < halfSize;
      const localIdx = isLeft ? i : i - halfSize;
      const cy = bodyTop + (localIdx * 2) * P.slotHeight + P.slotHeight / 2;
      const offsetX = isLeft ? 0 : halfWidth + P.centerGap;
      if (isLeft) {
        return { x: offsetX + P.drawNumWidth, y: cy - P.slotHeight / 2, w: P.nameAreaWidth, h: P.slotHeight };
      } else {
        return { x: offsetX + halfRounds * P.roundWidth, y: cy - P.slotHeight / 2, w: P.drawNumWidth + P.nameAreaWidth, h: P.slotHeight };
      }
    };

    for (let i = 0; i < draw.length; i++) {
      const entry = draw[i];
      const r = getSlotRect(i);

      if (entry.isEmpty) {
        // 空きスロット: 選手配置 or BYE配置クリック領域
        if (this._selectedPlayer !== null || this._unplacedByes > 0) {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', r.x); rect.setAttribute('y', r.y);
          rect.setAttribute('width', r.w); rect.setAttribute('height', r.h);
          rect.setAttribute('fill', this._selectedPlayer !== null ? 'rgba(25, 118, 210, 0.08)' : 'rgba(255, 152, 0, 0.08)');
          rect.setAttribute('stroke', this._selectedPlayer !== null ? '#1976D2' : '#FF9800');
          rect.setAttribute('stroke-width', '1'); rect.setAttribute('stroke-dasharray', '4,2'); rect.setAttribute('rx', '3');
          rect.style.cursor = 'pointer';
          // ツールチップ
          const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          titleEl.textContent = this._selectedPlayer !== null ? 'クリックして選手を配置' : 'クリックしてBYEを配置';
          rect.appendChild(titleEl);
          rect.addEventListener('click', ((idx) => () => {
            if (this._selectedPlayer !== null) {
              this._placePlayerAt(idx);
            } else if (this._unplacedByes > 0) {
              this._placeBye(idx);
            }
          })(i));
          rect.addEventListener('mouseenter', () => { rect.setAttribute('fill', this._selectedPlayer !== null ? 'rgba(25, 118, 210, 0.2)' : 'rgba(255, 152, 0, 0.2)'); });
          rect.addEventListener('mouseleave', () => { rect.setAttribute('fill', this._selectedPlayer !== null ? 'rgba(25, 118, 210, 0.08)' : 'rgba(255, 152, 0, 0.08)'); });
          svg.appendChild(rect);
        }
      } else if (entry.isBye) {
        // BYE: クリックで移動可能
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', r.x); rect.setAttribute('y', r.y);
        rect.setAttribute('width', r.w); rect.setAttribute('height', r.h);
        rect.setAttribute('fill', 'transparent'); rect.setAttribute('rx', '3');
        rect.style.cursor = 'pointer';
        const titleBye = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        titleBye.textContent = 'クリックしてBYEを取り消し';
        rect.appendChild(titleBye);
        rect.addEventListener('click', ((idx) => () => { this._removeBye(idx); })(i));
        rect.addEventListener('mouseenter', () => { rect.setAttribute('fill', 'rgba(255, 152, 0, 0.15)'); });
        rect.addEventListener('mouseleave', () => { rect.setAttribute('fill', 'transparent'); });
        svg.appendChild(rect);
      } else if (entry.seed === 0 && !entry.isEmpty) {
        // 非シード配置済み: クリックで取消
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', r.x); rect.setAttribute('y', r.y);
        rect.setAttribute('width', r.w); rect.setAttribute('height', r.h);
        rect.setAttribute('fill', 'transparent'); rect.setAttribute('rx', '3');
        rect.style.cursor = 'pointer';
        const titleRm = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        titleRm.textContent = 'クリックして配置を取り消し';
        rect.appendChild(titleRm);
        rect.addEventListener('click', ((idx) => () => { this._removeFromDraw(idx); })(i));
        rect.addEventListener('mouseenter', () => { rect.setAttribute('fill', 'rgba(220, 38, 38, 0.1)'); });
        rect.addEventListener('mouseleave', () => { rect.setAttribute('fill', 'transparent'); });
        svg.appendChild(rect);
      }
    }
  },

  _placePlayerAt(drawIndex) {
    if (this._selectedPlayer === null || !this._manualDraw) return;
    const player = this._unplacedPlayers[this._selectedPlayer];
    if (!player) return;

    this._placeInDraw(this._manualDraw, drawIndex, player);
    this._unplacedPlayers.splice(this._selectedPlayer, 1);
    this._selectedPlayer = null;
    this._renderManualPlacement();
  },

  _removeFromDraw(drawIndex) {
    if (!this._manualDraw) return;
    const entry = this._manualDraw[drawIndex];
    if (!entry || entry.isBye || entry.seed > 0 || entry.isEmpty) return;

    // 未配置リストに戻す
    this._unplacedPlayers.push({
      name: entry.name,
      furigana: entry.furigana,
      affiliation: entry.affiliation,
      points: entry.points,
      seed: 0,
    });

    this._manualDraw[drawIndex] = {
      position: drawIndex + 1, name: '', furigana: '', affiliation: '', points: 0, seed: 0, isBye: false, isEmpty: true,
    };
    this._selectedPlayer = null;
    this._renderManualPlacement();
  },

  _removeBye(drawIndex) {
    if (!this._manualDraw) return;
    const entry = this._manualDraw[drawIndex];
    if (!entry || !entry.isBye) return;

    // BYEを未配置BYEリストに移す
    if (!this._unplacedByes) this._unplacedByes = 0;
    this._unplacedByes++;

    this._manualDraw[drawIndex] = {
      position: drawIndex + 1, name: '', furigana: '', affiliation: '', points: 0, seed: 0, isBye: false, isEmpty: true,
    };
    this._selectedPlayer = null;
    this._renderManualPlacement();
  },

  _placeBye(drawIndex) {
    if (!this._manualDraw || !this._unplacedByes) return;
    const entry = this._manualDraw[drawIndex];
    if (!entry || !entry.isEmpty) return;

    this._manualDraw[drawIndex] = {
      position: drawIndex + 1, name: '', furigana: '', affiliation: '', points: 0, seed: 0, isBye: true, isEmpty: false,
    };
    this._unplacedByes--;
    this._renderManualPlacement();
  },

  _confirmDraw() {
    if (!this._manualDraw || !this._currentDrawData) return;

    if (this._unplacedPlayers.length > 0) {
      this.showMessage('未配置の選手が ' + this._unplacedPlayers.length + '名 います。全員を配置してください。', 'error');
      return;
    }
    if (this._unplacedByes > 0) {
      this.showMessage('未配置のBYEが ' + this._unplacedByes + '個 あります。配置してください。', 'error');
      return;
    }

    const eventCode = this._currentDrawData.eventCode;
    const evt = AppConfig.EVENTS.find(e => e.code === eventCode);
    const draw = this._manualDraw.map(e => ({ ...e, isEmpty: undefined }));

    const entryCount = this._currentDrawData.entries.filter(e => !e.isBye && e.seed >= 0).length;
    this.drawResults[eventCode] = {
      draw: draw,
      drawSize: this._currentDrawData.drawSize,
      entries: this._currentDrawData.entries,
      seeds: this._currentDrawData.seeds,
      eventName: evt ? evt.name : eventCode,
      eventCode: eventCode,
      entryCount: entryCount,
      confirmed: true,
    };

    // 確定済み種目を記録
    if (!this.confirmedEvents) this.confirmedEvents = {};
    this.confirmedEvents[eventCode] = true;

    this._saveDrawResults();
    this.showMessage(evt.name + ' のドローを確定しました', 'success');
  },

  _saveDrawResults() {
    try {
      localStorage.setItem('drawSystem_drawResults', JSON.stringify({
        drawResults: this.drawResults,
        confirmedEvents: this.confirmedEvents,
        savedAt: new Date().toISOString(),
      }));
    } catch (e) {
      console.warn('drawResults保存に失敗:', e);
    }
  },

  _restoreDrawResults() {
    try {
      const saved = localStorage.getItem('drawSystem_drawResults');
      if (!saved) return;
      const data = JSON.parse(saved);
      if (data.drawResults) this.drawResults = data.drawResults;
      if (data.confirmedEvents) this.confirmedEvents = data.confirmedEvents;
    } catch (e) {
      console.warn('drawResults復元に失敗:', e);
    }
  },

  _resetDraw() {
    if (!this._currentDrawData) return;
    const { entries, drawSize, seeds } = this._currentDrawData;
    this._initManualPlacement(entries, drawSize, seeds);
    this.showMessage('配置をリセットしました', 'info');
  },

  /**
   * 全自動配置: 未配置選手をランダムに空き位置に配置
   * 所属重複回避オプションを考慮
   */
  _autoPlaceAll() {
    if (!this._manualDraw || this._unplacedPlayers.length === 0) return;

    const avoidCollision = document.querySelector('input[name="affiliation-collision"]:checked');
    const shouldAvoid = !avoidCollision || avoidCollision.value === 'avoid';

    // 空きスロットを取得
    const emptySlots = [];
    for (let i = 0; i < this._manualDraw.length; i++) {
      if (this._manualDraw[i].isEmpty) emptySlots.push(i);
    }

    // 未配置選手をシャッフル
    const shuffled = [...this._unplacedPlayers];
    DrawEngine.shuffleArray(shuffled);

    if (shouldAvoid) {
      // 所属重複を避けて配置
      this._placeWithAffiliationAvoidance(shuffled, emptySlots);
    } else {
      // そのまま順に配置
      for (let i = 0; i < shuffled.length && i < emptySlots.length; i++) {
        this._placeInDraw(this._manualDraw, emptySlots[i], shuffled[i]);
      }
    }

    this._unplacedPlayers = [];
    this._selectedPlayer = null;
    this._renderManualPlacement();
    this.showMessage('全選手を自動配置しました', 'success');
  },

  /**
   * 所属重複を避けた配置アルゴリズム
   * 1回戦で同所属同士が当たらないように配置を試みる
   */
  _placeWithAffiliationAvoidance(players, slots) {
    // 1回戦ペア: (0,1),(2,3),(4,5),... のインデックス
    // 各ペアの対戦相手と所属が被らないように配置

    // まず通常通り配置して、衝突があったら交換する
    const placed = [...players];
    const slotsCopy = [...slots];

    // 初期配置
    for (let i = 0; i < placed.length && i < slotsCopy.length; i++) {
      this._placeInDraw(this._manualDraw, slotsCopy[i], placed[i]);
    }

    // 衝突検出 & スワップ（最大100回試行）
    for (let attempt = 0; attempt < 100; attempt++) {
      let hasCollision = false;
      for (let i = 0; i < this._manualDraw.length; i += 2) {
        const a = this._manualDraw[i];
        const b = this._manualDraw[i + 1];
        if (!a || !b || a.isBye || b.isBye || a.isEmpty || b.isEmpty) continue;
        if (a.seed > 0 || b.seed > 0) continue;
        if (a.affiliation && b.affiliation && a.affiliation === b.affiliation) {
          hasCollision = true;
          // ランダムな別の位置とスワップ
          const swapCandidates = slotsCopy.filter(s => {
            const entry = this._manualDraw[s];
            return entry && !entry.isBye && !entry.isEmpty && entry.seed === 0 && s !== i && s !== i + 1;
          });
          if (swapCandidates.length > 0) {
            const swapIdx = swapCandidates[Math.floor(Math.random() * swapCandidates.length)];
            // aとswapIdxの選手を交換
            const temp = { ...this._manualDraw[i] };
            this._manualDraw[i] = { ...this._manualDraw[swapIdx], position: i + 1 };
            this._manualDraw[swapIdx] = { ...temp, position: swapIdx + 1 };
          }
        }
      }
      if (!hasCollision) break;
    }
  },

  /**
   * ルーレット抽選: 数字が素早くランダムに動き、Enterで確定
   */
  _rouletteSeedPositions() {
    if (!this._currentDrawData) return;

    const seeded = this._currentDrawData.seeds || [];
    if (seeded.length <= 2) return;

    const drawSize = this._currentDrawData.drawSize;
    const pos34 = DrawEngine.getSeed34Positions(drawSize);
    const pos58 = DrawEngine.getSeed58Positions(drawSize);

    // ルーレット用の表示要素を作成
    const container = document.getElementById('seed-position-selection');
    if (!container) return;

    // ルーレット表示エリア
    let rouletteDiv = document.getElementById('roulette-display');
    if (!rouletteDiv) {
      rouletteDiv = document.createElement('div');
      rouletteDiv.id = 'roulette-display';
      rouletteDiv.style.cssText = 'padding:16px;text-align:center;background:#fff;border-radius:8px;margin-top:12px;border:2px solid #1976D2;';
      container.appendChild(rouletteDiv);
    }

    // シード3,4のルーレット
    const allPositions = [];
    if (seeded.length >= 3) {
      allPositions.push({ label: 'シード3・4', positions: pos34, seeds: [3, 4] });
    }
    if (seeded.length >= 5 && pos58.length > 0) {
      allPositions.push({ label: 'シード5〜8', positions: pos58, seeds: seeded.filter(s => s.seed >= 5 && s.seed <= 8).map(s => s.seed) });
    }

    if (allPositions.length === 0) return;

    let currentGroup = 0;
    let rouletteTimer = null;
    let currentIdx = 0;

    const showGroup = (groupIdx) => {
      const group = allPositions[groupIdx];
      const shuffledPositions = DrawEngine.shuffleArray([...group.positions]);

      rouletteDiv.innerHTML = '<h4 style="margin-bottom:12px;color:#1976D2;">' + group.label + ' の位置抽選</h4>' +
        '<div id="roulette-number" style="font-size:48px;font-weight:bold;color:#333;font-family:monospace;min-height:60px;"></div>' +
        '<p style="font-size:14px;color:#666;margin-top:8px;">Enterキーまたはクリックで確定</p>';

      const numDisplay = document.getElementById('roulette-number');
      currentIdx = 0;

      // ルーレット開始
      rouletteTimer = setInterval(() => {
        currentIdx = (currentIdx + 1) % group.positions.length;
        if (numDisplay) numDisplay.textContent = 'No.' + group.positions[currentIdx];
      }, 80);

      // 確定ハンドラ
      const stopRoulette = () => {
        if (rouletteTimer) {
          clearInterval(rouletteTimer);
          rouletteTimer = null;
        }
        document.removeEventListener('keydown', onKeyDown);
        rouletteDiv.removeEventListener('click', stopRoulette);

        // 結果をランダムに割り当て
        const result = DrawEngine.shuffleArray([...group.positions]);

        // セレクトに反映
        group.seeds.forEach((seedNum, i) => {
          const sel = document.getElementById('seed' + seedNum + '-position');
          if (sel && i < result.length) sel.value = result[i];
        });

        if (numDisplay) {
          numDisplay.textContent = result.map((p, i) => '[' + group.seeds[i] + '] → No.' + p).join('  ');
          numDisplay.style.color = '#2E7D32';
        }

        // 次のグループへ
        currentGroup++;
        if (currentGroup < allPositions.length) {
          setTimeout(() => showGroup(currentGroup), 1500);
        } else {
          setTimeout(() => {
            rouletteDiv.innerHTML = '<p style="color:#2E7D32;font-weight:bold;">抽選完了！「シード位置を確定して配置」を押してください。</p>';
          }, 1500);
        }
      };

      const onKeyDown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          stopRoulette();
        }
      };
      document.addEventListener('keydown', onKeyDown);
      rouletteDiv.addEventListener('click', stopRoulette);
      rouletteDiv.style.cursor = 'pointer';
    };

    showGroup(0);
  },

  // ================================================================
  // ドロー表画面
  // ================================================================

  initBracketScreen() {
    const select = document.getElementById('bracket-event-select');
    if (select) {
      select.addEventListener('change', () => this._onBracketEventChange());
    }

    // ウィンドウリサイズ時にドロー表を再描画（自動フィット）
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (this.currentScreen !== 'screen-bracket') return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this._onBracketEventChange(), 200);
    });

    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => window.print());
    }

    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => this._exportDrawExcel());
    }
    const btnExportCSV = document.getElementById('btn-export-csv');
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', () => this._exportDrawCSV());
    }

    const btnClear = document.getElementById('btn-bracket-clear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        const eventCode = select ? select.value : '';
        if (!eventCode || !this.drawResults[eventCode]) return;
        if (!confirm('この種目のドロー結果をクリアしますか？')) return;
        delete this.drawResults[eventCode];
        if (this.confirmedEvents) delete this.confirmedEvents[eventCode];
        this._saveDrawResults();
        this._refreshBracketEventSelect();
        // SVGクリア・メッセージ表示
        const svg = document.getElementById('bracket-svg');
        if (svg) svg.innerHTML = '';
        const emptyMsg = document.getElementById('bracket-empty-msg');
        if (emptyMsg) emptyMsg.style.display = '';
        const entryList = document.getElementById('bracket-entry-list');
        if (entryList) entryList.style.display = 'none';
        btnClear.style.display = 'none';
        const btnRedoEl = document.getElementById('btn-bracket-redo');
        if (btnRedoEl) btnRedoEl.style.display = 'none';
        this.showMessage('ドロー結果をクリアしました。', 'info');
      });
    }

    const btnRedo = document.getElementById('btn-bracket-redo');
    if (btnRedo) {
      btnRedo.addEventListener('click', () => {
        const eventCode = select ? select.value : '';
        if (!eventCode || !this.drawResults[eventCode]) return;
        if (!confirm('このドローを取り消して抽選画面でやり直しますか？')) return;
        // 確定を解除
        delete this.drawResults[eventCode];
        if (this.confirmedEvents) delete this.confirmedEvents[eventCode];
        this._saveDrawResults();
        this.showMessage('ドローを取り消しました。抽選画面でやり直してください。', 'info');
        this.switchScreen('screen-draw');
      });
    }
  },

  _exportDrawExcel() {
    const select = document.getElementById('bracket-event-select');
    if (!select || !select.value) { this.showMessage('種目を選択してください', 'error'); return; }
    const result = this.drawResults[select.value];
    if (!result) { this.showMessage('ドローが生成されていません', 'error'); return; }
    const evtDef = AppConfig.EVENTS.find(e => e.code === select.value);
    DrawRenderer.exportToExcel({
      ...result,
      tournamentName: AppConfig.TOURNAMENT_NAME || '',
      date: AppConfig.TOURNAMENT_DATE || '',
      venue: AppConfig.TOURNAMENT_VENUE || '',
      matchFormat: AppConfig.MATCH_FORMAT || '',
      isDoubles: evtDef ? evtDef.category === 'doubles' : false,
    });
    this.showMessage('Excelファイルをダウンロードしました', 'success');
  },

  _exportDrawCSV() {
    const select = document.getElementById('bracket-event-select');
    if (!select || !select.value) { this.showMessage('種目を選択してください', 'error'); return; }
    const result = this.drawResults[select.value];
    if (!result) { this.showMessage('ドローが生成されていません', 'error'); return; }
    DrawRenderer.exportToCSV({
      ...result,
      tournamentName: AppConfig.TOURNAMENT_NAME || '',
      date: AppConfig.TOURNAMENT_DATE || '',
      venue: AppConfig.TOURNAMENT_VENUE || '',
      matchFormat: AppConfig.MATCH_FORMAT || '',
    });
    this.showMessage('CSVファイルをダウンロードしました', 'success');
  },

  _refreshBracketEventSelect() {
    const select = document.getElementById('bracket-event-select');
    if (!select) return;
    select.innerHTML = '';

    let firstCode = '';
    const codes = [];
    for (const code of Object.keys(this.drawResults)) {
      const result = this.drawResults[code];
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = result.eventName;
      select.appendChild(opt);
      codes.push(code);
      if (!firstCode) firstCode = code;
    }

    // 種目チップ表示
    const chipsEl = document.getElementById('bracket-event-chips');
    const summaryEl = document.getElementById('bracket-event-summary');
    if (chipsEl && summaryEl) {
      if (codes.length > 0) {
        summaryEl.style.display = '';
        chipsEl.innerHTML = '';
        for (const code of codes) {
          const result = this.drawResults[code];
          const chip = document.createElement('button');
          chip.className = 'btn btn-sm btn-secondary';
          chip.textContent = result.eventName + ' (' + (result.entryCount || 0) + '名)';
          chip.addEventListener('click', () => {
            select.value = code;
            this._onBracketEventChange();
          });
          chipsEl.appendChild(chip);
        }
      } else {
        summaryEl.style.display = 'none';
      }
    }

    if (!firstCode) {
      select.innerHTML = '<option value="">ドローが確定されていません</option>';
      return;
    }
    // 最初の種目を自動選択
    select.value = firstCode;
    this._onBracketEventChange();
  },

  _onBracketEventChange() {
    const select = document.getElementById('bracket-event-select');
    const emptyMsg = document.getElementById('bracket-empty-msg');
    const entryList = document.getElementById('bracket-entry-list');
    if (!select || !select.value) {
      if (emptyMsg) emptyMsg.style.display = '';
      if (entryList) entryList.style.display = 'none';
      const btnClearEl = document.getElementById('btn-bracket-clear');
      if (btnClearEl) btnClearEl.style.display = 'none';
      const btnRedoEl = document.getElementById('btn-bracket-redo');
      if (btnRedoEl) btnRedoEl.style.display = 'none';
      return;
    }

    const eventCode = select.value;
    const result = this.drawResults[eventCode];
    if (!result) return;

    if (emptyMsg) emptyMsg.style.display = 'none';

    // SVG 描画
    const container = document.getElementById('bracket-container');
    if (container) {
      const evtInfo = AppConfig.EVENTS.find(e => e.code === eventCode);
      DrawRenderer.render(container, {
        draw: result.draw,
        drawSize: result.drawSize,
        eventName: result.eventName,
        tournamentName: AppConfig.TOURNAMENT_NAME || '',
        date: AppConfig.TOURNAMENT_DATE || '',
        venue: AppConfig.TOURNAMENT_VENUE || '',
        matchFormat: AppConfig.MATCH_FORMAT || '',
        entries: result.entries,
        seeds: result.seeds,
        entryCount: result.entryCount,
        isDoubles: evtInfo ? evtInfo.category === 'doubles' : false,
      });
    }

    // クリア・やり直しボタン表示
    const btnClear = document.getElementById('btn-bracket-clear');
    if (btnClear) btnClear.style.display = '';
    const btnRedo = document.getElementById('btn-bracket-redo');
    if (btnRedo) btnRedo.style.display = result.confirmed ? '' : 'none';

    // エントリーリスト表示
    const evtDef = AppConfig.EVENTS.find(e => e.code === eventCode);
    const isDoubles = evtDef ? evtDef.category === 'doubles' : false;
    if (entryList) {
      entryList.style.display = '';
      const tbody = document.getElementById('bracket-entry-body');
      if (tbody) {
        tbody.innerHTML = '';
        for (const entry of result.draw) {
          if (entry.isBye) continue;
          if (isDoubles && entry.name && entry.name.includes(' / ')) {
            // ダブルス: ペアを表示
            const names = entry.name.split(' / ');
            const affils = (entry.affiliation || '').split(' / ');
            const tr1 = document.createElement('tr');
            tr1.innerHTML =
              '<td rowspan="2">' + entry.position + '</td>' +
              '<td>' + this._esc(names[0] || '') + '</td>' +
              '<td>' + this._esc(affils[0] || '') + '</td>' +
              '<td rowspan="2">' + (entry.points || 0) + '</td>';
            tbody.appendChild(tr1);
            const tr2 = document.createElement('tr');
            tr2.innerHTML =
              '<td>' + this._esc(names[1] || '') + '</td>' +
              '<td>' + this._esc(affils[1] || affils[0] || '') + '</td>';
            tbody.appendChild(tr2);
          } else {
            const tr = document.createElement('tr');
            tr.innerHTML =
              '<td>' + entry.position + '</td>' +
              '<td>' + this._esc(entry.name) + '</td>' +
              '<td>' + this._esc(entry.affiliation || '') + '</td>' +
              '<td>' + (entry.points || 0) + '</td>';
            tbody.appendChild(tr);
          }
        }
      }
    }
  },

  // ================================================================
  // マニュアル画面
  // ================================================================

  // ================================================================
  // バックアップ画面
  // ================================================================

  initBackupScreen() {
    const btnExportAll = document.getElementById('btn-backup-export-all');
    if (btnExportAll) btnExportAll.addEventListener('click', () => this._exportAllBackup());

    const fileImportAll = document.getElementById('file-backup-import-all');
    if (fileImportAll) fileImportAll.addEventListener('change', (e) => this._importAllBackup(e));

    const btnClearAll = document.getElementById('btn-backup-clear-all');
    if (btnClearAll) btnClearAll.addEventListener('click', () => {
      if (confirm('全てのデータを削除しますか？この操作は取り消せません。')) {
        localStorage.removeItem('drawSystem_entries');
        localStorage.removeItem('drawSystem_tournaments');
        localStorage.removeItem('drawSystem_rankingBackup');
        localStorage.removeItem('drawSystem_tournamentBackup');
        localStorage.removeItem('drawSystem_drawResults');
        EntryStore.entries = [];
        EntryStore.nextId = 1;
        TournamentStore.tournaments = [];
        TournamentStore.nextId = 1;
        RankingLoader.rankings = {};
        RankingLoader.allPlayers = [];
        RankingLoader.furiganaMap = {};
        RankingLoader.listMembers = [];
        this.drawResults = {};
        this.confirmedEvents = {};
        this.refreshBackupTable();
        this.showMessage('全データをクリアしました', 'info');
      }
    });
  },

  refreshBackupTable() {
    const tbody = document.getElementById('backup-data-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const items = [
      {
        name: 'ランキングデータ',
        key: 'drawSystem_rankingBackup',
        getCount: () => {
          const d = RankingLoader.getBackupDate();
          if (!d) return '0件';
          try {
            const b = JSON.parse(localStorage.getItem('drawSystem_rankingBackup') || '{}');
            return (b.allPlayers ? b.allPlayers.length : 0) + '名';
          } catch (e) { return '0件'; }
        },
        getDate: () => RankingLoader.getBackupDate(),
        onClear: () => {
          localStorage.removeItem('drawSystem_rankingBackup');
          RankingLoader.rankings = {};
          RankingLoader.allPlayers = [];
          RankingLoader.furiganaMap = {};
          RankingLoader.listMembers = [];
        },
        onExport: () => {
          const data = localStorage.getItem('drawSystem_rankingBackup');
          if (!data) { this.showMessage('データがありません', 'error'); return; }
          this._downloadJSON(data, 'ranking_backup.json');
        },
      },
      {
        name: '大会一覧',
        key: 'drawSystem_tournamentBackup',
        getCount: () => {
          const all = TournamentStore.getAll();
          return all.length + '件';
        },
        getDate: () => TournamentStore.getBackupDate(),
        onClear: () => {
          TournamentStore.clear();
          localStorage.removeItem('drawSystem_tournamentBackup');
        },
        onExport: () => {
          const data = localStorage.getItem('drawSystem_tournaments');
          if (!data) { this.showMessage('データがありません', 'error'); return; }
          this._downloadJSON(data, 'tournament_backup.json');
        },
      },
      {
        name: 'エントリーデータ',
        key: 'drawSystem_entries',
        getCount: () => {
          return EntryStore.getAll().length + '件';
        },
        getDate: () => {
          try {
            const entries = EntryStore.getAll();
            if (entries.length === 0) return null;
            const latest = entries.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
            return latest.updatedAt || null;
          } catch (e) { return null; }
        },
        onClear: () => { EntryStore.clear(); },
        onExport: () => {
          const json = EntryStore.exportJSON();
          this._downloadJSON(json, 'entry_backup.json');
        },
      },
      {
        name: 'ドロー結果',
        key: 'drawSystem_drawResults',
        getCount: () => {
          const keys = Object.keys(this.drawResults);
          return keys.length + '種目';
        },
        getDate: () => {
          try {
            const saved = localStorage.getItem('drawSystem_drawResults');
            if (!saved) return null;
            const data = JSON.parse(saved);
            return data.savedAt || null;
          } catch (e) { return null; }
        },
        onClear: () => {
          this.drawResults = {};
          this.confirmedEvents = {};
          localStorage.removeItem('drawSystem_drawResults');
        },
        onExport: () => {
          const data = localStorage.getItem('drawSystem_drawResults');
          if (!data && Object.keys(this.drawResults).length === 0) {
            this.showMessage('データがありません', 'error'); return;
          }
          const exportData = JSON.stringify({ drawResults: this.drawResults, confirmedEvents: this.confirmedEvents, savedAt: new Date().toISOString() }, null, 2);
          this._downloadJSON(exportData, 'draw_results_backup.json');
        },
      },
    ];

    items.forEach(item => {
      const tr = document.createElement('tr');
      const sizeBytes = (localStorage.getItem(item.key) || '').length * 2;
      const sizeStr = sizeBytes < 1024 ? sizeBytes + ' B'
        : sizeBytes < 1048576 ? (sizeBytes / 1024).toFixed(1) + ' KB'
        : (sizeBytes / 1048576).toFixed(1) + ' MB';
      const dateVal = item.getDate();
      const dateStr = dateVal ? new Date(dateVal).toLocaleString('ja-JP') : '-';

      tr.innerHTML =
        '<td>' + item.name + '</td>' +
        '<td>' + item.getCount() + '</td>' +
        '<td>' + dateStr + '</td>' +
        '<td>' + sizeStr + '</td>' +
        '<td class="action-cell"></td>';

      const actionCell = tr.querySelector('.action-cell');

      const btnExport = document.createElement('button');
      btnExport.className = 'btn btn-sm btn-secondary';
      btnExport.textContent = 'エクスポート';
      btnExport.addEventListener('click', () => { item.onExport(); });
      actionCell.appendChild(btnExport);

      const btnClear = document.createElement('button');
      btnClear.className = 'btn btn-sm btn-danger';
      btnClear.textContent = '削除';
      btnClear.style.marginLeft = '4px';
      btnClear.addEventListener('click', () => {
        if (confirm(item.name + ' を削除しますか？')) {
          item.onClear();
          this.refreshBackupTable();
          this.showMessage(item.name + ' を削除しました', 'info');
        }
      });
      actionCell.appendChild(btnClear);

      tbody.appendChild(tr);
    });
  },

  _downloadJSON(jsonStr, filename) {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  _exportAllBackup() {
    const allData = {};
    const keys = ['drawSystem_rankingBackup', 'drawSystem_tournaments', 'drawSystem_tournamentBackup', 'drawSystem_entries'];
    keys.forEach(k => {
      const val = localStorage.getItem(k);
      if (val) allData[k] = JSON.parse(val);
    });
    allData['drawSystem_drawResults'] = { drawResults: this.drawResults, confirmedEvents: this.confirmedEvents };
    allData.exportedAt = new Date().toISOString();
    this._downloadJSON(JSON.stringify(allData, null, 2), 'draw_system_full_backup.json');
    this.showMessage('全データをエクスポートしました', 'success');
  },

  _importAllBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data['drawSystem_rankingBackup']) {
          localStorage.setItem('drawSystem_rankingBackup', JSON.stringify(data['drawSystem_rankingBackup']));
          RankingLoader.restoreFromBackup();
        }
        if (data['drawSystem_entries']) {
          const entryData = data['drawSystem_entries'];
          localStorage.setItem('drawSystem_entries', JSON.stringify(entryData));
          EntryStore.init();
        }
        if (data['drawSystem_tournaments']) {
          localStorage.setItem('drawSystem_tournaments', JSON.stringify(data['drawSystem_tournaments']));
          TournamentStore.init();
        }
        if (data['drawSystem_tournamentBackup']) {
          localStorage.setItem('drawSystem_tournamentBackup', JSON.stringify(data['drawSystem_tournamentBackup']));
        }
        if (data['drawSystem_drawResults']) {
          const dr = data['drawSystem_drawResults'];
          if (dr.drawResults) this.drawResults = dr.drawResults;
          if (dr.confirmedEvents) this.confirmedEvents = dr.confirmedEvents;
          localStorage.setItem('drawSystem_drawResults', JSON.stringify(dr));
        }
        this.refreshBackupTable();
        this.showMessage('全データをインポートしました', 'success');
      } catch (err) {
        this.showMessage('インポートに失敗: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  },

  initManualScreen() {
    document.querySelectorAll('.manual-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.dataset.manualTab;
        document.querySelectorAll('.manual-content').forEach(c => c.classList.remove('active'));
        const target = document.getElementById(tabId);
        if (target) target.classList.add('active');
      });
    });
  },

  // ================================================================
  // 共通ユーティリティ
  // ================================================================

  /**
   * 通知メッセージ表示（トースト）
   * @param {string} text メッセージテキスト
   * @param {string} type 'success' | 'error' | 'info'
   */
  showMessage(text, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    if (!container) {
      console.log('[' + type + '] ' + text);
      return;
    }

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = text;
    toast.style.cssText =
      'padding:12px 20px;margin-bottom:8px;border-radius:6px;color:#fff;font-size:14px;' +
      'opacity:0;transition:opacity 0.3s;cursor:pointer;max-width:400px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.2);';

    if (type === 'success') toast.style.backgroundColor = '#2E7D32';
    else if (type === 'error') toast.style.backgroundColor = '#C62828';
    else toast.style.backgroundColor = '#1565C0';

    container.appendChild(toast);

    // フェードイン
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    // クリックで即削除
    toast.addEventListener('click', () => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    });

    // 3秒後に自動消去
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  /**
   * HTML エスケープ
   */
  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * EntryStore が存在しない場合の最小スタブ
   * (entry-store.js が別途実装される想定だが、なくても動くように)
   */
  _createEntryStoreStub() {
    let entries = [];
    let nextId = 1;

    // localStorage から復元を試みる
    try {
      const saved = localStorage.getItem('drawSystem_entries');
      if (saved) {
        const parsed = JSON.parse(saved);
        entries = parsed.entries || [];
        nextId = parsed.nextId || 1;
      }
    } catch (e) { /* ignore */ }

    const save = () => {
      try {
        localStorage.setItem('drawSystem_entries', JSON.stringify({ entries, nextId }));
      } catch (e) { /* ignore */ }
    };

    return {
      init() {},

      add(data) {
        const entry = { ...data, id: nextId++ };
        entries.push(entry);
        save();
        return entry;
      },

      update(id, data) {
        const idx = entries.findIndex(e => e.id === id);
        if (idx >= 0) {
          entries[idx] = { ...entries[idx], ...data, id };
          save();
        }
      },

      remove(id) {
        entries = entries.filter(e => e.id !== id);
        save();
      },

      getAll() {
        return [...entries];
      },

      getById(id) {
        return entries.find(e => e.id === id) || null;
      },

      getByEvent(eventCode) {
        return entries.filter(e => e.eventCode === eventCode);
      },

      clear() {
        entries = [];
        nextId = 1;
        save();
      },

      export() {
        return JSON.stringify(entries, null, 2);
      },
    };
  },
};

// DOMContentLoaded で初期化
document.addEventListener('DOMContentLoaded', () => App.init());
