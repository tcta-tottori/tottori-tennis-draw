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
  _isDataLoading: false, // データ読込中フラグ

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

    // タブバー切り替えイベント
    document.querySelectorAll('.tab-bar .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchScreen(btn.dataset.screen);
      });
    });

    // ドロー結果の復元
    this._restoreDrawResults();

    // 各画面の初期化
    this.initDataScreen();
    this.initRankingScreen();
    this.initEntryImport();
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
    this._showLoadingOverlay('選手データを読込中...');
    try {
      await this._loadRankingFromGS();
      await this._loadFuriganaFromGS();
    } finally {
      this._hideLoadingOverlay();
    }
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

    // タブバーのアクティブ状態を更新
    document.querySelectorAll('.tab-bar .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === screenId);
    });
    // アクティブタブを画面内にスクロール
    const activeTab = document.querySelector('.tab-bar .tab-btn.active');
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    // 画面切り替え時のリフレッシュ
    if (screenId === 'screen-ranking') {
      if (this._isDataLoading) {
        this._showLoadingOverlay('選手データを読込中...');
      }
      this.refreshRankingTable();
    }
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
      if (furiganaCountEl) furiganaCountEl.textContent = furiganaTotal;

      // 種目別の詳細表示（男女色分け）
      const detailEl = document.getElementById('data-summary-detail');
      if (detailEl && detailLines.length > 0) {
        const maleLines = [];
        const femaleLines = [];
        for (const evt of AppConfig.EVENTS) {
          if (status[evt.code] && status[evt.code].count > 0) {
            const line = '<span>' + evt.shortName + ': ' + status[evt.code].count + '名</span>';
            if (evt.code.startsWith('m')) maleLines.push(line);
            else if (evt.code.startsWith('l')) femaleLines.push(line);
          }
        }
        let html = '';
        if (maleLines.length > 0) {
          html += '<div style="margin-bottom:6px;"><span style="font-size:12px;font-weight:600;color:#1e40af;margin-right:8px;">男子</span><span style="display:inline-flex;flex-wrap:wrap;gap:6px 12px;font-size:13px;color:#1e40af;">' + maleLines.join('') + '</span></div>';
        }
        if (femaleLines.length > 0) {
          html += '<div><span style="font-size:12px;font-weight:600;color:#be185d;margin-right:8px;">女子</span><span style="display:inline-flex;flex-wrap:wrap;gap:6px 12px;font-size:13px;color:#be185d;">' + femaleLines.join('') + '</span></div>';
        }
        detailEl.innerHTML = html;
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

      // 全種目タブは削除
      // デフォルトで最初の種目を自動選択（eventCode未選択なら）
      if (!this._rankingFilter.eventCode && !this._rankingFilter.showList) {
        const firstEvt = categoryEvents.find(e => (RankingLoader.rankings[e.code] || []).length > 0);
        if (firstEvt) {
          this._rankingFilter.eventCode = firstEvt.code;
          this.refreshRankingTable();
          return;
        }
      }
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

    // エントリー済み非表示の初期状態を維持
    if (this._hideEnteredPlayers === undefined) this._hideEnteredPlayers = true;
    if (this._hideEnteredPlayers) {
      table.classList.add('hide-entered');
    } else {
      table.classList.remove('hide-entered');
    }

    // エントリー済み名簿をチェック用に構築
    const enteredSet = new Set();
    const allEntries = EntryStore.getAll();
    for (const e of allEntries) {
      enteredSet.add(e.name + '|' + e.eventCode);
    }

    // 全種目混在表示の場合: 男→女が第一優先、次に種目で優先した並び
    if (!this._rankingFilter.eventCode && !isListView) {
      players.sort((a, b) => {
        const aIsMale = a.eventCode ? a.eventCode.startsWith('m') : true;
        const bIsMale = b.eventCode ? b.eventCode.startsWith('m') : true;
        if (aIsMale !== bIsMale) return aIsMale ? -1 : 1;
        if (a.eventCode !== b.eventCode) return (a.eventCode || '').localeCompare(b.eventCode || '');
        return (a.rank || 999) - (b.rank || 999);
      });
    }

    // 男女判定
    const rankIsMale = this._rankingFilter.eventCode ? this._rankingFilter.eventCode.startsWith('m') : false;
    const rankIsFemale = this._rankingFilter.eventCode ? this._rankingFilter.eventCode.startsWith('l') : false;

    // 男女別行カウンター
    let maleRowIdx = 0;
    let femaleRowIdx = 0;

    const maxStagger = 30;
    players.forEach((p, idx) => {
      const tr = document.createElement('tr');
      if (idx < maxStagger) {
        tr.classList.add('row-enter');
        tr.style.animationDelay = (idx * 20) + 'ms';
      }
      // 男女別背景色
      const pIsMale = p.eventCode ? p.eventCode.startsWith('m') : rankIsMale;
      const pIsFemale = p.eventCode ? p.eventCode.startsWith('l') : rankIsFemale;
      if (pIsMale) {
        tr.style.backgroundColor = maleRowIdx % 2 === 0 ? '#f0f7ff' : '#ffffff';
        maleRowIdx++;
      } else if (pIsFemale) {
        tr.style.backgroundColor = femaleRowIdx % 2 === 0 ? '#fff0f3' : '#ffffff';
        femaleRowIdx++;
      }
      const evtObj = p.eventCode ? AppConfig.EVENTS.find(e => e.code === p.eventCode) : null;
      const furigana = p.furigana || RankingLoader.furiganaMap[p.name] || '';
      const isEntered = p.eventCode ? enteredSet.has(p.name + '|' + p.eventCode) : false;
      if (isEntered) tr.classList.add('row-entered');

      const furiganaInlineHtml = furigana ? '<span class="furigana-inline" style="display:block;font-size:8px;color:#9ca3af;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._esc(furigana) + '</span>' : '';
      tr.innerHTML =
        '<td class="text-center">' + (p.rank === '-' ? '<span style="color:#9ca3af;">-</span>' : p.rank) + '</td>' +
        '<td style="min-width:100px;">' + furiganaInlineHtml + '<strong style="white-space:nowrap;">' + this._esc(p.name) + '</strong></td>' +
        '<td class="col-furigana">' + this._esc(furigana) + '</td>' +
        '<td style="white-space:nowrap;">' + this._esc(p.affiliation || '') + '</td>' +
        '<td class="text-center col-points">' + (p.points || '-') + '</td>' +
        '<td class="action-cell" style="padding-right:8px;"></td>';

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

    // 全種目表示時: 男子→女子の背景グラデーション遷移（テーブルラッパー）
    const tableWrapper = tbody.closest('.table-wrapper');
    if (tableWrapper) {
      if (!this._rankingFilter.eventCode && !isListView && maleRowIdx > 0 && femaleRowIdx > 0) {
        const maleRatio = Math.round(maleRowIdx / (maleRowIdx + femaleRowIdx) * 100);
        tableWrapper.style.background = 'linear-gradient(to bottom, #f0f7ff 0%, #f0f7ff ' + maleRatio + '%, #fff0f3 ' + maleRatio + '%, #fff0f3 100%)';
      } else if (rankIsFemale) {
        tableWrapper.style.background = '#fff8fa';
      } else {
        tableWrapper.style.background = '';
      }
    }

    // エントリー済み非表示トグルボタン
    const enteredCount = players.filter(p => p.eventCode ? enteredSet.has(p.name + '|' + p.eventCode) : false).length;
    let toggleContainer = document.getElementById('ranking-entered-toggle');
    if (!toggleContainer) {
      toggleContainer = document.createElement('div');
      toggleContainer.id = 'ranking-entered-toggle';
      toggleContainer.style.cssText = 'text-align:center;padding:8px 0;';
      const parentWrapper = table.closest('.table-wrapper');
      if (parentWrapper && parentWrapper.nextSibling) {
        parentWrapper.parentNode.insertBefore(toggleContainer, parentWrapper.nextSibling);
      } else if (parentWrapper) {
        parentWrapper.parentNode.appendChild(toggleContainer);
      }
    }
    if (enteredCount > 0) {
      toggleContainer.style.display = '';
      const hideMode = this._hideEnteredPlayers;
      toggleContainer.innerHTML = '';
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn btn-sm btn-secondary';
      toggleBtn.style.cssText = 'font-size:12px;';
      toggleBtn.textContent = hideMode ? 'エントリー済み ' + enteredCount + '名を表示' : 'エントリー済みを非表示';
      toggleBtn.addEventListener('click', () => {
        this._hideEnteredPlayers = !this._hideEnteredPlayers;
        this._renderRankingRows();
      });
      toggleContainer.appendChild(toggleBtn);
    } else {
      toggleContainer.style.display = 'none';
    }

    // 表示件数を更新（非表示分を考慮）
    const visibleCount = this._hideEnteredPlayers ? (players.length - enteredCount) : players.length;
    if (countEl) countEl.textContent = visibleCount + '名' + (q ? '（検索結果）' : '') + (enteredCount > 0 && this._hideEnteredPlayers ? '（登録済 ' + enteredCount + '名 非表示）' : '');
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

      // スムーズにフェードアウトして消える
      tr.style.transition = 'background-color 0.3s';
      tr.style.backgroundColor = '#c8e6c9';
      btn.textContent = '登録済';
      btn.disabled = true;
      btn.style.opacity = '0.6';

      if (this._hideEnteredPlayers) {
        // 非表示モード: フェードアウトしてから行を非表示に
        setTimeout(() => {
          tr.classList.add('row-fade-out');
          setTimeout(() => {
            tr.classList.add('row-entered');
            tr.classList.remove('row-fade-out');
            // 行の色を再計算
            this._resetRowColors();
          }, 450);
        }, 500);
      } else {
        setTimeout(() => {
          tr.classList.add('row-entered');
          btn.remove();
          const badge = document.createElement('span');
          badge.className = 'entered-badge';
          badge.textContent = '登録済';
          tr.querySelector('.action-cell').appendChild(badge);
        }, 800);
      }
    } else {
      // 種目未確定でもモーダルなしで直接登録（種目選択はエントリーリストページで）
      this._showQuickEntryModal(player);
    }
  },

  /**
   * エントリー後に表示行の背景色を再計算
   */
  _resetRowColors() {
    const tbody = document.getElementById('ranking-table-body');
    if (!tbody) return;
    const visibleRows = Array.from(tbody.querySelectorAll('tr')).filter(tr => {
      return !tr.classList.contains('row-entered') || !document.getElementById('ranking-table').classList.contains('hide-entered');
    });
    const rankIsMale = this._rankingFilter.eventCode ? this._rankingFilter.eventCode.startsWith('m') : false;
    const rankIsFemale = this._rankingFilter.eventCode ? this._rankingFilter.eventCode.startsWith('l') : false;
    let visIdx = 0;
    visibleRows.forEach(tr => {
      if (tr.classList.contains('row-entered') && document.getElementById('ranking-table').classList.contains('hide-entered')) return;
      if (tr.classList.contains('row-entered')) {
        tr.style.backgroundColor = '#d5d5d5';
      } else {
        if (rankIsMale) {
          tr.style.backgroundColor = visIdx % 2 === 0 ? '#f0f7ff' : '#ffffff';
        } else if (rankIsFemale) {
          tr.style.backgroundColor = visIdx % 2 === 0 ? '#fff0f3' : '#ffffff';
        } else {
          tr.style.backgroundColor = visIdx % 2 === 0 ? '' : '#ffffff';
        }
      }
      visIdx++;
    });
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
  // エントリーデータ読込（Excel/CSV → 選手一覧と自動照合）
  // ================================================================

  initEntryImport() {
    const fileInput = document.getElementById('file-entry-import');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this._handleEntryImportFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // 種目セレクト初期化
    const eventSelect = document.getElementById('entry-import-event');
    if (eventSelect) {
      eventSelect.innerHTML = '<option value="">-- 自動判定 --</option>';
      for (const evt of AppConfig.EVENTS) {
        const opt = document.createElement('option');
        opt.value = evt.code;
        opt.textContent = evt.name;
        eventSelect.appendChild(opt);
      }
    }

    // 全選択チェック
    const checkAll = document.getElementById('entry-import-check-all');
    if (checkAll) {
      checkAll.addEventListener('change', () => {
        document.querySelectorAll('#entry-import-body input[type="checkbox"]').forEach(cb => {
          cb.checked = checkAll.checked;
        });
      });
    }

    // 登録ボタン
    const btnRegister = document.getElementById('btn-entry-import-register');
    if (btnRegister) {
      btnRegister.addEventListener('click', () => this._registerEntryImport());
    }
  },

  /**
   * エントリーデータファイル読込（Excel/CSV）
   * 1列目=氏名、2列目=所属、3列目=種目コード(省略可)
   */
  _handleEntryImportFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        this._processEntryImportRows(rows);
      } catch (err) {
        this.showMessage('ファイル読込エラー: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  _processEntryImportRows(rows) {
    const resultEl = document.getElementById('entry-import-result');
    const tbody = document.getElementById('entry-import-body');
    const countEl = document.getElementById('entry-import-count');
    if (!resultEl || !tbody) return;

    resultEl.style.display = '';
    tbody.innerHTML = '';

    const defaultEventSelect = document.getElementById('entry-import-event');
    const defaultEvent = defaultEventSelect ? defaultEventSelect.value : '';

    // ヘッダー行スキップ判定
    let startRow = 0;
    if (rows.length > 0) {
      const first = String(rows[0][0] || '').toLowerCase();
      if (first.includes('氏名') || first.includes('名前') || first === 'name' || first === '選手名') {
        startRow = 1;
      }
    }

    let matchCount = 0;
    let totalCount = 0;

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const importName = String(row[0]).trim();
      const importClub = row[1] ? String(row[1]).trim() : '';
      const importEvent = row[2] ? String(row[2]).trim() : defaultEvent;
      if (!importName) continue;
      totalCount++;

      // 選手一覧との照合（ファジーマッチ）
      const candidates = FuzzyMatch.matchName(importName);
      const bestMatch = candidates.length > 0 && candidates[0].score >= 50 ? candidates[0] : null;
      if (bestMatch) matchCount++;

      const tr = document.createElement('tr');

      // チェックボックス
      const tdCheck = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      tdCheck.appendChild(cb);
      tr.appendChild(tdCheck);

      // 読込氏名
      const tdRaw = document.createElement('td');
      tdRaw.textContent = importName;
      tdRaw.style.fontSize = '12px';
      tr.appendChild(tdRaw);

      // 照合結果
      const tdStatus = document.createElement('td');
      if (bestMatch && bestMatch.score >= 80) {
        tdStatus.innerHTML = '<span style="color:#2E7D32;font-weight:bold;">一致</span>';
      } else if (bestMatch) {
        tdStatus.innerHTML = '<span style="color:#F57F17;">類似(' + bestMatch.score + '%)</span>';
      } else {
        tdStatus.innerHTML = '<span style="color:#C62828;">未照合</span>';
      }
      tr.appendChild(tdStatus);

      // 氏名（編集可能 - 照合結果優先）
      const tdName = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'form-input form-input-sm';
      nameInput.value = bestMatch ? bestMatch.name : importName;
      nameInput.style.width = '120px';
      tdName.appendChild(nameInput);
      tr.appendChild(tdName);

      // 所属
      const tdClub = document.createElement('td');
      const clubInput = document.createElement('input');
      clubInput.type = 'text';
      clubInput.className = 'form-input form-input-sm';
      clubInput.value = bestMatch ? bestMatch.affiliation : importClub;
      clubInput.style.width = '100px';
      tdClub.appendChild(clubInput);
      tr.appendChild(tdClub);

      // 種目
      const tdEvent = document.createElement('td');
      const evtSel = document.createElement('select');
      evtSel.className = 'form-select form-select-sm';
      evtSel.innerHTML = '<option value="">選択</option>';
      for (const evt of AppConfig.EVENTS) {
        const opt = document.createElement('option');
        opt.value = evt.code;
        opt.textContent = evt.shortName;
        if (bestMatch && bestMatch.eventCode === evt.code) {
          opt.selected = true;
        } else if (!bestMatch && importEvent === evt.code) {
          opt.selected = true;
        }
        evtSel.appendChild(opt);
      }
      tdEvent.appendChild(evtSel);
      tr.appendChild(tdEvent);

      // ポイント
      const tdPt = document.createElement('td');
      tdPt.textContent = bestMatch ? (bestMatch.points || 0) : '0';
      tdPt.style.textAlign = 'center';
      tdPt.dataset.points = bestMatch ? (bestMatch.points || 0) : 0;
      tr.appendChild(tdPt);

      tbody.appendChild(tr);
    }

    if (countEl) countEl.textContent = totalCount + '件 (照合: ' + matchCount + '件)';
    this.showMessage(totalCount + '件読込、' + matchCount + '件が選手一覧と照合されました', 'info');
  },

  _registerEntryImport() {
    const rows = document.querySelectorAll('#entry-import-body tr');
    let registered = 0;

    rows.forEach(tr => {
      const cb = tr.querySelector('input[type="checkbox"]');
      if (!cb || !cb.checked) return;

      const cells = tr.querySelectorAll('td');
      // cells: [check, rawName, status, name, club, event, points]
      const nameInput = cells[3].querySelector('input');
      const clubInput = cells[4].querySelector('input');
      const evtSelect = cells[5].querySelector('select');
      const name = nameInput ? nameInput.value.trim() : '';
      const affiliation = clubInput ? clubInput.value.trim() : '';
      const eventCode = evtSelect ? evtSelect.value : '';

      if (!name || !eventCode) return;

      const points = Number(cells[6].dataset.points) || 0;
      const furigana = RankingLoader.furiganaMap[name] || '';

      // 重複チェック
      const existing = EntryStore.getAll().find(e => e.name === name && e.eventCode === eventCode);
      if (existing) return;

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
      this.showMessage(registered + '件をエントリーリストに追加しました', 'success');
      // 結果エリアを非表示
      const resultEl = document.getElementById('entry-import-result');
      if (resultEl) resultEl.style.display = 'none';
    } else {
      this.showMessage('追加する項目がありません（重複または種目未選択）', 'error');
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

  _refreshDrawStatusBar() {
    const container = document.getElementById('entry-draw-status');
    const chips = document.getElementById('entry-draw-status-chips');
    if (!container || !chips) return;

    chips.innerHTML = '';
    let hasAny = false;

    for (const code of Object.keys(this.drawResults || {})) {
      const result = this.drawResults[code];
      if (!result) continue;
      hasAny = true;
      const evt = AppConfig.EVENTS.find(e => e.code === code);
      const evtName = evt ? evt.shortName || evt.name : code;
      const isConfirmed = this.confirmedEvents && this.confirmedEvents[code];

      const chip = document.createElement('span');
      chip.className = 'draw-status-chip ' + (isConfirmed ? 'status-confirmed' : 'status-lottery');
      chip.innerHTML = (isConfirmed ? '[確定] ' : '[抽選中] ') + this._esc(evtName);

      // クリックで該当ページへ
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', () => {
        if (isConfirmed) {
          this.switchScreen('screen-bracket');
          const sel = document.getElementById('bracket-event-select');
          if (sel) { sel.value = code; sel.dispatchEvent(new Event('change')); }
        } else {
          this.switchScreen('screen-draw');
          const sel = document.getElementById('draw-event-select');
          if (sel) { sel.value = code; sel.dispatchEvent(new Event('change')); }
        }
      });

      // クリアボタン
      const clearBtn = document.createElement('button');
      clearBtn.className = 'chip-clear';
      clearBtn.textContent = '\u00d7';
      clearBtn.title = 'クリア';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(evtName + ' のドローをクリアしますか？')) {
          delete this.drawResults[code];
          if (this.confirmedEvents) delete this.confirmedEvents[code];
          this._saveDrawResults();
          this._refreshDrawStatusBar();
        }
      });
      chip.appendChild(clearBtn);
      chips.appendChild(chip);
    }

    container.style.display = hasAny ? '' : 'none';
  },

  refreshEntryTable() {
    const tbody = document.getElementById('entry-table-body');
    const totalCount = document.getElementById('entry-total-count');
    if (!tbody) return;

    // 大会プルダウンを更新
    this._refreshTournamentSelect();

    // 抽選・確定ステータスバーを更新
    this._refreshDrawStatusBar();

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
    const entryTable = document.getElementById('entry-table');
    // 男女判定（種目コードで色分け）
    const isMaleEvent = targetCode && targetCode.startsWith('m');
    const isFemaleEvent = targetCode && targetCode.startsWith('l');
    if (thead) {
      if (isDoubles) {
        thead.innerHTML = '<tr><th>P</th><th>氏名</th><th>所属</th><th>個人pt</th><th>合計pt</th><th>操作</th></tr>';
        if (entryTable) entryTable.classList.add('entry-doubles');
      } else {
        thead.innerHTML = '<tr><th>No.</th><th>氏名</th><th>所属</th><th>ポイント</th><th>操作</th></tr>';
        if (entryTable) entryTable.classList.remove('entry-doubles');
      }
      // 男女別ヘッダー色
      if (isMaleEvent) {
        thead.querySelector('tr').style.background = '#e3f2fd';
      } else if (isFemaleEvent) {
        thead.querySelector('tr').style.background = '#fce4ec';
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
        // 男女別背景色
        if (isMaleEvent && idx % 2 === 0) tr.style.backgroundColor = '#f0f7ff';
        else if (isFemaleEvent && idx % 2 === 0) tr.style.backgroundColor = '#fff5f7';
        const entryFuriganaHtml = entry.furigana ? '<span class="furigana-fit">' + this._esc(entry.furigana) + '</span>' : '';

        tr.innerHTML =
          '<td>' + (idx + 1) + '</td>' +
          '<td>' + entryFuriganaHtml + this._esc(entry.name) + '</td>' +
          '<td>' + this._esc(entry.affiliation || '') + '</td>' +
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
            // ダブルス: 苗字のみ表示
            let displayName = p.name;
            if (displayName && displayName.includes(' / ')) {
              displayName = displayName.split(' / ').map(n => n.split(/\s+/)[0]).join('/');
            }
            html += '<span class="seed-chip">[' + (i + 1) + '] ' + this._esc(displayName) + ' <small>(' + p.points + 'pt)</small></span>';
          });
          html += '</div>';
        }
        seedInfoEl.innerHTML = html;
      }
    }

    // 入れ替え選択中の状態
    this._swapSelectedEntryId = this._swapSelectedEntryId || null;
    this._swapEventCode = eventCode;

    // ペアごとに2行でグループ表示（男女別色分け）
    const dblIsMale = eventCode.startsWith('m');
    const dblIsFemale = eventCode.startsWith('l');
    pairs.forEach((pair, pairIdx) => {
      const isIncomplete = pair.incomplete;
      const bgColor = isIncomplete ? '#ffebee' : (pairIdx % 2 === 0 ? (dblIsFemale ? '#fff5f7' : '#f0f7ff') : '#ffffff');
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

        const dblFuriganaHtml = entry.furigana ? '<span class="furigana-fit">' + this._esc(entry.furigana) + '</span>' : '';
        tr.innerHTML =
          '<td class="text-center">' + pairLabel + '</td>' +
          '<td class="doubles-swap-cell" style="cursor:pointer;">' + dblFuriganaHtml + this._esc(entry.name) + '</td>' +
          '<td>' + this._esc(entry.affiliation || '') + '</td>' +
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
        separatorTr.innerHTML = '<td colspan="6" style="padding:0;height:2px;background:#cbd5e1;"></td>';
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

    // 初期表示
    this.refreshTournamentsTable();
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
        '<td>' + this._esc(this._formatTournamentDate(t.date, t.dayOfWeek)) + '</td>' +
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

    // 再読込ボタン（エントリー変更を反映）
    const btnDrawReload = document.getElementById('btn-draw-reload');
    if (btnDrawReload) {
      btnDrawReload.addEventListener('click', () => {
        this._onDrawEventChange();
        this.showMessage('エントリーデータを再読込しました', 'info');
      });
    }

    // 抽選クリアボタン
    const btnDrawClear = document.getElementById('btn-draw-clear');
    if (btnDrawClear) {
      btnDrawClear.addEventListener('click', () => {
        if (confirm('現在の抽選結果をクリアしますか？')) {
          this._resetDraw();
          this.showMessage('抽選をクリアしました', 'info');
        }
      });
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

    // スケールスライダーは廃止（自動フィット）

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
        affiliation1: p.affiliation1 || '',
        affiliation2: p.affiliation2 || '',
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

      // 連動: 変更されたセレクトの値を優先し、重複を解消
      const syncSeed58 = (changedSeed) => {
        const selects = seeds58.map(sp => document.getElementById('seed' + sp.seed + '-position')).filter(Boolean);
        if (selects.length === 0) return;

        // changedSeed がある場合、そのセレクトの値を固定して他の重複を解消
        if (changedSeed !== null) {
          const changedIdx = seeds58.findIndex(sp => sp.seed === changedSeed);
          const changedVal = selects[changedIdx] ? selects[changedIdx].value : null;

          // 重複しているセレクトを探して別の値に振り替え
          selects.forEach((sel, i) => {
            if (i !== changedIdx && sel.value === changedVal) {
              const usedVals = selects.map(s => s.value);
              const available = pos58.map(String).find(p => !usedVals.includes(p) || p === sel.value);
              const freeVal = pos58.map(String).find(p => {
                return !selects.some((s2, j) => j !== i && s2.value === p);
              });
              if (freeVal) sel.value = freeVal;
            }
          });
        }

        // optionのdisabled状態は設定しない（手動変更を妨げないため）
        // 代わりに視覚的なヒントのみ
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
      affiliation1: player.affiliation1 || '',
      affiliation2: player.affiliation2 || '',
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
        // ルーレット配置ボタン（選手を選択してから押す）
        if (this._unplacedPlayers.length > 0) {
          const rouletteBtn = document.createElement('button');
          rouletteBtn.className = 'btn btn-sm btn-primary';
          rouletteBtn.style.cssText = 'margin-bottom:8px;margin-right:8px;';
          rouletteBtn.textContent = 'ルーレット配置';
          rouletteBtn.disabled = this._selectedPlayer === null;
          if (this._selectedPlayer === null) {
            rouletteBtn.title = '先に選手を選択してください';
          }
          rouletteBtn.addEventListener('click', () => this._rouletteIndividualPlayer());
          unplacedList.appendChild(rouletteBtn);
          unplacedList.appendChild(document.createElement('br'));
        }
        // ダブルス判定
        const drawEventSel = document.getElementById('draw-event-select');
        const drawEventCode = drawEventSel ? drawEventSel.value : '';
        let drawIsDoubles = false;
        try { drawIsDoubles = drawEventCode && EntryStore.isDoublesEvent(drawEventCode); } catch(e) {}

        this._unplacedPlayers.forEach((p, idx) => {
          const chip = document.createElement('button');
          chip.className = 'unplaced-chip' + (this._selectedPlayer === idx ? ' selected' : '');
          // ダブルスは苗字のみ・所属3文字
          let chipLabel = p.name;
          if (drawIsDoubles && chipLabel && chipLabel.includes(' / ')) {
            chipLabel = chipLabel.split(' / ').map(n => n.split(/[\s\u3000]+/)[0]).join('/');
          }
          let chipAff = '';
          if (drawIsDoubles && p.affiliation) {
            chipAff = ' ' + p.affiliation.substring(0, 3);
          }
          chip.textContent = chipLabel + chipAff + (p.points ? ' (' + p.points + 'pt)' : '');
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

    DrawRenderer.render(wrapper, drawData, { scale: 1.0 });

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

  /**
   * 同所属チェック: 手動配置時に1回戦で同所属が当たるかを判定
   * ダブルスでは片方でも同所属メンバーがいれば衝突とみなす
   */
  _checkAffiliationCollision(drawIndex, player) {
    const avoidCollision = document.querySelector('input[name="affiliation-collision"]:checked');
    const shouldAvoid = !avoidCollision || avoidCollision.value === 'avoid';
    if (!shouldAvoid) return false;

    // 1回戦の対戦相手インデックスを算出（偶数→+1、奇数→-1）
    const opponentIdx = (drawIndex % 2 === 0) ? drawIndex + 1 : drawIndex - 1;
    if (opponentIdx < 0 || opponentIdx >= this._manualDraw.length) return false;

    const opponent = this._manualDraw[opponentIdx];
    if (!opponent || opponent.isEmpty || opponent.isBye) return false;

    // ダブルスかどうか判定
    const evt = this._currentDrawData ? AppConfig.EVENTS.find(e => e.code === this._currentDrawData.eventCode) : null;
    const isDoubles = evt ? evt.category === 'doubles' : false;

    if (isDoubles) {
      // ダブルス: affiliation1, affiliation2 を使って片方でも一致すればNG
      const playerAffs = [player.affiliation1 || player.affiliation || '', player.affiliation2 || ''].filter(a => a);
      const opponentAffs = [opponent.affiliation1 || opponent.affiliation || '', opponent.affiliation2 || ''].filter(a => a);
      for (const pa of playerAffs) {
        for (const oa of opponentAffs) {
          if (pa && oa && pa === oa) return true;
        }
      }
      return false;
    } else {
      // シングルス: 所属が一致すればNG
      return player.affiliation && opponent.affiliation && player.affiliation === opponent.affiliation;
    }
  },

  _placePlayerAt(drawIndex) {
    if (this._selectedPlayer === null || !this._manualDraw) return;
    const player = this._unplacedPlayers[this._selectedPlayer];
    if (!player) return;

    // 同所属チェック
    if (this._checkAffiliationCollision(drawIndex, player)) {
      this.showMessage('同所属の選手が1回戦で対戦してしまうため、この位置には配置できません', 'error');
      return;
    }

    this._placeInDraw(this._manualDraw, drawIndex, player);
    this._unplacedPlayers.splice(this._selectedPlayer, 1);
    this._selectedPlayer = null;

    // 残り1人なら自動配置
    if (this._unplacedPlayers.length === 1 && (!this._unplacedByes || this._unplacedByes === 0)) {
      const lastPlayer = this._unplacedPlayers[0];
      const emptySlots = [];
      for (let i = 0; i < this._manualDraw.length; i++) {
        if (this._manualDraw[i].isEmpty) emptySlots.push(i);
      }
      if (emptySlots.length === 1) {
        this._placeInDraw(this._manualDraw, emptySlots[0], lastPlayer);
        this._unplacedPlayers = [];
        this.showMessage('最後の1人を自動配置しました', 'success');
      }
    }

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
      affiliation1: entry.affiliation1 || '',
      affiliation2: entry.affiliation2 || '',
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
    if (!this._manualDraw) return;

    // 未配置選手がいない場合 = 再配置モード（シード以外をリセットして再シャッフル）
    if (this._unplacedPlayers.length === 0) {
      const nonSeedPlayers = [];
      for (let i = 0; i < this._manualDraw.length; i++) {
        const entry = this._manualDraw[i];
        if (!entry.isBye && !entry.isEmpty && entry.seed === 0) {
          nonSeedPlayers.push({ ...entry });
          this._manualDraw[i] = { position: i + 1, name: '', affiliation: '', isEmpty: true, isBye: false, seed: 0 };
        }
      }
      if (nonSeedPlayers.length === 0) return;
      this._unplacedPlayers = nonSeedPlayers;
    }

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
   * ルーレットポップアップを表示するヘルパー
   */
  _showRoulettePopup() {
    const overlay = document.createElement('div');
    overlay.className = 'roulette-overlay';
    const popup = document.createElement('div');
    popup.className = 'roulette-popup';
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    return { overlay, popup };
  },

  _closeRoulettePopup(overlay) {
    if (overlay && overlay.parentNode) {
      overlay.style.animation = 'none';
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.2s';
      setTimeout(() => overlay.remove(), 200);
    }
  },

  /**
   * ルーレット抽選: ポップアップ式アニメーション
   */
  _rouletteSeedPositions() {
    if (!this._currentDrawData) return;

    const seeded = this._currentDrawData.seeds || [];
    if (seeded.length <= 2) return;

    const drawSize = this._currentDrawData.drawSize;
    const pos34 = DrawEngine.getSeed34Positions(drawSize);
    const pos58 = DrawEngine.getSeed58Positions(drawSize);

    const allPositions = [];
    if (seeded.length >= 3) {
      allPositions.push({ label: 'シード3・4', positions: pos34, seeds: [3, 4] });
    }
    if (seeded.length >= 5 && pos58.length > 0) {
      allPositions.push({ label: 'シード5〜8', positions: pos58, seeds: seeded.filter(s => s.seed >= 5 && s.seed <= 8).map(s => s.seed) });
    }

    if (allPositions.length === 0) return;

    const { overlay, popup } = this._showRoulettePopup();
    let currentGroup = 0;
    let rouletteTimer = null;

    const showGroup = (groupIdx) => {
      const group = allPositions[groupIdx];

      popup.innerHTML =
        '<div class="roulette-title">' + group.label + ' の位置抽選</div>' +
        '<div class="roulette-number-display" id="roulette-number">--</div>' +
        '<div class="roulette-hint">タップまたはEnterで確定</div>';

      const numDisplay = document.getElementById('roulette-number');
      let idx = 0;

      // アニメーション: 最初は速く、だんだん遅くはしない（手動停止なので一定速度）
      rouletteTimer = setInterval(() => {
        idx = (idx + 1) % group.positions.length;
        if (numDisplay) numDisplay.textContent = 'No.' + group.positions[idx];
      }, 70);

      const stopRoulette = () => {
        if (rouletteTimer) { clearInterval(rouletteTimer); rouletteTimer = null; }
        document.removeEventListener('keydown', onKeyDown);
        overlay.removeEventListener('click', onClickStop);

        const result = DrawEngine.shuffleArray([...group.positions]);

        // セレクトに反映
        group.seeds.forEach((seedNum, i) => {
          const sel = document.getElementById('seed' + seedNum + '-position');
          if (sel && i < result.length) sel.value = result[i];
        });

        // 結果表示
        let html = '<div class="roulette-title">' + group.label + ' 抽選結果</div><div style="margin:16px 0;">';
        result.forEach((p, i) => {
          html += '<div class="roulette-result-row">' +
            '<span class="seed-label">シード' + group.seeds[i] + '</span>' +
            '<span style="color:#666;">→</span>' +
            '<span class="position-label">No.' + p + '</span></div>';
        });
        html += '</div>';

        if (numDisplay) {
          numDisplay.classList.add('decided');
          numDisplay.textContent = result.map(p => 'No.' + p).join(' / ');
        }
        popup.innerHTML = html;

        currentGroup++;
        if (currentGroup < allPositions.length) {
          setTimeout(() => showGroup(currentGroup), 1800);
        } else {
          setTimeout(() => {
            popup.innerHTML =
              '<div class="roulette-complete">抽選完了！</div>' +
              '<p style="font-size:13px;color:#666;margin-top:8px;">「シード位置を確定して配置」を押してください</p>' +
              '<button class="roulette-close-btn" id="roulette-close">閉じる</button>';
            document.getElementById('roulette-close').addEventListener('click', () => this._closeRoulettePopup(overlay));
          }, 1800);
        }
      };

      const onKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); stopRoulette(); } };
      const onClickStop = (e) => { if (e.target === overlay || popup.contains(e.target)) stopRoulette(); };
      document.addEventListener('keydown', onKeyDown);
      overlay.addEventListener('click', onClickStop);
    };

    showGroup(0);
  },

  /**
   * 個別ルーレット: ポップアップ式で未配置選手を配置
   */
  _rouletteIndividualPlayer() {
    if (!this._manualDraw || !this._unplacedPlayers || this._unplacedPlayers.length === 0) return;
    if (this._selectedPlayer === null) {
      this.showMessage('先に選手を選択してください', 'info');
      return;
    }

    const draw = this._manualDraw;
    const emptySlots = [];
    for (let i = 0; i < draw.length; i++) {
      if (draw[i].isEmpty) emptySlots.push(i);
    }
    if (emptySlots.length === 0) return;

    const playerIdx = this._selectedPlayer;
    const player = this._unplacedPlayers[playerIdx];

    const { overlay, popup } = this._showRoulettePopup();

    popup.innerHTML =
      '<div class="roulette-title">配置位置の抽選</div>' +
      '<div class="roulette-player-name">' + this._esc(player.name) + '</div>' +
      '<div class="roulette-number-display" id="individual-roulette-num">--</div>' +
      '<div class="roulette-hint">タップまたはEnterで確定</div>';

    const numDisplay = document.getElementById('individual-roulette-num');
    let timer = setInterval(() => {
      const randSlot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
      if (numDisplay) numDisplay.textContent = 'No.' + (randSlot + 1);
    }, 70);

    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
      document.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onClickStop);

      const targetSlot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
      if (numDisplay) {
        numDisplay.textContent = 'No.' + (targetSlot + 1);
        numDisplay.classList.add('decided');
      }

      // 配置
      this._placeInDraw(draw, targetSlot, player);
      this._unplacedPlayers.splice(playerIdx, 1);
      this._selectedPlayer = null;

      setTimeout(() => {
        popup.innerHTML =
          '<div class="roulette-title">配置完了</div>' +
          '<div class="roulette-player-name">' + this._esc(player.name) + '</div>' +
          '<div class="roulette-result-row"><span class="position-label" style="font-size:24px;">No.' + (targetSlot + 1) + ' に配置</span></div>' +
          '<button class="roulette-close-btn" id="roulette-close">閉じる</button>';
        document.getElementById('roulette-close').addEventListener('click', () => {
          this._closeRoulettePopup(overlay);
          this._renderManualPlacement();
        });
      }, 800);
    };

    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); stop(); } };
    const onClickStop = (e) => { if (e.target === overlay || popup.contains(e.target)) stop(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', onClickStop);
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
    const isConfirmed = this.confirmedEvents && this.confirmedEvents[select.value];
    DrawRenderer.exportToExcel({
      ...result,
      tournamentName: AppConfig.TOURNAMENT_NAME || '',
      date: AppConfig.TOURNAMENT_DATE || '',
      venue: AppConfig.TOURNAMENT_VENUE || '',
      matchFormat: AppConfig.MATCH_FORMAT || '',
      isDoubles: evtDef ? evtDef.category === 'doubles' : false,
      confirmed: !!isConfirmed,
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
      const evtNameHide = document.getElementById('bracket-current-event-name');
      if (evtNameHide) evtNameHide.style.display = 'none';
      return;
    }

    const eventCode = select.value;
    const result = this.drawResults[eventCode];
    if (!result) return;

    if (emptyMsg) emptyMsg.style.display = 'none';

    // 種目名を表示
    const evtNameEl = document.getElementById('bracket-current-event-name');
    const evtLabelEl = document.getElementById('bracket-current-event-label');
    if (evtNameEl && evtLabelEl) {
      const evtDef = AppConfig.EVENTS.find(e => e.code === eventCode);
      evtNameEl.style.display = '';
      evtLabelEl.textContent = evtDef ? evtDef.name : eventCode;
    }

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
      }, { confirmed: true });
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
    // Excelエクスポート
    const btnExportExcel = document.getElementById('btn-backup-export-excel');
    if (btnExportExcel) btnExportExcel.addEventListener('click', () => this._exportBackupExcel());

    const btnExportAll = document.getElementById('btn-backup-export-all');
    if (btnExportAll) btnExportAll.addEventListener('click', () => this._exportAllBackup());

    const fileImportAll = document.getElementById('file-backup-import-all');
    if (fileImportAll) fileImportAll.addEventListener('change', (e) => this._importAllBackup(e));

    // 読込データへ反映ボタン
    const btnReflect = document.getElementById('btn-backup-reflect');
    if (btnReflect) btnReflect.addEventListener('click', () => {
      RankingLoader.restoreFromBackup();
      TournamentStore.init();
      EntryStore.init();
      this._restoreDrawResults();
      const status = RankingLoader.getStatus();
      this._updateRankingStatus(status);
      this.refreshTournamentsTable();
      this.showMessage('バックアップデータを読込データに反映しました', 'success');
    });

    // データ読込ページのバックアップインポート（全データ一括）
    const fileDataBackup = document.getElementById('file-data-backup-import');
    if (fileDataBackup) fileDataBackup.addEventListener('change', (e) => this._importAllBackup(e));

    // データ読込ページの個別インポート
    const fileImportRankingOnly = document.getElementById('file-import-ranking-only');
    if (fileImportRankingOnly) fileImportRankingOnly.addEventListener('change', (e) => this._importPartialBackup(e, 'ranking'));
    const fileImportTournamentOnly = document.getElementById('file-import-tournament-only');
    if (fileImportTournamentOnly) fileImportTournamentOnly.addEventListener('change', (e) => this._importPartialBackup(e, 'tournament'));
    const fileImportEntryOnly = document.getElementById('file-import-entry-only');
    if (fileImportEntryOnly) fileImportEntryOnly.addEventListener('change', (e) => this._importPartialBackup(e, 'entry'));
    const fileImportDrawOnly = document.getElementById('file-import-draw-only');
    if (fileImportDrawOnly) fileImportDrawOnly.addEventListener('change', (e) => this._importPartialBackup(e, 'draw'));

    // バックアップ画面の個別インポート
    const fileBackupRanking = document.getElementById('file-backup-import-ranking');
    if (fileBackupRanking) fileBackupRanking.addEventListener('change', (e) => this._importPartialBackup(e, 'ranking'));
    const fileBackupTournament = document.getElementById('file-backup-import-tournament');
    if (fileBackupTournament) fileBackupTournament.addEventListener('change', (e) => this._importPartialBackup(e, 'tournament'));
    const fileBackupEntry = document.getElementById('file-backup-import-entry');
    if (fileBackupEntry) fileBackupEntry.addEventListener('change', (e) => this._importPartialBackup(e, 'entry'));
    const fileBackupDraw = document.getElementById('file-backup-import-draw');
    if (fileBackupDraw) fileBackupDraw.addEventListener('change', (e) => this._importPartialBackup(e, 'draw'));

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

  _exportBackupExcel() {
    if (typeof XLSX === 'undefined') { this.showMessage('SheetJS が読み込まれていません', 'error'); return; }
    const wb = XLSX.utils.book_new();
    const now = new Date().toLocaleString('ja-JP');

    // エントリーデータシート
    const entries = EntryStore.getAll();
    const entryData = [['エントリーデータ', '', '', '', 'エクスポート日時: ' + now]];
    entryData.push(['ID', '氏名', 'ふりがな', '所属', '種目コード', 'ポイント']);
    entries.forEach(e => {
      entryData.push([e.id, e.name, e.furigana || '', e.affiliation || '', e.eventCode || '', e.points || 0]);
    });
    const wsEntry = XLSX.utils.aoa_to_sheet(entryData);
    wsEntry['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsEntry, 'エントリー');

    // 大会一覧シート
    const tournaments = TournamentStore.getAll();
    const tournData = [['大会一覧', '', '', '', '', '', 'エクスポート日時: ' + now]];
    tournData.push(['ID', '大会名', '試合種目', '日程', '曜日', '会場', '予備日', '予備日会場']);
    tournaments.forEach(t => {
      tournData.push([t.id, t.name, t.events || '', t.date || '', t.dayOfWeek || '', t.venue || '', t.reserveDate || '', t.reserveVenue || '']);
    });
    const wsTour = XLSX.utils.aoa_to_sheet(tournData);
    wsTour['!cols'] = [{ wch: 5 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 6 }, { wch: 20 }, { wch: 8 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsTour, '大会一覧');

    // ドロー結果シート
    const drawCodes = Object.keys(this.drawResults);
    if (drawCodes.length > 0) {
      const drawData = [['ドロー結果', '', '', 'エクスポート日時: ' + now]];
      drawData.push(['種目', 'ドローサイズ', 'エントリー数', '確定']);
      drawCodes.forEach(code => {
        const r = this.drawResults[code];
        drawData.push([r.eventName || code, r.drawSize || '', r.entryCount || '', r.confirmed ? 'はい' : 'いいえ']);
      });
      const wsDraw = XLSX.utils.aoa_to_sheet(drawData);
      wsDraw['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, wsDraw, 'ドロー結果');
    }

    // バックアップ履歴管理（最大3回分）
    const backupKey = 'drawSystem_backupHistory';
    let history = [];
    try {
      const saved = localStorage.getItem(backupKey);
      if (saved) history = JSON.parse(saved);
    } catch (e) { /* ignore */ }
    history.unshift({ date: new Date().toISOString(), entries: entries.length, tournaments: tournaments.length, draws: drawCodes.length });
    if (history.length > 3) history = history.slice(0, 3);
    try { localStorage.setItem(backupKey, JSON.stringify(history)); } catch (e) { /* ignore */ }

    const filename = 'ドロー会議バックアップ_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(wb, filename);
    this.showMessage('Excelバックアップをエクスポートしました', 'success');
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

  _importPartialBackup(e, type) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const labels = { ranking: 'ランキングデータ', tournament: '大会一覧', entry: 'エントリーデータ', draw: 'ドロー結果' };
        let imported = false;

        if (type === 'ranking' && data['drawSystem_rankingBackup']) {
          localStorage.setItem('drawSystem_rankingBackup', JSON.stringify(data['drawSystem_rankingBackup']));
          RankingLoader.restoreFromBackup();
          imported = true;
        }
        if (type === 'tournament') {
          if (data['drawSystem_tournaments']) {
            localStorage.setItem('drawSystem_tournaments', JSON.stringify(data['drawSystem_tournaments']));
            TournamentStore.init();
            imported = true;
          }
          if (data['drawSystem_tournamentBackup']) {
            localStorage.setItem('drawSystem_tournamentBackup', JSON.stringify(data['drawSystem_tournamentBackup']));
            imported = true;
          }
        }
        if (type === 'entry' && data['drawSystem_entries']) {
          localStorage.setItem('drawSystem_entries', JSON.stringify(data['drawSystem_entries']));
          EntryStore.init();
          imported = true;
        }
        if (type === 'draw' && data['drawSystem_drawResults']) {
          const dr = data['drawSystem_drawResults'];
          if (dr.drawResults) this.drawResults = dr.drawResults;
          if (dr.confirmedEvents) this.confirmedEvents = dr.confirmedEvents;
          localStorage.setItem('drawSystem_drawResults', JSON.stringify(dr));
          imported = true;
        }

        if (imported) {
          this.refreshBackupTable();
          this.showMessage(labels[type] + ' をインポートしました', 'success');
        } else {
          this.showMessage('バックアップファイルに ' + labels[type] + ' が含まれていません', 'error');
        }
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
   * データ読込中オーバーレイの表示/非表示
   */
  _showLoadingOverlay(message) {
    this._isDataLoading = true;
    let overlay = document.getElementById('data-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'data-loading-overlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML =
        '<div class="loading-card">' +
        '<div class="loading-spinner"></div>' +
        '<div class="loading-text">' + (message || 'データ読込中...') + '</div>' +
        '<div class="loading-sub">しばらくお待ちください</div>' +
        '</div>';
      document.body.appendChild(overlay);
    } else {
      overlay.style.display = 'flex';
      const textEl = overlay.querySelector('.loading-text');
      if (textEl) textEl.textContent = message || 'データ読込中...';
    }
  },

  _hideLoadingOverlay() {
    this._isDataLoading = false;
    const overlay = document.getElementById('data-loading-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 300);
    }
  },

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
   * 大会日程を "3/29(日)" 形式に変換
   */
  _formatTournamentDate(dateStr, dayOfWeek) {
    if (!dateStr) return '';
    // "3月22日" → "3/22", "12/27～2/23" はそのまま
    let d = dateStr.replace(/(\d+)月(\d+)日/g, '$1/$2');
    if (dayOfWeek) {
      // "（日）" → "(日)"
      const dow = dayOfWeek.replace(/（/g, '(').replace(/）/g, ')');
      d += dow;
    }
    return d;
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
