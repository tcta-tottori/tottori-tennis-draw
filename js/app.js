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
    // initFuriganaScreen は廃止。_initFuriganaInDataScreen() で代替（initDataScreen内で呼出）
    this.initDrawScreen();
    this.initBracketScreen();
    this.initScheduleScreen();
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

    // 初期データ状況サマリーを更新
    this._refreshDataSummary();

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
      // ふりがなをランキングと同期
      this._syncFuriganaWithRanking();

      // バックグラウンドでスプレッドシートから最新データを取得
      this._silentRefreshFromSpreadsheets();
      return;
    }

    // バックアップがない場合はスプレッドシートから読み込み
    this._showLoadingOverlay('選手データを読込中...');
    try {
      this._updateLoadingProgress(5, 'ランキングデータを取得中...');
      await this._loadRankingFromGS(true);
      this._updateLoadingProgress(80, 'ふりがなデータを同期中...');
      this._syncFuriganaWithRanking();
      this._updateLoadingProgress(95, 'データ整理中...');
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
        // ランキング読込後、ふりがなを自動同期
        this._syncFuriganaWithRanking();
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
      this._refreshDataSummary();
    }
    if (screenId === 'screen-entry') this.refreshEntryTable();
    if (screenId === 'screen-data') this._renderFuriganaTable();
    if (screenId === 'screen-draw') this._refreshDrawEventSelect();
    if (screenId === 'screen-bracket') this._refreshBracketEventSelect();
    if (screenId === 'screen-schedule') this._refreshScheduleScreen();
    if (screenId === 'screen-backup') this.refreshBackupTable();
  },

  // ================================================================
  // データ読込画面
  // ================================================================

  initDataScreen() {
    // ローカルファイル読み込み
    const dropRanking = document.getElementById('drop-ranking');
    const fileRanking = document.getElementById('file-ranking');

    if (dropRanking) {
      this._setupDropZone(dropRanking, fileRanking, (file) => this._loadRankingFile(file));
    }

    // Google スプレッドシートから読み込み
    const btnGsRanking = document.getElementById('btn-gs-ranking');
    if (btnGsRanking) {
      btnGsRanking.addEventListener('click', () => this._loadRankingFromGS());
    }
    // Enterキーでも読込実行
    const gsRankingUrl = document.getElementById('gs-ranking-url');
    if (gsRankingUrl) {
      gsRankingUrl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._loadRankingFromGS();
      });
    }

    // localStorageに保存されたURL、またはデフォルトURLで初期値セット
    try {
      const savedRankingUrl = localStorage.getItem('drawSystem_gsRankingUrl');
      if (gsRankingUrl) gsRankingUrl.value = savedRankingUrl || AppConfig.DEFAULT_RANKING_SPREADSHEET || '';
    } catch (e) { /* ignore */ }

    // リンクボタンの更新
    this._updateGSLinkButtons();
    if (gsRankingUrl) gsRankingUrl.addEventListener('input', () => this._updateGSLinkButtons());

    // ふりがな管理の初期化（データ画面に統合）
    this._initFuriganaInDataScreen();

    // 大会一覧の初期化（データ読込画面に統合）
    this.initTournamentsScreen();
  },

  _updateGSLinkButtons() {
    const rankingUrl = (document.getElementById('gs-ranking-url') || {}).value || '';
    const rankingLink = document.getElementById('btn-gs-ranking-link');
    if (rankingLink) {
      if (rankingUrl.trim()) {
        rankingLink.style.display = '';
        rankingLink.href = rankingUrl.trim().startsWith('http') ? rankingUrl.trim() : 'https://docs.google.com/spreadsheets/d/' + rankingUrl.trim();
      } else {
        rankingLink.style.display = 'none';
      }
    }
  },

  async _loadRankingFromGS(useGlobalOverlay) {
    const urlInput = document.getElementById('gs-ranking-url');
    const statusEl = document.getElementById('gs-ranking-status');
    const btnEl = document.getElementById('btn-gs-ranking');
    const progressEl = document.getElementById('gs-ranking-progress');
    const progressBar = document.getElementById('gs-ranking-progress-bar');
    const progressText = document.getElementById('gs-ranking-progress-text');
    if (!urlInput || !urlInput.value.trim()) {
      if (!useGlobalOverlay) this.showMessage('スプレッドシートのURLまたはIDを入力してください', 'error');
      return;
    }

    try { localStorage.setItem('drawSystem_gsRankingUrl', urlInput.value.trim()); } catch (e) { }
    this._updateGSLinkButtons();

    // 個別ボタンからの呼び出し時はオーバーレイ表示
    if (!useGlobalOverlay) {
      this._showLoadingOverlay('ランキングデータを読込中...');
      this._updateLoadingProgress(10, 'ランキングデータを取得中...');
    }

    // セクション内プログレスバー表示
    if (progressEl) progressEl.style.display = '';
    if (progressBar) progressBar.style.width = '20%';
    if (progressText) progressText.textContent = 'ランキングデータ読込中...';
    if (statusEl) statusEl.style.display = 'none';
    if (btnEl) btnEl.disabled = true;

    try {
      if (progressBar) progressBar.style.width = '50%';
      if (useGlobalOverlay) this._updateLoadingProgress(20, 'ランキングデータを取得中...');
      else this._updateLoadingProgress(40, 'ランキングデータを取得中...');
      const status = await RankingLoader.loadRankingFromSpreadsheet(urlInput.value.trim());
      if (progressBar) progressBar.style.width = '100%';
      if (useGlobalOverlay) this._updateLoadingProgress(60, 'ランキングデータ読込完了');
      else this._updateLoadingProgress(90, 'ランキングデータ読込完了');
      this._updateRankingStatus(status);
      const now = new Date().toLocaleString('ja-JP');
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">読込済: ' + status.total + '名 (' + now + ')</span>';
      }
      // ランキング読込後、ふりがなを自動同期（個別呼び出し時のみ）
      if (!useGlobalOverlay) this._syncFuriganaWithRanking();
      if (!useGlobalOverlay) this.showMessage('ランキングデータを読み込みました (' + status.total + '名)', 'success');
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
      if (!useGlobalOverlay) this._hideLoadingOverlay();
    }
  },

  // _loadFuriganaFromGS は廃止。ふりがなはローカルJSON管理 + ランキング同期に移行

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
    this._showLoadingOverlay('ランキングデータを読込中...');
    this._updateLoadingProgress(10, 'ファイルを解析中...');
    try {
      this._updateLoadingProgress(30, 'ランキングデータを読込中...');
      const status = await RankingLoader.loadRankingFile(file);
      this._updateLoadingProgress(80, 'ふりがなデータを同期中...');
      this._syncFuriganaWithRanking();
      this._updateLoadingProgress(90, 'データ整理中...');
      this._updateRankingStatus(status);
      this.showMessage('ランキングデータを読み込みました', 'success');
    } catch (err) {
      console.error(err);
      this.showMessage('ランキングデータの読み込みに失敗しました: ' + err.message, 'error');
    } finally {
      this._hideLoadingOverlay();
    }
  },

  // _loadFuriganaFile は廃止。ふりがなはExcel取込（_importFuriganaExcel）またはJSON取込で管理

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
        btn.className = 'btn btn-sm ' + (!this._rankingFilter.showList && !this._rankingFilter.showAll && !this._rankingFilter.showAllMale && !this._rankingFilter.showAllFemale && !this._rankingFilter.showFuriganaDB && this._rankingFilter.eventCode === evt.code ? 'btn-primary' : 'btn-secondary');
        btn.textContent = evt.shortName + ' (' + count + ')';
        btn.addEventListener('click', () => {
          this._rankingFilter.eventCode = evt.code;
          this._rankingFilter.showList = false;
          this._rankingFilter.showAll = false;
          this._rankingFilter.showAllMale = false;
          this._rankingFilter.showAllFemale = false;
          this._rankingFilter.showFuriganaDB = false;
          this.refreshRankingTable();
        });
        tabsEl.appendChild(btn);
      }

      // セパレーター
      const sep1 = document.createElement('span');
      sep1.style.cssText = 'width:1px;height:20px;background:#d1d5db;margin:0 4px;';
      tabsEl.appendChild(sep1);

      // 男子全員/女子全員タブ
      const genderPrefix = currentCategory === 'singles' ? 's' : 'd';
      const maleEvents = categoryEvents.filter(e => e.code.startsWith('m'));
      const femaleEvents = categoryEvents.filter(e => e.code.startsWith('l'));
      const maleTotal = maleEvents.reduce((sum, e) => sum + (RankingLoader.rankings[e.code] || []).length, 0);
      const femaleTotal = femaleEvents.reduce((sum, e) => sum + (RankingLoader.rankings[e.code] || []).length, 0);

      if (maleTotal > 0) {
        const maleAllBtn = document.createElement('button');
        maleAllBtn.className = 'btn btn-sm ' + (this._rankingFilter.showAllMale ? 'btn-primary' : 'btn-secondary');
        maleAllBtn.textContent = '男子全員 (' + maleTotal + ')';
        maleAllBtn.style.cssText = 'border-color:#1e40af;';
        maleAllBtn.addEventListener('click', () => {
          this._rankingFilter.showAllMale = true;
          this._rankingFilter.showAllFemale = false;
          this._rankingFilter.showList = false;
          this._rankingFilter.showAll = false;
          this._rankingFilter.showFuriganaDB = false;
          this._rankingFilter.eventCode = '';
          this.refreshRankingTable();
        });
        tabsEl.appendChild(maleAllBtn);
      }

      if (femaleTotal > 0) {
        const femaleAllBtn = document.createElement('button');
        femaleAllBtn.className = 'btn btn-sm ' + (this._rankingFilter.showAllFemale ? 'btn-primary' : 'btn-secondary');
        femaleAllBtn.textContent = '女子全員 (' + femaleTotal + ')';
        femaleAllBtn.style.cssText = 'border-color:#be185d;';
        femaleAllBtn.addEventListener('click', () => {
          this._rankingFilter.showAllFemale = true;
          this._rankingFilter.showAllMale = false;
          this._rankingFilter.showList = false;
          this._rankingFilter.showAll = false;
          this._rankingFilter.showFuriganaDB = false;
          this._rankingFilter.eventCode = '';
          this.refreshRankingTable();
        });
        tabsEl.appendChild(femaleAllBtn);
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
          this._rankingFilter.showAll = false;
          this._rankingFilter.showAllMale = false;
          this._rankingFilter.showAllFemale = false;
          this._rankingFilter.showFuriganaDB = false;
          this._rankingFilter.eventCode = '';
          this.refreshRankingTable();
        });
        tabsEl.appendChild(listBtn);
      }

      // ふりがなDB全選手タブ（ミックスD/団体戦対応）
      const furiganaCount = (this._furiganaData || []).length;
      if (furiganaCount > 0) {
        const sep2 = document.createElement('span');
        sep2.style.cssText = 'width:1px;height:20px;background:#d1d5db;margin:0 4px;';
        tabsEl.appendChild(sep2);

        const dbBtn = document.createElement('button');
        dbBtn.className = 'btn btn-sm ' + (this._rankingFilter.showFuriganaDB ? 'btn-primary' : 'btn-secondary');
        dbBtn.textContent = '全選手DB (' + furiganaCount + ')';
        dbBtn.style.cssText = 'border-color:#059669;';
        dbBtn.addEventListener('click', () => {
          this._rankingFilter.showFuriganaDB = true;
          this._rankingFilter.showList = false;
          this._rankingFilter.showAll = false;
          this._rankingFilter.showAllMale = false;
          this._rankingFilter.showAllFemale = false;
          this._rankingFilter.eventCode = '';
          this.refreshRankingTable();
        });
        tabsEl.appendChild(dbBtn);
      }

      // デフォルトで最初の種目を自動選択（eventCode未選択なら）
      if (!this._rankingFilter.eventCode && !this._rankingFilter.showList && !this._rankingFilter.showAll && !this._rankingFilter.showAllMale && !this._rankingFilter.showAllFemale && !this._rankingFilter.showFuriganaDB) {
        const firstEvt = categoryEvents.find(e => (RankingLoader.rankings[e.code] || []).length > 0);
        if (firstEvt) {
          this._rankingFilter.eventCode = firstEvt.code;
          this.refreshRankingTable();
          return;
        }
      }
    }

    // 並べ替えコントロールの表示/更新
    this._updateRankingSortControls();

    this._renderRankingRows();
  },

  /**
   * 並べ替えコントロール表示/更新
   */
  _updateRankingSortControls() {
    const stickyFilter = document.querySelector('.ranking-sticky-filter');
    if (!stickyFilter) return;

    let sortBar = document.getElementById('ranking-sort-bar');
    const showSort = this._rankingFilter.showAllMale || this._rankingFilter.showAllFemale || this._rankingFilter.showFuriganaDB;

    if (!showSort) {
      if (sortBar) sortBar.style.display = 'none';
      return;
    }

    if (!sortBar) {
      sortBar = document.createElement('div');
      sortBar.id = 'ranking-sort-bar';
      sortBar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0;';
      sortBar.innerHTML =
        '<span style="font-size:12px;color:#666;white-space:nowrap;">並べ替え:</span>' +
        '<select id="ranking-sort-select" class="form-input" style="width:auto;min-width:140px;padding:4px 8px;font-size:12px;">' +
        '<option value="points-desc">ポイント順（高い順）</option>' +
        '<option value="points-asc">ポイント順（低い順）</option>' +
        '<option value="furigana-asc">ふりがな（あいうえお順）</option>' +
        '<option value="name-asc">氏名（あいうえお順）</option>' +
        '<option value="affiliation">所属順</option>' +
        '</select>';
      stickyFilter.appendChild(sortBar);

      sortBar.querySelector('#ranking-sort-select').addEventListener('change', (e) => {
        this._rankingFilter.sortKey = e.target.value;
        this._renderRankingRows();
      });
    }

    sortBar.style.display = 'flex';
    const sel = sortBar.querySelector('#ranking-sort-select');
    if (sel) sel.value = this._rankingFilter.sortKey || 'points-desc';
  },

  _renderRankingRows() {
    const tbody = document.getElementById('ranking-table-body');
    const countEl = document.getElementById('ranking-count');
    const emptyMsg = document.getElementById('ranking-empty-msg');
    const table = document.getElementById('ranking-table');
    if (!tbody) return;

    let players = [];
    let isListView = this._rankingFilter.showList;
    let isFuriganaDBView = this._rankingFilter.showFuriganaDB;
    let isAllMaleView = this._rankingFilter.showAllMale;
    let isAllFemaleView = this._rankingFilter.showAllFemale;
    const currentCategory = this._rankingFilter.category;
    const categoryEventCodes = new Set(AppConfig.EVENTS.filter(e => e.category === currentCategory).map(e => e.code));

    if (isFuriganaDBView) {
      // ふりがなDB全選手（ミックスD/団体戦用）
      const seen = new Set();
      players = (this._furiganaData || []).filter(d => {
        if (seen.has(d.name)) return false;
        seen.add(d.name);
        return true;
      }).map(d => ({
        rank: d.rankingPosition || '-',
        name: d.name,
        furigana: d.furigana || '',
        affiliation: d.affiliation || '',
        points: d.rankingPoints || 0,
        eventCode: (d.eventCodes && d.eventCodes.length > 0) ? d.eventCodes[0] : '',
      }));
    } else if (isAllMaleView || isAllFemaleView) {
      // 男子全員/女子全員（重複排除・最高ポイント優先）
      const prefix = isAllMaleView ? 'm' : 'l';
      const genderEvents = AppConfig.EVENTS.filter(e => e.category === currentCategory && e.code.startsWith(prefix));
      const nameMap = new Map();
      for (const evt of genderEvents) {
        for (const p of (RankingLoader.rankings[evt.code] || [])) {
          const existing = nameMap.get(p.name);
          if (!existing || (p.points || 0) > (existing.points || 0)) {
            nameMap.set(p.name, { ...p, eventCode: evt.code });
          }
        }
      }
      players = Array.from(nameMap.values());
    } else if (isListView) {
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

    // 並べ替え（男子全員/女子全員/ふりがなDB時）
    if (isAllMaleView || isAllFemaleView || isFuriganaDBView) {
      const sortKey = this._rankingFilter.sortKey || 'points-desc';
      switch (sortKey) {
        case 'points-desc':
          players.sort((a, b) => (b.points || 0) - (a.points || 0));
          break;
        case 'points-asc':
          players.sort((a, b) => (a.points || 0) - (b.points || 0));
          break;
        case 'furigana-asc':
          players.sort((a, b) => {
            const fa = a.furigana || RankingLoader.furiganaMap[a.name] || '';
            const fb = b.furigana || RankingLoader.furiganaMap[b.name] || '';
            return fa.localeCompare(fb, 'ja');
          });
          break;
        case 'name-asc':
          players.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
          break;
        case 'affiliation':
          players.sort((a, b) => (a.affiliation || '').localeCompare(b.affiliation || '', 'ja'));
          break;
      }
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

      const furiganaInlineHtml = furigana ? '<span class="furigana-inline" style="display:block;font-size:8px;color:#374151;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._esc(furigana) + '</span>' : '';
      tr.innerHTML =
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
      // ふりがなDBにも自動登録
      if (player.name && furigana) {
        const existingFuri = this._furiganaData.find(d => d.name === player.name);
        if (existingFuri) {
          if (!existingFuri.eventCodes) existingFuri.eventCodes = existingFuri.eventCode ? [existingFuri.eventCode] : [];
          delete existingFuri.eventCode;
          if (player.eventCode && !existingFuri.eventCodes.includes(player.eventCode)) existingFuri.eventCodes.push(player.eventCode);
          this._saveFuriganaData();
        } else {
          this._furiganaData.push({ id: this._furiganaNextId++, name: player.name, furigana: furigana, source: 'auto', affiliation: player.affiliation || '', eventCodes: player.eventCode ? [player.eventCode] : [], rankingPoints: player.points || 0, rankingPosition: player.rank || 0, lastUpdated: new Date().toISOString(), furiganaEdited: false });
          this._saveFuriganaData();
        }
      }

      // 黄色ハイライト後に上下から潰れて消える
      tr.style.transition = 'background-color 0.3s';
      tr.style.backgroundColor = '#ffe066';
      btn.textContent = '登録済';
      btn.disabled = true;
      btn.style.opacity = '0.6';

      if (this._hideEnteredPlayers) {
        // 非表示モード: 上下の行がスムーズに近づいて消える
        setTimeout(() => {
          tr.classList.add('row-fade-out');
          setTimeout(() => {
            tr.classList.add('row-entered');
            tr.classList.remove('row-fade-out');
            // 行の色を再計算
            this._resetRowColors();
          }, 500);
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
      // ふりがなDBにも自動登録
      if (player.name && furigana) {
        const existingFuri = this._furiganaData.find(d => d.name === player.name);
        if (existingFuri) {
          if (!existingFuri.eventCodes) existingFuri.eventCodes = existingFuri.eventCode ? [existingFuri.eventCode] : [];
          delete existingFuri.eventCode;
          if (player.eventCode && !existingFuri.eventCodes.includes(player.eventCode)) existingFuri.eventCodes.push(player.eventCode);
          this._saveFuriganaData();
        } else {
          this._furiganaData.push({ id: this._furiganaNextId++, name: player.name, furigana: furigana, source: 'auto', affiliation: player.affiliation || '', eventCodes: player.eventCode ? [player.eventCode] : [], rankingPoints: player.points || 0, rankingPosition: player.rank || 0, lastUpdated: new Date().toISOString(), furiganaEdited: false });
          this._saveFuriganaData();
        }
      }
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
    const btnConfirm = document.getElementById('btn-tournament-confirm');
    const btnChange = document.getElementById('btn-tournament-change');
    const selectMode = document.getElementById('tournament-select-mode');
    const confirmedMode = document.getElementById('tournament-confirmed-mode');
    const confirmedName = document.getElementById('tournament-confirmed-name');

    // 大会プルダウンを構築
    this._refreshTournamentSelect();

    // 大会選択時に情報を自動セット＆確定ボタン有効化
    if (tournamentSelect) {
      tournamentSelect.addEventListener('change', () => {
        const id = parseInt(tournamentSelect.value);
        if (btnConfirm) btnConfirm.disabled = !id;
        if (!id) {
          this._selectedTournamentEvents = null;
          this._updateCategoryToggle();
          return;
        }
        const t = TournamentStore.getById(id);
        if (!t) return;
        AppConfig.TOURNAMENT_NAME = t.name;
        if (dateInput) dateInput.value = t.date + (t.dayOfWeek ? ' ' + t.dayOfWeek : '');
        if (venueSelect) {
          const venueMatch = (AppConfig.VENUE_OPTIONS || []).find(v => t.venue && v.includes(t.venue));
          if (venueMatch) venueSelect.value = venueMatch;
        }
        // 試合種目から利用可能な種目を判定
        this._selectedTournamentEvents = t.events || '';
        this._updateCategoryToggle();
        this._updateConfig();
      });
    }

    // 確定ボタン
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        const id = parseInt(tournamentSelect.value);
        if (!id) return;
        const t = TournamentStore.getById(id);
        if (!t) return;
        this._confirmedTournamentId = id;
        // 表示を切替
        if (selectMode) selectMode.style.display = 'none';
        if (confirmedMode) confirmedMode.style.display = '';
        const dateStr = t.date ? (t.date + (t.dayOfWeek || '')) : '';
        if (confirmedName) confirmedName.textContent = t.name + (dateStr ? '　' + dateStr : '');
        this.showMessage(t.name + ' でエントリーを開始します', 'success');
      });
    }

    // 大会変更ボタン
    if (btnChange) {
      btnChange.addEventListener('click', () => {
        this._confirmedTournamentId = null;
        if (selectMode) selectMode.style.display = '';
        if (confirmedMode) confirmedMode.style.display = 'none';
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

    // 初期値セット
    if (dateInput) dateInput.value = AppConfig.TOURNAMENT_DATE || '';

    if (dateInput) dateInput.addEventListener('change', () => this._updateConfig());
    if (venueSelect) venueSelect.addEventListener('change', () => this._updateConfig());
  },

  _updateConfig() {
    const dateInput = document.getElementById('tournament-date-input');
    const venueSelect = document.getElementById('tournament-venue-input');
    if (dateInput) AppConfig.TOURNAMENT_DATE = dateInput.value.trim();
    if (venueSelect) AppConfig.TOURNAMENT_VENUE = venueSelect.value;
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
      let label = t.name;
      if (t.events) label += '（' + t.events + '）';
      opt.textContent = label;
      select.appendChild(opt);
    });
    if (prevValue) select.value = prevValue;
  },

  /**
   * 大会の試合種目に基づいてカテゴリ切替を制御
   */
  _updateCategoryToggle() {
    const evts = this._selectedTournamentEvents || '';
    const toggleEl = document.getElementById('ranking-category-toggle');
    if (!toggleEl) return;
    const singlesBtn = toggleEl.querySelector('[data-category="singles"]');
    const doublesBtn = toggleEl.querySelector('[data-category="doubles"]');
    if (!singlesBtn || !doublesBtn) return;

    const hasSingles = !evts || /シングルス/i.test(evts);
    const hasDoubles = !evts || /ダブルス/i.test(evts);

    singlesBtn.disabled = !hasSingles;
    doublesBtn.disabled = !hasDoubles;
    singlesBtn.style.opacity = hasSingles ? '1' : '0.4';
    doublesBtn.style.opacity = hasDoubles ? '1' : '0.4';

    // 現在のカテゴリが無効になった場合は自動切替
    if (!hasSingles && this._rankingFilter.category === 'singles') {
      doublesBtn.click();
    } else if (!hasDoubles && this._rankingFilter.category === 'doubles') {
      singlesBtn.click();
    }
  },

  /**
   * エントリーページ上部のデータ状況サマリー
   */
  _refreshDataSummary() {
    const container = document.getElementById('entry-data-summary');
    const chips = document.getElementById('entry-data-summary-chips');
    if (!container || !chips) return;

    chips.innerHTML = '';
    let hasAny = false;

    // エントリーデータ
    const allEntries = EntryStore.getAll();
    const entryByEvent = {};
    allEntries.forEach(e => {
      if (!entryByEvent[e.eventCode]) entryByEvent[e.eventCode] = 0;
      entryByEvent[e.eventCode]++;
    });

    // 種目ソート: 男子→女子、性別内で年齢順
    const sortedCodes = this._getSortedEventCodes(Object.keys(entryByEvent));

    for (const code of sortedCodes) {
      hasAny = true;
      const evt = AppConfig.EVENTS.find(e => e.code === code);
      const evtName = evt ? evt.shortName || evt.name : code;
      const count = entryByEvent[code];

      const chip = document.createElement('span');
      chip.className = 'data-summary-chip chip-entry';
      chip.innerHTML = this._esc(evtName) + ' <small>' + count + '名</small>';

      const clearBtn = document.createElement('button');
      clearBtn.className = 'chip-clear';
      clearBtn.textContent = '\u00d7';
      clearBtn.title = evtName + ' のエントリーをクリア';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(evtName + ' のエントリー(' + count + '名)をクリアしますか？')) {
          const toRemove = allEntries.filter(en => en.eventCode === code);
          toRemove.forEach(en => EntryStore.remove(en.id));
          this.refreshEntryTable();
          this._refreshDataSummary();
          this.showMessage(evtName + ' のエントリーをクリアしました', 'info');
        }
      });
      chip.appendChild(clearBtn);
      chips.appendChild(chip);
    }

    // 抽選・確定データ
    for (const code of Object.keys(this.drawResults || {})) {
      const result = this.drawResults[code];
      if (!result) continue;
      hasAny = true;
      const evt = AppConfig.EVENTS.find(e => e.code === code);
      const evtName = evt ? evt.shortName || evt.name : code;
      const isConfirmed = this.confirmedEvents && this.confirmedEvents[code];

      const chip = document.createElement('span');
      chip.className = 'data-summary-chip ' + (isConfirmed ? 'chip-confirmed' : 'chip-draw');
      chip.innerHTML = (isConfirmed ? '確定' : '抽選') + ': ' + this._esc(evtName);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'chip-clear';
      clearBtn.textContent = '\u00d7';
      clearBtn.title = evtName + ' のドローをクリア';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(evtName + ' のドローをクリアしますか？')) {
          delete this.drawResults[code];
          if (this.confirmedEvents) delete this.confirmedEvents[code];
          this._saveDrawResults();
          this._refreshDataSummary();
          this.showMessage(evtName + ' のドローをクリアしました', 'info');
        }
      });
      chip.appendChild(clearBtn);
      chips.appendChild(chip);
    }

    container.style.display = hasAny ? '' : 'none';
  },

  /**
   * 種目コードを男子→女子、性別内で年齢順にソート
   */
  _getSortedEventCodes(codes) {
    const order = AppConfig.EVENTS.map(e => e.code);
    // 男子→女子の順で再整列
    const genderOrder = (code) => {
      if (code.startsWith('m')) return 0;
      if (code.startsWith('l')) return 1;
      return 2;
    };
    return [...codes].sort((a, b) => {
      const ga = genderOrder(a);
      const gb = genderOrder(b);
      if (ga !== gb) return ga - gb;
      return order.indexOf(a) - order.indexOf(b);
    });
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

    // モーダル内の種目セレクト（変更時に団体戦フォームを切替）
    const entryEventSelect = document.getElementById('entry-event');
    if (entryEventSelect) {
      entryEventSelect.addEventListener('change', () => {
        this._updateTeamFormVisibility(entryEventSelect.value, this._editingEntryId);
      });
    }

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

    // データ全クリア
    const btnAllClear = document.getElementById('btn-all-data-clear');
    if (btnAllClear) {
      btnAllClear.addEventListener('click', () => {
        if (confirm('全てのデータ（エントリー、ドロー結果、時間割）をクリアしますか？この操作は元に戻せません。')) {
          // localStorage をすべてクリア
          localStorage.removeItem('drawSystem_entries');
          localStorage.removeItem('drawSystem_tournaments');
          localStorage.removeItem('drawSystem_rankingBackup');
          localStorage.removeItem('drawSystem_tournamentBackup');
          localStorage.removeItem('drawSystem_drawResults');
          localStorage.removeItem('drawSystem_schedule');
          // メモリ上のデータをクリア
          EntryStore.entries = [];
          EntryStore.nextId = 1;
          if (typeof TournamentStore !== 'undefined') {
            TournamentStore.tournaments = [];
            TournamentStore.nextId = 1;
          }
          RankingLoader.rankings = {};
          RankingLoader.allPlayers = [];
          RankingLoader.furiganaMap = {};
          RankingLoader.listMembers = [];
          this.drawResults = {};
          this.confirmedEvents = {};
          this._scheduleSlots = null;
          // 画面を更新
          this.refreshEntryTable();
          this.showMessage('全てのデータをクリアしました', 'info');
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

    // 団体戦フォーム切替
    const evtSelect = document.getElementById('entry-event');
    const selectedEvt = evtSelect ? evtSelect.value : '';
    this._updateTeamFormVisibility(selectedEvt, entryId);

    modal.style.display = '';
  },

  /**
   * 団体戦用フォームフィールドの表示切替
   */
  _updateTeamFormVisibility(eventCode, entryId) {
    const isTeam = eventCode && EntryStore.isTeamEvent(eventCode);
    const nameLabel = document.querySelector('label[for="entry-name"]');
    const clubGroup = document.getElementById('entry-club')?.closest('.form-group');
    const pointGroup = document.getElementById('entry-point')?.closest('.form-group');
    const furiganaGroup = document.getElementById('entry-furigana')?.closest('.form-group');

    // 団体戦メンバー入力エリア（動的生成）
    let teamMembersGroup = document.getElementById('entry-team-members-group');
    if (isTeam && !teamMembersGroup) {
      teamMembersGroup = document.createElement('div');
      teamMembersGroup.id = 'entry-team-members-group';
      teamMembersGroup.className = 'form-group';
      teamMembersGroup.innerHTML =
        '<label for="entry-team-members">メンバー（1行1名）</label>' +
        '<textarea id="entry-team-members" rows="5" class="form-control" placeholder="山田 太郎&#10;佐藤 花子&#10;..."></textarea>';
      const form = document.getElementById('entry-name')?.closest('form') || document.getElementById('entry-name')?.parentElement?.parentElement;
      if (form) form.appendChild(teamMembersGroup);
    }

    if (isTeam) {
      if (nameLabel) nameLabel.textContent = 'チーム名';
      if (clubGroup) clubGroup.style.display = 'none';
      if (pointGroup) pointGroup.style.display = 'none';
      if (furiganaGroup) furiganaGroup.style.display = 'none';
      if (teamMembersGroup) {
        teamMembersGroup.style.display = '';
        // 既存エントリーのメンバーを復元
        const membersTextarea = document.getElementById('entry-team-members');
        if (membersTextarea && entryId) {
          const entry = EntryStore.getById(entryId);
          if (entry && entry.teamMembers) {
            membersTextarea.value = entry.teamMembers.map(m => typeof m === 'string' ? m : m.name).join('\n');
          } else {
            membersTextarea.value = '';
          }
        } else if (membersTextarea) {
          membersTextarea.value = '';
        }
      }
    } else {
      if (nameLabel) nameLabel.textContent = '氏名';
      if (clubGroup) clubGroup.style.display = '';
      if (pointGroup) pointGroup.style.display = '';
      if (furiganaGroup) furiganaGroup.style.display = '';
      if (teamMembersGroup) teamMembersGroup.style.display = 'none';
    }
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

    // 団体戦: メンバー情報を保存
    if (EntryStore.isTeamEvent(eventCode)) {
      const membersTextarea = document.getElementById('entry-team-members');
      if (membersTextarea) {
        const memberLines = membersTextarea.value.split('\n').map(l => l.trim()).filter(l => l);
        data.teamMembers = memberLines.map(name => ({ name }));
      }
      data.affiliation = name; // チーム名を所属としても使用
    }

    if (this._editingEntryId) {
      EntryStore.update(this._editingEntryId, data);
      this.showMessage('エントリーを更新しました', 'success');
    } else {
      EntryStore.add(data);
      this.showMessage('エントリーを追加しました', 'success');
    }

    // リストにない人はふりがなマップに自動追加
    RankingLoader.addToFuriganaMap(name, furigana);

    // ふりがなDBにも自動登録（未登録の場合は新規追加、既存の場合はeventCodes更新）
    if (name && furigana) {
      const existingFuri = this._furiganaData.find(d => d.name === name);
      if (existingFuri) {
        if (!existingFuri.eventCodes) existingFuri.eventCodes = existingFuri.eventCode ? [existingFuri.eventCode] : [];
        delete existingFuri.eventCode;
        const evtCode = (data && data.eventCode) || '';
        if (evtCode && !existingFuri.eventCodes.includes(evtCode)) existingFuri.eventCodes.push(evtCode);
        this._saveFuriganaData();
      } else {
        const evtCode = (data && data.eventCode) || '';
        this._furiganaData.push({ id: this._furiganaNextId++, name: name, furigana: furigana, source: 'manual', affiliation: '', eventCodes: evtCode ? [evtCode] : [], rankingPoints: 0, rankingPosition: 0, lastUpdated: new Date().toISOString(), furiganaEdited: false });
        this._saveFuriganaData();
      }
    }

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

    // データ状況サマリーを更新
    this._refreshDataSummary();

    // エントリー済み種目を取得
    const allEntries = EntryStore.getAll();
    const entryEventCodes = this._getSortedEventCodes([...new Set(allEntries.map(e => e.eventCode))]);

    // 種目フィルターを動的に構築（エントリーがある種目のみ、ソート済み）
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
      // 大会の試合種目でフィルタ＆ソート
      const tournEvts = this._selectedTournamentEvents || '';
      const hasSingles = !tournEvts || /シングルス|単/i.test(tournEvts);
      const hasDoubles = !tournEvts || /(?<!ミックス)ダブルス|(?<!ミックス)複/i.test(tournEvts);
      const hasMixed = !tournEvts || /ミックス/i.test(tournEvts);
      const hasTeam = !tournEvts || /団体|対抗/i.test(tournEvts);
      const sortedEvents = [...AppConfig.EVENTS].sort((a, b) => {
        const ga = a.code.startsWith('m') || a.code === 'xd' || a.code === 'tm' ? 0 : 1;
        const gb = b.code.startsWith('m') || b.code === 'xd' || b.code === 'tm' ? 0 : 1;
        if (ga !== gb) return ga - gb;
        return AppConfig.EVENTS.indexOf(a) - AppConfig.EVENTS.indexOf(b);
      });
      for (const evt of sortedEvents) {
        const isSingles = evt.category === 'singles';
        const isDoubles = evt.category === 'doubles';
        const isMixed = evt.category === 'mixed_doubles';
        const isTeam = evt.category === 'team';
        if (tournEvts && !hasSingles && isSingles) continue;
        if (tournEvts && !hasDoubles && isDoubles) continue;
        if (tournEvts && !hasMixed && isMixed) continue;
        if (tournEvts && !hasTeam && isTeam) continue;
        const opt = document.createElement('option');
        opt.value = evt.code;
        opt.textContent = evt.name;
        entryEventSelect.appendChild(opt);
      }
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
    let isTeam = false;
    try {
      isDoubles = !!(targetCode && EntryStore.isDoublesEvent(targetCode));
      isTeam = !!(targetCode && EntryStore.isTeamEvent(targetCode));
    } catch (e) {
      console.warn('isDoublesEvent/isTeamEvent error:', e);
    }

    // テーブルヘッダーを切り替え
    const thead = document.getElementById('entry-table-head');
    const entryTable = document.getElementById('entry-table');
    // 男女判定（種目コードで色分け）
    const isMaleEvent = targetCode && targetCode.startsWith('m');
    const isFemaleEvent = targetCode && targetCode.startsWith('l');
    const isMixedEvent = targetCode === 'xd';
    if (thead) {
      if (isTeam) {
        thead.innerHTML = '<tr><th>チーム名</th><th>メンバー</th><th>操作</th></tr>';
        if (entryTable) entryTable.classList.remove('entry-doubles');
      } else if (isDoubles) {
        thead.innerHTML = '<tr><th>氏名</th><th>所属</th><th>個人pt</th><th>合計pt</th><th>操作</th></tr>';
        if (entryTable) entryTable.classList.add('entry-doubles');
      } else {
        thead.innerHTML = '<tr><th>氏名</th><th>所属</th><th>ポイント</th><th>操作</th></tr>';
        if (entryTable) entryTable.classList.remove('entry-doubles');
      }
      // 男女別ヘッダー色
      const headerTr = thead.querySelector('tr');
      if (isMixedEvent) {
        headerTr.style.background = '#f3e5f5';
      } else if (isMaleEvent) {
        headerTr.style.background = '#e3f2fd';
      } else if (isFemaleEvent) {
        headerTr.style.background = '#fce4ec';
      } else if (isTeam) {
        headerTr.style.background = '#e8f5e9';
      }
    }

    // 団体戦の場合
    if (isTeam && targetCode) {
      try {
        this._renderTeamEntryTable(tbody, targetCode, totalCount);
      } catch (e) {
        console.error('団体戦エントリー表示エラー:', e);
        isTeam = false;
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
    if (!isDoubles && !isTeam) {
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
    const dblIsMixed = eventCode === 'xd';
    pairs.forEach((pair, pairIdx) => {
      const isIncomplete = pair.incomplete;
      const evenColor = dblIsMixed ? '#f3e5f5' : (dblIsFemale ? '#fff5f7' : '#f0f7ff');
      const bgColor = isIncomplete ? '#ffebee' : (pairIdx % 2 === 0 ? evenColor : '#ffffff');
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

        // 合計ptは最初の行にのみ表示
        const combinedPtsLabel = entryIdx === 0
          ? '<span style="font-weight:bold;color:#1a56db;">' + pair.points + '</span>'
          : '';

        const dblFuriganaHtml = entry.furigana ? '<span class="furigana-fit">' + this._esc(entry.furigana) + '</span>' : '';
        tr.innerHTML =
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
        separatorTr.innerHTML = '<td colspan="5" style="padding:0;height:2px;background:#cbd5e1;"></td>';
        tbody.appendChild(separatorTr);
      }
    });
  },

  /**
   * 団体戦エントリーテーブル表示
   */
  _renderTeamEntryTable(tbody, eventCode, totalCountEl) {
    const entries = EntryStore.getByEvent(eventCode);
    tbody.innerHTML = '';
    if (totalCountEl) totalCountEl.textContent = entries.length + 'チーム';

    // シード・ドロー情報
    const seedInfoEl = document.getElementById('entry-seed-info');
    if (seedInfoEl) {
      seedInfoEl.innerHTML = '';
      if (entries.length > 3) {
        const drawSize = DrawEngine.getDrawSize(entries.length);
        let html = '<div class="draw-info-grid">' +
          '<div class="draw-info-item"><span class="draw-info-label">チーム数</span><span class="draw-info-value">' + entries.length + '</span></div>' +
          '<div class="draw-info-item"><span class="draw-info-label">ドローサイズ</span><span class="draw-info-value">' + drawSize + '</span></div>' +
          '<div class="draw-info-item"><span class="draw-info-label">BYE</span><span class="draw-info-value">' + (drawSize - entries.length) + '</span></div>' +
          '<div class="draw-info-item"><span class="draw-info-label">シード</span><span class="draw-info-value">なし</span></div>' +
          '</div>';
        seedInfoEl.innerHTML = html;
      }
    }

    entries.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      if (idx < 30) {
        tr.classList.add('row-enter');
        tr.style.animationDelay = (idx * 20) + 'ms';
      }
      tr.style.backgroundColor = idx % 2 === 0 ? '#e8f5e9' : '#ffffff';

      // メンバー表示
      const members = entry.teamMembers || [];
      const memberText = members.length > 0
        ? members.map(m => this._esc(m.name || m)).join(', ')
        : '<span style="color:#999;">未登録</span>';

      tr.innerHTML =
        '<td><strong>' + this._esc(entry.name) + '</strong></td>' +
        '<td style="font-size:12px;">' + memberText + '</td>' +
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
          this.showMessage('チームを削除しました', 'info');
        }
      });
      actionCell.appendChild(btnDel);

      tbody.appendChild(tr);
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

    const btnBackupSave = document.getElementById('btn-tournament-backup-save');
    if (btnBackupSave) btnBackupSave.addEventListener('click', () => {
      const data = localStorage.getItem('drawSystem_tournaments');
      if (!data) { this.showMessage('大会データがありません', 'error'); return; }
      this._downloadJSON(data, 'tournament_backup.json');
      this.showMessage('大会一覧をバックアップファイルに保存しました', 'success');
    });

    const fileBackupRestore = document.getElementById('file-tournament-backup-restore');
    if (fileBackupRestore) fileBackupRestore.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const tournaments = data.tournaments || data;
          if (!Array.isArray(tournaments)) {
            this.showMessage('バックアップファイルの形式が正しくありません', 'error');
            return;
          }
          if (!confirm('現在の大会データを上書きして復元しますか？（' + tournaments.length + '件）')) return;
          localStorage.setItem('drawSystem_tournaments', JSON.stringify({ tournaments: tournaments }));
          TournamentStore.init();
          this.refreshTournamentsTable();
          this.showMessage('バックアップから ' + tournaments.length + '件の大会を復元しました', 'success');
        } catch (err) {
          this.showMessage('バックアップの読込に失敗しました: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
      fileBackupRestore.value = '';
    });

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

    // ゲームルール選択肢を構築（抽選画面）
    this._initDrawFormatSelect();

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

    // 所属重複トグルボタン
    const collisionToggle = document.getElementById('collision-toggle');
    if (collisionToggle) {
      collisionToggle.querySelectorAll('.collision-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          collisionToggle.querySelectorAll('.collision-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const hiddenInput = document.querySelector('input[name="affiliation-collision"]');
          if (hiddenInput) hiddenInput.value = btn.dataset.value;
        });
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
      const isDoubles = (evt.category === 'doubles' || evt.category === 'mixed_doubles');
      const isTeam = evt.category === 'team';
      let count, label;
      if (isDoubles) {
        const pairs = EntryStore.getDoublesPairs(evt.code).filter(p => !p.incomplete);
        count = pairs.length;
        label = evt.name + ' (' + count + 'ペア)';
      } else if (isTeam) {
        const entries = EntryStore.getByEvent(evt.code);
        count = entries.length;
        label = evt.name + ' (' + count + 'チーム)';
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
    const isTeam = EntryStore.isTeamEvent(eventCode);

    // ダブルス/ミックスの場合はペア単位で処理、団体戦はチーム単位
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
    } else if (isTeam) {
      drawEntries = EntryStore.getByEvent(eventCode).map(e => ({
        name: e.name,
        furigana: e.furigana || '',
        affiliation: e.affiliation || '',
        points: 0,
        seed: 0,
      }));
    } else {
      drawEntries = EntryStore.getByEvent(eventCode);
    }

    if (drawEntries.length <= 3) {
      if (lotterySection) lotterySection.style.display = 'none';
      const label = isDoubles ? '完全なペアが4組以上必要です' : (isTeam ? 'チームが4つ以上必要です' : 'エントリーが4名以上必要です');
      this.showMessage(label, 'error');
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
      const entryLabel = isDoubles ? 'ペア数' : (isTeam ? 'チーム数' : 'エントリー');
      const entryUnit = isDoubles ? '' : (isTeam ? '' : '名');
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
        try { drawIsDoubles = drawEventCode && EntryStore.isDoublesEvent(drawEventCode); } catch (e) { }

        this._unplacedPlayers.forEach((p, idx) => {
          const chip = document.createElement('button');
          chip.className = 'unplaced-chip' + (this._selectedPlayer === idx ? ' selected' : '');
          let chipLabel = p.name;
          let chipAff = '';
          if (drawIsDoubles && chipLabel && chipLabel.includes(' / ')) {
            chipLabel = chipLabel.split(' / ').map(n => n.split(/[\s\u3000]+/)[0]).join('/');
            // ダブルスは2人の所属を表示
            const affs = (p.affiliation || '').split(' / ');
            chipAff = '(' + affs.map(a => (a || '').substring(0, 3)).join('/') + ')';
          } else {
            chipAff = p.affiliation ? '(' + p.affiliation + ')' : '';
          }
          chip.textContent = chipLabel + (chipAff ? ' ' + chipAff : '');
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
    const isDoubles = evt ? (evt.category === 'doubles' || evt.category === 'mixed_doubles') : false;
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
    const collisionInput = document.querySelector('input[name="affiliation-collision"]');
    const shouldAvoid = !collisionInput || collisionInput.value === 'avoid';
    if (!shouldAvoid) return false;

    // 1回戦の対戦相手インデックスを算出（偶数→+1、奇数→-1）
    const opponentIdx = (drawIndex % 2 === 0) ? drawIndex + 1 : drawIndex - 1;
    if (opponentIdx < 0 || opponentIdx >= this._manualDraw.length) return false;

    const opponent = this._manualDraw[opponentIdx];
    if (!opponent || opponent.isEmpty || opponent.isBye) return false;

    // ダブルスかどうか判定
    const evt = this._currentDrawData ? AppConfig.EVENTS.find(e => e.code === this._currentDrawData.eventCode) : null;
    const isDoubles = evt ? (evt.category === 'doubles' || evt.category === 'mixed_doubles') : false;

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

  _initDrawFormatSelect() {
    const formatSelect = document.getElementById('draw-format-select');
    const formatCustom = document.getElementById('draw-format-custom');
    if (formatSelect) {
      formatSelect.innerHTML = '<option value="">-- 選択 --</option>';
      (AppConfig.MATCH_FORMAT_OPTIONS || []).forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        formatSelect.appendChild(opt);
      });
      // あとで設定する
      const laterOpt = document.createElement('option');
      laterOpt.value = '__later__';
      laterOpt.textContent = 'あとで設定する';
      formatSelect.appendChild(laterOpt);
      // デフォルト値
      const defaultFormat = AppConfig.MATCH_FORMAT || '';
      if ((AppConfig.MATCH_FORMAT_OPTIONS || []).includes(defaultFormat)) {
        formatSelect.value = defaultFormat;
      }
      formatSelect.addEventListener('change', () => {
        if (formatCustom && formatSelect.value && formatSelect.value !== '__later__') formatCustom.value = '';
        this._updateDrawFormat();
      });
    }
    if (formatCustom) {
      formatCustom.addEventListener('input', () => this._updateDrawFormat());
    }
  },

  _updateDrawFormat() {
    const formatSelect = document.getElementById('draw-format-select');
    const formatCustom = document.getElementById('draw-format-custom');
    if (formatCustom && formatCustom.value.trim()) {
      AppConfig.MATCH_FORMAT = formatCustom.value.trim();
    } else if (formatSelect && formatSelect.value && formatSelect.value !== '__later__') {
      AppConfig.MATCH_FORMAT = formatSelect.value;
    } else if (formatSelect && formatSelect.value === '__later__') {
      AppConfig.MATCH_FORMAT = '';
    }
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

    // ゲームルールを確定時に反映
    this._updateDrawFormat();

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

    const collisionInput = document.querySelector('input[name="affiliation-collision"]');
    const shouldAvoid = !collisionInput || collisionInput.value === 'avoid';

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

    const evt = this._currentDrawData ? AppConfig.EVENTS.find(e => e.code === this._currentDrawData.eventCode) : null;
    const isDoubles = evt ? (evt.category === 'doubles' || evt.category === 'mixed_doubles') : false;

    // 2エントリー間で所属衝突があるかチェック
    const hasAffiliationCollision = (a, b) => {
      if (isDoubles) {
        // ダブルス: どちらかのパートナーの所属が一致すれば衝突
        const aAffs = [a.affiliation1 || a.affiliation || '', a.affiliation2 || ''].filter(x => x);
        const bAffs = [b.affiliation1 || b.affiliation || '', b.affiliation2 || ''].filter(x => x);
        for (const aa of aAffs) {
          for (const ba of bAffs) {
            if (aa && ba && aa === ba) return true;
          }
        }
        return false;
      } else {
        return a.affiliation && b.affiliation && a.affiliation === b.affiliation;
      }
    };

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
        if (hasAffiliationCollision(a, b)) {
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
        '<div class="roulette-number-display"><span class="roulette-no-label">No.</span><span id="roulette-number">--</span></div>' +
        '<div class="roulette-hint">タップまたはEnterで確定</div>';

      const numDisplay = document.getElementById('roulette-number');
      let idx = 0;

      rouletteTimer = setInterval(() => {
        idx = (idx + 1) % group.positions.length;
        if (numDisplay) numDisplay.textContent = group.positions[idx];
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
          numDisplay.textContent = result.map(p => p).join(' / ');
        }
        popup.innerHTML = html;

        currentGroup++;
        if (currentGroup < allPositions.length) {
          setTimeout(() => showGroup(currentGroup), 1800);
        } else {
          setTimeout(() => {
            popup.innerHTML =
              '<div class="roulette-complete">配置完了</div>';
            setTimeout(() => this._closeRoulettePopup(overlay), 1000);
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
      '<div class="roulette-number-display"><span class="roulette-no-label">No.</span><span id="individual-roulette-num">--</span></div>' +
      '<div class="roulette-hint">タップまたはEnterで確定</div>';

    const numDisplay = document.getElementById('individual-roulette-num');
    let timer = setInterval(() => {
      const randSlot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
      if (numDisplay) numDisplay.textContent = (randSlot + 1);
    }, 70);

    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
      document.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onClickStop);

      const targetSlot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
      if (numDisplay) {
        numDisplay.textContent = (targetSlot + 1);
        numDisplay.classList.add('decided');
      }

      // 配置
      this._placeInDraw(draw, targetSlot, player);
      this._unplacedPlayers.splice(playerIdx, 1);
      this._selectedPlayer = null;

      setTimeout(() => {
        popup.innerHTML =
          '<div class="roulette-complete">配置完了</div>' +
          '<div class="roulette-player-name">' + this._esc(player.name) + '</div>' +
          '<div class="roulette-result-row"><span class="position-label" style="font-size:24px;">No.' + (targetSlot + 1) + '</span></div>';
        setTimeout(() => {
          this._closeRoulettePopup(overlay);
          this._renderManualPlacement();
        }, 1000);
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

    // トーナメント表クリックで全画面表示
    const bracketContainer = document.getElementById('bracket-container');
    if (bracketContainer) {
      bracketContainer.addEventListener('click', (e) => {
        if (e.target.closest('.empty-message')) return;
        const eventCode = select ? select.value : '';
        if (!eventCode || !this.drawResults[eventCode]) return;
        this._openBracketFullscreen(eventCode);
      });
    }

    // 全画面: タップ/クリックで閉じる
    const fsOverlay = document.getElementById('bracket-fullscreen-overlay');
    if (fsOverlay) {
      fsOverlay.addEventListener('click', () => this._closeBracketFullscreen());
    }
    // ESCキーで閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closeBracketFullscreen();
    });

    // ドローデータエクスポート
    const btnDrawExport = document.getElementById('btn-draw-export');
    if (btnDrawExport) {
      btnDrawExport.addEventListener('click', () => this._exportDrawData());
    }

    // ドローデータインポート
    const fileDrawImport = document.getElementById('file-draw-import');
    if (fileDrawImport) {
      fileDrawImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this._importDrawData(file);
        e.target.value = '';
      });
    }

    // ボール数計算
    const btnCalcBalls = document.getElementById('btn-calc-balls');
    if (btnCalcBalls) {
      btnCalcBalls.addEventListener('click', () => this._calcBallCount());
    }
  },

  _openBracketFullscreen(eventCode) {
    const overlay = document.getElementById('bracket-fullscreen-overlay');
    const titleEl = document.getElementById('bracket-fullscreen-title');
    const body = document.getElementById('bracket-fullscreen-body');
    if (!overlay || !body) return;

    const result = this.drawResults[eventCode];
    if (!result) return;

    const evtDef = AppConfig.EVENTS.find(e => e.code === eventCode);
    if (titleEl) titleEl.textContent = result.eventName || eventCode;

    // 全画面用コンテナを作成（SVGはrender内で自動生成される）
    const fsContainer = document.createElement('div');
    fsContainer.style.cssText = 'width:100%;';

    body.innerHTML = '';
    body.appendChild(fsContainer);

    // オーバーレイを先に表示してからレンダリング（clientWidthを取得するため）
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      DrawRenderer.render(fsContainer, {
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
        isDoubles: evtDef ? (evtDef.category === 'doubles' || evtDef.category === 'mixed_doubles') : false,
      }, { confirmed: true, scheduleMap: this._getScheduleMap(), eventCode: eventCode });

      // SVGを画面に収める（viewBoxを維持しつつ幅100%にスケール）
      const svg = fsContainer.querySelector('svg');
      if (svg) {
        const svgW = parseFloat(svg.getAttribute('width'));
        const svgH = parseFloat(svg.getAttribute('height'));
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.maxHeight = '100%';
        svg.style.display = 'block';
      }
    });
  },

  _closeBracketFullscreen() {
    const overlay = document.getElementById('bracket-fullscreen-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  },

  /**
   * ドローデータをJSONファイルとしてエクスポート
   */
  _exportDrawData() {
    const confirmed = {};
    for (const code of Object.keys(this.drawResults || {})) {
      if (this.confirmedEvents && this.confirmedEvents[code]) {
        confirmed[code] = this.drawResults[code];
      }
    }
    if (Object.keys(confirmed).length === 0) {
      this.showMessage('確定済みのドローがありません', 'error');
      return;
    }
    // 選択中の大会情報を含める
    let tournament = null;
    if (this._confirmedTournamentId) {
      tournament = TournamentStore.getById(this._confirmedTournamentId);
    }
    if (!tournament) {
      // フォールバック: 大会名から検索
      const all = TournamentStore.getAll();
      const name = AppConfig.TOURNAMENT_NAME || '';
      tournament = all.find(t => t.name === name) || all[0] || null;
    }
    const data = {
      type: 'draw-share',
      version: 1,
      tournamentName: AppConfig.TOURNAMENT_NAME || '',
      exportedAt: new Date().toISOString(),
      drawResults: confirmed,
      confirmedEvents: { ...this.confirmedEvents },
      tournament: tournament ? {
        id: tournament.id,
        name: tournament.name,
        date: tournament.date || '',
        dayOfWeek: tournament.dayOfWeek || '',
        venue: tournament.venue || '',
        reserveDate: tournament.reserveDate || '',
        reserveVenue: tournament.reserveVenue || '',
      } : null,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'draw-data_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    this.showMessage('ドローデータをエクスポートしました（' + Object.keys(confirmed).length + '種目）', 'success');
  },

  /**
   * ドローデータをJSONファイルからインポート（マージ）
   */
  _importDrawData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.type !== 'draw-share') {
          this.showMessage('ドロー共有データではないファイルです', 'error');
          return;
        }
        let imported = 0;
        let skipped = 0;
        for (const code of Object.keys(data.drawResults || {})) {
          if (this.confirmedEvents && this.confirmedEvents[code]) {
            skipped++;
            continue;
          }
          this.drawResults[code] = data.drawResults[code];
          if (!this.confirmedEvents) this.confirmedEvents = {};
          if (data.confirmedEvents && data.confirmedEvents[code]) {
            this.confirmedEvents[code] = true;
          }
          imported++;
        }
        this._saveDrawResults();
        this._refreshBracketEventSelect();
        this._refreshDataSummary();
        let msg = imported + '種目をインポートしました';
        if (skipped > 0) msg += '（' + skipped + '種目は既に確定済みのためスキップ）';
        this.showMessage(msg, 'success');

        const resultEl = document.getElementById('draw-import-result');
        if (resultEl) {
          resultEl.style.display = '';
          resultEl.innerHTML = '<div style="padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;">' +
            msg + '</div>';
        }
      } catch (err) {
        this.showMessage('ファイルの読み込みに失敗しました: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  },

  /**
   * ボール必要数を算出
   * ルール: 初戦（ニューボール×2）+ シードBYEの2回戦（ニューボール×2）+ 決勝（ニューボール×2）
   */
  _calcBallCount() {
    const resultEl = document.getElementById('ball-calc-result');
    if (!resultEl) return;

    const confirmed = {};
    for (const code of Object.keys(this.drawResults || {})) {
      if (this.confirmedEvents && this.confirmedEvents[code]) {
        confirmed[code] = this.drawResults[code];
      }
    }
    if (Object.keys(confirmed).length === 0) {
      this.showMessage('確定済みのドローがありません', 'error');
      return;
    }

    let totalBalls = 0;
    let html = '<div class="table-wrapper"><table class="data-table"><thead><tr>' +
      '<th>種目</th><th>初戦数</th><th>シードBYE2回戦</th><th>決勝</th><th>ボール数</th></tr></thead><tbody>';

    const sortedCodes = this._getSortedEventCodes(Object.keys(confirmed));
    for (const code of sortedCodes) {
      const result = confirmed[code];
      const draw = result.draw || [];
      const drawSize = result.drawSize || draw.length;
      const halfSize = drawSize / 2;

      // 初戦の試合数をカウント（BYE同士は除く）
      let firstRoundMatches = 0;
      let seedByeMatches = 0;
      for (let i = 0; i < draw.length; i += 2) {
        const top = draw[i];
        const bottom = draw[i + 1];
        const topBye = top && top.isBye;
        const bottomBye = bottom && bottom.isBye;
        if (!topBye && !bottomBye) {
          // 両方選手 → 初戦
          firstRoundMatches++;
        } else if ((topBye && !bottomBye) || (!topBye && bottomBye)) {
          // 片方BYE → 不戦勝。相手がシードなら2回戦でニューボール
          const player = topBye ? bottom : top;
          if (player && player.seed && player.seed > 0) {
            seedByeMatches++;
          }
        }
      }

      const finalBall = 1; // 決勝1試合
      const eventBalls = (firstRoundMatches + seedByeMatches + finalBall) * 2;
      totalBalls += eventBalls;

      const evt = AppConfig.EVENTS.find(e => e.code === code);
      const evtName = evt ? evt.shortName || evt.name : code;
      html += '<tr><td>' + this._esc(evtName) + '</td>' +
        '<td style="text-align:center;">' + firstRoundMatches + '</td>' +
        '<td style="text-align:center;">' + seedByeMatches + '</td>' +
        '<td style="text-align:center;">1</td>' +
        '<td style="text-align:center;font-weight:bold;">' + eventBalls + '球</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<div style="margin-top:12px;padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">' +
      '<span style="font-size:18px;font-weight:700;color:#1e40af;">全体合計: ' + totalBalls + '球</span>' +
      '<span style="font-size:14px;color:#1e40af;font-weight:600;margin-left:12px;">（' + Math.ceil(totalBalls / 4) + '缶）</span>' +
      '<span style="font-size:12px;color:#6b7280;margin-left:8px;">※1缶4球</span></div>';

    resultEl.innerHTML = html;
    resultEl.style.display = '';
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
      isDoubles: evtDef ? (evtDef.category === 'doubles' || evtDef.category === 'mixed_doubles') : false,
      confirmed: !!isConfirmed,
      scheduleMap: this._getScheduleMap(),
      eventCode: select.value,
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
        isDoubles: evtInfo ? (evtInfo.category === 'doubles' || evtInfo.category === 'mixed_doubles') : false,
      }, { confirmed: true, scheduleMap: this._getScheduleMap(), eventCode: eventCode });
    }

    // クリア・やり直しボタン表示
    const btnClear = document.getElementById('btn-bracket-clear');
    if (btnClear) btnClear.style.display = '';
    const btnRedo = document.getElementById('btn-bracket-redo');
    if (btnRedo) btnRedo.style.display = result.confirmed ? '' : 'none';

    // エントリーリスト表示
    const evtDef = AppConfig.EVENTS.find(e => e.code === eventCode);
    const isDoubles = evtDef ? (evtDef.category === 'doubles' || evtDef.category === 'mixed_doubles') : false;
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

    // --- クラウド共有 初期化 ---
    this._initCloudShare();

    // --- Google ドライブ バックアップ 初期化 ---
    this._initGoogleDriveBackup();

    // --- GitHub 全データバックアップ 初期化 ---
    this._initGitHubBackup();

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

  // ================================================================
  // 時間割画面
  // ================================================================

  initScheduleScreen() {
    this._scheduleSlots = null;
    this._scheduleConfig = null;
    this._restoreSchedule();

    // コートブロックチェックボックス生成（4ブロック、全チェック）
    const cbContainer = document.getElementById('schedule-court-checkboxes');
    if (cbContainer) {
      const blocks = [
        { value: '1-4', label: '1〜4面' },
        { value: '5-8', label: '5〜8面' },
        { value: '9-12', label: '9〜12面' },
        { value: '13-16', label: '13〜16面' },
      ];
      for (const block of blocks) {
        const label = document.createElement('label');
        label.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:14px;user-select:none;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = block.value;
        cb.className = 'schedule-court-cb';
        label.appendChild(cb);
        label.appendChild(document.createTextNode(block.label));
        cbContainer.appendChild(label);
      }
    }

    const btnGenerate = document.getElementById('btn-generate-schedule');
    if (btnGenerate) {
      btnGenerate.addEventListener('click', () => this._generateSchedule());
    }
    const btnReset = document.getElementById('btn-reset-schedule');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (!confirm('手動変更を破棄して再生成しますか？')) return;
        this._generateSchedule();
      });
    }
    const btnClear = document.getElementById('btn-clear-schedule');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (!confirm('時間割をクリアしますか？')) return;
        this._clearSchedule();
      });
    }
    const btnPrint = document.getElementById('btn-schedule-print');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => window.print());
    }
    const btnScheduleExcel = document.getElementById('btn-schedule-excel');
    if (btnScheduleExcel) {
      btnScheduleExcel.addEventListener('click', () => this._exportScheduleExcel());
    }
    const btnSchedulePdf = document.getElementById('btn-schedule-pdf');
    if (btnSchedulePdf) {
      btnSchedulePdf.addEventListener('click', () => this._exportSchedulePDF());
    }

    // セル選択状態
    this._selectedScheduleCell = null;
  },

  _refreshScheduleScreen() {
    // 確定済み種目がなければメッセージ表示
    const statusMsg = document.getElementById('schedule-status-msg');
    const confirmedCodes = Object.keys(this.confirmedEvents || {}).filter(c => this.confirmedEvents[c]);
    if (confirmedCodes.length === 0) {
      if (statusMsg) statusMsg.textContent = '※ 確定済みのドローがありません。先にドロー抽選を行ってください。';
      return;
    }
    if (statusMsg && !this._scheduleSlots) {
      statusMsg.textContent = '確定済み種目: ' + confirmedCodes.map(c => {
        const evt = AppConfig.EVENTS.find(e => e.code === c);
        return evt ? evt.name : c;
      }).join(', ');
    }
    // 保存済みスケジュールがあれば表示
    if (this._scheduleSlots) {
      this._renderScheduleGrid(this._scheduleSlots, this._scheduleConfig);
      this._renderEventScheduleLists(this._scheduleSlots);
    }
  },

  _generateSchedule() {
    const confirmedCodes = Object.keys(this.confirmedEvents || {}).filter(c => this.confirmedEvents[c]);
    if (confirmedCodes.length === 0) {
      this.showMessage('確定済みのドローがありません', 'warning');
      return;
    }

    // 設定値の取得 - ブロックを個別コート番号に展開
    const checkedBlocks = [];
    document.querySelectorAll('.schedule-court-cb:checked').forEach(cb => {
      checkedBlocks.push(cb.value);
    });
    if (checkedBlocks.length === 0) {
      this.showMessage('使用するコートブロックを選択してください', 'warning');
      return;
    }
    const courtNames = [];
    for (const block of checkedBlocks) {
      const [start, end] = block.split('-').map(Number);
      for (let i = start; i <= end; i++) {
        courtNames.push(String(i));
      }
    }
    const courtCount = courtNames.length;
    const matchDuration = parseInt(document.getElementById('schedule-match-duration').value, 10) || 40;
    const startTime = document.getElementById('schedule-start-time').value || '09:00';

    // 全確定種目からマッチを抽出
    const allMatches = [];
    for (const code of confirmedCodes) {
      const result = this.drawResults[code];
      if (!result) continue;
      const matches = ScheduleEngine.extractMatchesFromDraw(result, code);
      allMatches.push(...matches);
    }

    if (allMatches.length === 0) {
      this.showMessage('スケジュール可能な試合がありません', 'warning');
      return;
    }

    const config = { courtCount, courtNames, matchDuration, startTime };
    const slots = ScheduleEngine.autoSchedule(allMatches, config);

    this._scheduleSlots = slots;
    this._scheduleConfig = config;
    this._scheduleAllMatches = allMatches;
    this._saveSchedule();

    this._renderScheduleGrid(slots, config);
    this._renderEventScheduleLists(slots);

    const statusMsg = document.getElementById('schedule-status-msg');
    if (statusMsg) statusMsg.textContent = '時間割を生成しました（' + slots.length + '試合）';
    const btnClear = document.getElementById('btn-clear-schedule');
    if (btnClear) btnClear.style.display = '';
    const btnReset = document.getElementById('btn-reset-schedule');
    if (btnReset) btnReset.style.display = '';

    this._selectedScheduleCell = null;
    this.showMessage('時間割を生成しました（' + slots.length + '試合）', 'success');
  },

  _renderScheduleGrid(slots, config) {
    const gridPanel = document.getElementById('schedule-grid-panel');
    const thead = document.getElementById('schedule-grid-head');
    const tbody = document.getElementById('schedule-grid-body');
    if (!gridPanel || !thead || !tbody) return;

    gridPanel.style.display = '';
    this._selectedScheduleCell = null;

    // 最大タイムスロットを計算
    const maxSlot = slots.reduce((max, s) => Math.max(max, s.timeSlotIndex), 0);
    const { courtNames, courtCount, matchDuration, startTime } = config;

    // ヘッダー行
    let headHtml = '<tr><th class="schedule-court-header">コート</th>';
    for (let t = 0; t <= maxSlot; t++) {
      const timeStr = ScheduleEngine.calcTimeString(startTime, t, matchDuration);
      headHtml += '<th class="schedule-time-header">' + timeStr + '</th>';
    }
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    // グリッドデータ構築
    const grid = {};
    for (const slot of slots) {
      if (!grid[slot.courtIndex]) grid[slot.courtIndex] = {};
      grid[slot.courtIndex][slot.timeSlotIndex] = slot;
    }

    // 種目ごとの色
    const eventColors = {};
    if (typeof AppConfig !== 'undefined' && AppConfig.EVENTS) {
      const palette = ['#E3F2FD', '#FFF3E0', '#E8F5E9', '#FCE4EC', '#F3E5F5', '#E0F7FA', '#FFF9C4', '#EFEBE9'];
      AppConfig.EVENTS.forEach((evt, i) => {
        eventColors[evt.code] = palette[i % palette.length];
      });
    }

    tbody.innerHTML = '';
    for (let c = 0; c < courtCount; c++) {
      const tr = document.createElement('tr');
      const tdCourt = document.createElement('td');
      tdCourt.className = 'schedule-court-cell';
      tdCourt.textContent = courtNames[c] || (c + 1);
      tr.appendChild(tdCourt);

      for (let t = 0; t <= maxSlot; t++) {
        const td = document.createElement('td');
        td.dataset.court = c;
        td.dataset.slot = t;
        const slot = grid[c] && grid[c][t];
        if (slot) {
          const bgColor = eventColors[slot.eventCode] || '#f5f5f5';
          const evtName = ScheduleEngine._getEventName ? ScheduleEngine._getEventName(slot.eventCode) : slot.eventCode;
          td.className = 'schedule-match-cell';
          td.style.background = bgColor;
          td.dataset.matchId = slot.matchId;
          td.innerHTML = '<div class="schedule-cell-event">' + evtName + '</div>' +
            '<div class="schedule-cell-round">' + slot.roundLabel + '</div>';
        } else {
          td.className = 'schedule-empty-cell';
        }
        td.style.cursor = 'pointer';
        td.addEventListener('click', () => this._onScheduleCellClick(td, c, t));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    // 印刷・エクスポートボタン表示
    const btnPrint = document.getElementById('btn-schedule-print');
    if (btnPrint) btnPrint.style.display = '';
    const btnSchExcel = document.getElementById('btn-schedule-excel');
    if (btnSchExcel) btnSchExcel.style.display = '';
    const btnSchPdf = document.getElementById('btn-schedule-pdf');
    if (btnSchPdf) btnSchPdf.style.display = '';
  },

  /**
   * タイムテーブルセルクリック: 選択 → 移動先指定で入替
   */
  _onScheduleCellClick(td, courtIdx, slotIdx) {
    if (!this._scheduleSlots || !this._scheduleConfig) return;

    // 1回目: セル選択
    if (!this._selectedScheduleCell) {
      // 空セルの選択は無視
      if (!td.dataset.matchId) return;
      this._selectedScheduleCell = { td, courtIdx, slotIdx, matchId: td.dataset.matchId };
      td.classList.add('schedule-cell-selected');
      const hint = document.getElementById('schedule-edit-hint');
      if (hint) hint.textContent = '移動先のセルをタップしてください（同じセルで選択解除）';
      return;
    }

    const src = this._selectedScheduleCell;

    // 同じセル → 選択解除
    if (src.courtIdx === courtIdx && src.slotIdx === slotIdx) {
      src.td.classList.remove('schedule-cell-selected');
      this._selectedScheduleCell = null;
      const hint = document.getElementById('schedule-edit-hint');
      if (hint) hint.textContent = 'セルをタップして選択 → 移動先セルをタップで入れ替え';
      return;
    }

    // 2回目: 入替実行
    const srcMatchId = src.matchId;
    const dstMatchId = td.dataset.matchId || null;

    // slots配列を更新
    const slots = this._scheduleSlots;
    const config = this._scheduleConfig;
    const { courtNames, matchDuration, startTime } = config;

    // srcスロットを探す
    const srcSlotObj = slots.find(s => s.matchId === srcMatchId);
    // dstスロットを探す（空の場合はnull）
    const dstSlotObj = dstMatchId ? slots.find(s => s.matchId === dstMatchId) : null;

    if (srcSlotObj) {
      srcSlotObj.courtIndex = courtIdx;
      srcSlotObj.timeSlotIndex = slotIdx;
      srcSlotObj.courtName = courtNames[courtIdx] || String(courtIdx + 1);
      srcSlotObj.startTime = ScheduleEngine.calcTimeString(startTime, slotIdx, matchDuration);
    }
    if (dstSlotObj) {
      dstSlotObj.courtIndex = src.courtIdx;
      dstSlotObj.timeSlotIndex = src.slotIdx;
      dstSlotObj.courtName = courtNames[src.courtIdx] || String(src.courtIdx + 1);
      dstSlotObj.startTime = ScheduleEngine.calcTimeString(startTime, src.slotIdx, matchDuration);
    }

    this._saveSchedule();
    this._renderScheduleGrid(slots, config);
    this._renderEventScheduleLists(slots);
    this.showMessage('試合を移動しました', 'info');
  },

  _renderEventScheduleLists(slots) {
    const panel = document.getElementById('schedule-event-panel');
    const container = document.getElementById('schedule-event-lists');
    if (!panel || !container) return;

    panel.style.display = '';
    container.innerHTML = '';

    // 種目ごとにグループ化
    const byEvent = {};
    for (const slot of slots) {
      if (!byEvent[slot.eventCode]) byEvent[slot.eventCode] = [];
      byEvent[slot.eventCode].push(slot);
    }

    // 種目別にマッチ情報を取得
    const matchMap = {};
    if (this._scheduleAllMatches) {
      for (const m of this._scheduleAllMatches) {
        matchMap[m.matchId] = m;
      }
    }

    for (const code of Object.keys(byEvent)) {
      const eventSlots = byEvent[code].sort((a, b) => a.timeSlotIndex - b.timeSlotIndex);
      const evtName = ScheduleEngine._getEventName ? ScheduleEngine._getEventName(code) : code;

      let html = '<div style="margin-bottom:16px;"><h4 style="margin:0 0 8px;font-size:14px;color:#333;">' + evtName + '</h4>';
      html += '<table class="data-table" style="font-size:13px;"><thead><tr>' +
        '<th>時間</th><th>コート</th><th>ラウンド</th><th>対戦</th></tr></thead><tbody>';

      for (const slot of eventSlots) {
        const match = matchMap[slot.matchId];
        const playersStr = match && match.players.length > 0
          ? match.players.filter(Boolean).join(' vs ')
          : '（前試合勝者）';

        html += '<tr>' +
          '<td>' + slot.startTime + '</td>' +
          '<td>' + slot.courtName + '</td>' +
          '<td>' + slot.roundLabel + '</td>' +
          '<td>' + playersStr + '</td>' +
          '</tr>';
      }
      html += '</tbody></table></div>';
      container.innerHTML += html;
    }
  },

  _saveSchedule() {
    try {
      localStorage.setItem('drawSystem_schedule', JSON.stringify({
        slots: this._scheduleSlots,
        config: this._scheduleConfig,
        savedAt: new Date().toISOString(),
      }));
    } catch (e) {
      console.warn('スケジュール保存に失敗:', e);
    }
  },

  _restoreSchedule() {
    try {
      const saved = localStorage.getItem('drawSystem_schedule');
      if (!saved) return;
      const data = JSON.parse(saved);
      if (data.slots) this._scheduleSlots = data.slots;
      if (data.config) this._scheduleConfig = data.config;
    } catch (e) {
      console.warn('スケジュール復元に失敗:', e);
    }
  },

  _clearSchedule() {
    this._scheduleSlots = null;
    this._scheduleConfig = null;
    this._scheduleAllMatches = null;
    try { localStorage.removeItem('drawSystem_schedule'); } catch (e) { /* ignore */ }

    const gridPanel = document.getElementById('schedule-grid-panel');
    if (gridPanel) gridPanel.style.display = 'none';
    const eventPanel = document.getElementById('schedule-event-panel');
    if (eventPanel) eventPanel.style.display = 'none';
    const btnClear = document.getElementById('btn-clear-schedule');
    if (btnClear) btnClear.style.display = 'none';
    const btnReset = document.getElementById('btn-reset-schedule');
    if (btnReset) btnReset.style.display = 'none';
    const btnPrint = document.getElementById('btn-schedule-print');
    if (btnPrint) btnPrint.style.display = 'none';
    const btnSchExcel2 = document.getElementById('btn-schedule-excel');
    if (btnSchExcel2) btnSchExcel2.style.display = 'none';
    const btnSchPdf2 = document.getElementById('btn-schedule-pdf');
    if (btnSchPdf2) btnSchPdf2.style.display = 'none';
    const statusMsg = document.getElementById('schedule-status-msg');
    if (statusMsg) statusMsg.textContent = '';

    this._selectedScheduleCell = null;
    this.showMessage('時間割をクリアしました', 'info');
  },

  /**
   * 時間割をExcelファイルとしてエクスポート
   */
  _exportScheduleExcel() {
    if (!this._scheduleSlots || !this._scheduleConfig) {
      this.showMessage('時間割が生成されていません', 'error');
      return;
    }
    const slots = this._scheduleSlots;
    const config = this._scheduleConfig;
    const { courtNames, courtCount, matchDuration, startTime } = config;
    const maxSlot = slots.reduce((max, s) => Math.max(max, s.timeSlotIndex), 0);

    // グリッドデータ構築
    const grid = {};
    for (const slot of slots) {
      if (!grid[slot.courtIndex]) grid[slot.courtIndex] = {};
      grid[slot.courtIndex][slot.timeSlotIndex] = slot;
    }

    const wb = XLSX.utils.book_new();

    // === Sheet 1: タイムテーブル ===
    const ttData = [];
    // ヘッダー行
    const headerRow = ['コート'];
    for (let t = 0; t <= maxSlot; t++) {
      headerRow.push(ScheduleEngine.calcTimeString(startTime, t, matchDuration));
    }
    ttData.push(headerRow);

    // データ行
    for (let c = 0; c < courtCount; c++) {
      const row = [courtNames[c] || String(c + 1)];
      for (let t = 0; t <= maxSlot; t++) {
        const slot = grid[c] && grid[c][t];
        if (slot) {
          const evtName = ScheduleEngine._getEventName ? ScheduleEngine._getEventName(slot.eventCode) : slot.eventCode;
          row.push(evtName + ' ' + slot.roundLabel);
        } else {
          row.push('');
        }
      }
      ttData.push(row);
    }

    const ws1 = XLSX.utils.aoa_to_sheet(ttData);

    // 列幅設定
    const colWidths = [{ wch: 8 }];
    for (let t = 0; t <= maxSlot; t++) {
      colWidths.push({ wch: 16 });
    }
    ws1['!cols'] = colWidths;

    // ヘッダースタイル（背景色）
    for (let col = 0; col <= maxSlot + 1; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (ws1[cellRef]) {
        ws1[cellRef].s = {
          fill: { fgColor: { rgb: '4472C4' } },
          font: { color: { rgb: 'FFFFFF' }, bold: true },
          alignment: { horizontal: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } },
          },
        };
      }
    }

    // 種目ごとの色マップ
    const eventColorMap = {};
    if (typeof AppConfig !== 'undefined' && AppConfig.EVENTS) {
      const xlPalette = ['D6E4F0', 'FDE9D9', 'E2EFDA', 'FCE4EC', 'E8D5F5', 'D5F5F0', 'FFF9C4', 'EFEBE9'];
      AppConfig.EVENTS.forEach((evt, i) => {
        eventColorMap[evt.code] = xlPalette[i % xlPalette.length];
      });
    }

    // データセルにスタイル適用
    for (let r = 1; r <= courtCount; r++) {
      for (let col = 0; col <= maxSlot + 1; col++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: col });
        if (!ws1[cellRef]) {
          ws1[cellRef] = { v: '', t: 's' };
        }
        const cellStyle = {
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } },
          },
        };
        if (col === 0) {
          cellStyle.font = { bold: true };
          cellStyle.fill = { fgColor: { rgb: 'E5E7EB' } };
        } else {
          const slot = grid[r - 1] && grid[r - 1][col - 1];
          if (slot && eventColorMap[slot.eventCode]) {
            cellStyle.fill = { fgColor: { rgb: eventColorMap[slot.eventCode] } };
          }
        }
        ws1[cellRef].s = cellStyle;
      }
    }

    XLSX.utils.book_append_sheet(wb, ws1, 'タイムテーブル');

    // === Sheet 2+: 種目別スケジュール ===
    const byEvent = {};
    for (const slot of slots) {
      if (!byEvent[slot.eventCode]) byEvent[slot.eventCode] = [];
      byEvent[slot.eventCode].push(slot);
    }

    const matchMap = {};
    if (this._scheduleAllMatches) {
      for (const m of this._scheduleAllMatches) {
        matchMap[m.matchId] = m;
      }
    }

    for (const code of Object.keys(byEvent)) {
      const eventSlots = byEvent[code].sort((a, b) => a.timeSlotIndex - b.timeSlotIndex);
      const evtName = ScheduleEngine._getEventName ? ScheduleEngine._getEventName(code) : code;

      const evtData = [['時間', 'コート', 'ラウンド', '対戦']];
      for (const slot of eventSlots) {
        const match = matchMap[slot.matchId];
        const playersStr = match && match.players.length > 0
          ? match.players.filter(Boolean).join(' vs ')
          : '（前試合勝者）';
        evtData.push([slot.startTime, slot.courtName, slot.roundLabel, playersStr]);
      }

      const ws = XLSX.utils.aoa_to_sheet(evtData);
      ws['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 30 }];

      // ヘッダースタイル
      for (let col = 0; col < 4; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
        if (ws[cellRef]) {
          ws[cellRef].s = {
            fill: { fgColor: { rgb: '4472C4' } },
            font: { color: { rgb: 'FFFFFF' }, bold: true },
            alignment: { horizontal: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: '000000' } },
              bottom: { style: 'thin', color: { rgb: '000000' } },
              left: { style: 'thin', color: { rgb: '000000' } },
              right: { style: 'thin', color: { rgb: '000000' } },
            },
          };
        }
      }

      // データセルにボーダー
      for (let r = 1; r < evtData.length; r++) {
        for (let col = 0; col < 4; col++) {
          const cellRef = XLSX.utils.encode_cell({ r, c: col });
          if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
          ws[cellRef].s = {
            alignment: { horizontal: col === 3 ? 'left' : 'center', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: '000000' } },
              bottom: { style: 'thin', color: { rgb: '000000' } },
              left: { style: 'thin', color: { rgb: '000000' } },
              right: { style: 'thin', color: { rgb: '000000' } },
            },
          };
        }
      }

      // シート名は31文字制限
      const sheetName = evtName.substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // ファイル出力
    const tournamentName = (AppConfig.TOURNAMENT_NAME || '大会').replace(/[\\/:*?"<>|]/g, '_');
    const fileName = '時間割_' + tournamentName + '.xlsx';
    XLSX.writeFile(wb, fileName);
    this.showMessage('Excelファイルをダウンロードしました', 'success');
  },

  /**
   * 時間割をPDFとして出力（印刷ダイアログ経由）
   */
  _exportSchedulePDF() {
    if (!this._scheduleSlots || !this._scheduleConfig) {
      this.showMessage('時間割が生成されていません', 'error');
      return;
    }
    // A4横向き用の@pageルールを動的に注入（デフォルトはA3横向き）
    const styleEl = document.createElement('style');
    styleEl.id = 'schedule-print-page-override';
    styleEl.textContent = '@media print { @page { size: A4 landscape; margin: 8mm; } }';
    document.head.appendChild(styleEl);

    document.body.classList.add('schedule-print-mode');
    setTimeout(() => {
      window.print();
      // 印刷ダイアログを閉じた後にクラスとスタイルを除去
      setTimeout(() => {
        document.body.classList.remove('schedule-print-mode');
        const overrideStyle = document.getElementById('schedule-print-page-override');
        if (overrideStyle) overrideStyle.remove();
      }, 500);
    }, 100);
  },

  /**
   * スケジュールマップを取得（DrawRenderer用）
   * @returns {object|null} matchId → { startTime, courtName }
   */
  _getScheduleMap() {
    if (!this._scheduleSlots) return null;
    return ScheduleEngine.buildScheduleMap(this._scheduleSlots);
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
          '<div class="loading-card-header">' +
            '<div class="loading-card-header-icon">' +
              '<svg width="28" height="28" viewBox="0 0 24 24" fill="none">' +
                '<path d="M12 2L13.5 9.5L20 12L13.5 14.5L12 22L10.5 14.5L4 12L10.5 9.5L12 2Z" fill="url(#ldGrad)"/>' +
                '<defs><linearGradient id="ldGrad" x1="4" y1="2" x2="20" y2="22">' +
                  '<stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#6d28d9"/>' +
                '</linearGradient></defs>' +
              '</svg>' +
              '<span class="pulse-dot"></span>' +
            '</div>' +
            '<div class="loading-card-header-text">' +
              '<div class="title">' + (message || 'データ読込中...') + '</div>' +
              '<div class="subtitle">処理中...</div>' +
            '</div>' +
          '</div>' +
          '<div class="loading-arc-container">' +
            '<div class="loading-conic-ring"></div>' +
          '</div>' +
          '<div class="loading-text">' + (message || 'データ読込中...') + '</div>' +
          '<div class="loading-progress-section">' +
            '<div class="loading-progress-top">' +
              '<span class="loading-progress-label">進捗</span>' +
              '<span class="loading-percent" id="loading-percent">0%</span>' +
            '</div>' +
            '<div class="loading-progress-bar-container">' +
              '<div class="loading-progress-bar" id="loading-progress-bar"></div>' +
            '</div>' +
          '</div>' +
          '<div class="loading-sub">しばらくお待ちください</div>' +
        '</div>';
      document.body.appendChild(overlay);
    } else {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
      const textEl = overlay.querySelector('.loading-text');
      if (textEl) textEl.textContent = message || 'データ読込中...';
      const headerTitle = overlay.querySelector('.loading-card-header-text .title');
      if (headerTitle) headerTitle.textContent = message || 'データ読込中...';
      const bar = overlay.querySelector('#loading-progress-bar');
      if (bar) bar.style.width = '0%';
      const pct = overlay.querySelector('#loading-percent');
      if (pct) pct.textContent = '0%';
    }
  },

  _updateLoadingProgress(percent, message) {
    const bar = document.getElementById('loading-progress-bar');
    const pct = document.getElementById('loading-percent');
    const textEl = document.querySelector('#data-loading-overlay .loading-text');
    if (bar) bar.style.width = percent + '%';
    if (pct) pct.textContent = Math.round(percent) + '%';
    if (message && textEl) textEl.textContent = message;
  },

  _hideLoadingOverlay() {
    this._isDataLoading = false;
    // 100%にしてから閉じる
    this._updateLoadingProgress(100);
    setTimeout(() => {
      const overlay = document.getElementById('data-loading-overlay');
      if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.4s';
        setTimeout(() => {
          if (overlay.parentNode) overlay.remove();
        }, 400);
      }
    }, 300);
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
      init() { },

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

  // ===== クラウド共有 =====

  _initCloudShare() {
    // Firebase設定パネルの折りたたみ
    const configToggle = document.getElementById('cloud-config-toggle');
    const configPanel = document.getElementById('cloud-config-panel');
    const configArrow = document.getElementById('cloud-config-arrow');
    if (configToggle && configPanel) {
      configToggle.addEventListener('click', () => {
        const isOpen = configPanel.style.display !== 'none';
        configPanel.style.display = isOpen ? 'none' : 'block';
        if (configArrow) configArrow.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    }

    // 保存済み設定を復元
    const savedConfig = CloudShare.loadConfig();
    if (savedConfig) {
      const apiKeyInput = document.getElementById('cloud-config-apikey');
      const authDomainInput = document.getElementById('cloud-config-authdomain');
      const dbUrlInput = document.getElementById('cloud-config-dburl');
      const projectIdInput = document.getElementById('cloud-config-projectid');
      if (apiKeyInput) apiKeyInput.value = savedConfig.apiKey || '';
      if (authDomainInput) authDomainInput.value = savedConfig.authDomain || '';
      if (dbUrlInput) dbUrlInput.value = savedConfig.databaseURL || '';
      if (projectIdInput) projectIdInput.value = savedConfig.projectId || '';

      // 自動初期化
      try {
        CloudShare.init(savedConfig);
      } catch (e) { /* ignore */ }
    }

    this._updateCloudUI();

    // 設定保存ボタン
    const btnSaveConfig = document.getElementById('btn-cloud-save-config');
    if (btnSaveConfig) {
      btnSaveConfig.addEventListener('click', () => {
        const config = {
          apiKey: (document.getElementById('cloud-config-apikey') || {}).value || '',
          authDomain: (document.getElementById('cloud-config-authdomain') || {}).value || '',
          databaseURL: (document.getElementById('cloud-config-dburl') || {}).value || '',
          projectId: (document.getElementById('cloud-config-projectid') || {}).value || '',
        };
        if (!config.apiKey || !config.databaseURL) {
          this.showMessage('API KeyとDatabase URLは必須です', 'error');
          return;
        }
        const ok = CloudShare.init(config);
        if (ok) {
          this.showMessage('Firebase設定を保存しました', 'success');
        } else {
          this.showMessage('Firebase初期化に失敗しました', 'error');
        }
        this._updateCloudUI();
      });
    }

    // スペース作成ボタン
    const btnCreate = document.getElementById('btn-cloud-create-space');
    if (btnCreate) {
      btnCreate.addEventListener('click', async () => {
        if (!CloudShare.isConnected()) {
          this.showMessage('先にFirebase設定を行ってください', 'error');
          return;
        }
        try {
          const spaceId = await CloudShare.createSpace('ドロー会議共有');
          this.showMessage('共有スペースを作成しました: ' + spaceId, 'success');
          this._updateCloudUI();
          this._startCloudFileWatch();
        } catch (e) {
          this.showMessage('スペース作成エラー: ' + e.message, 'error');
        }
      });
    }

    // スペース参加ボタン
    const btnJoin = document.getElementById('btn-cloud-join-space');
    if (btnJoin) {
      btnJoin.addEventListener('click', async () => {
        if (!CloudShare.isConnected()) {
          this.showMessage('先にFirebase設定を行ってください', 'error');
          return;
        }
        const codeInput = document.getElementById('cloud-join-code');
        const code = (codeInput ? codeInput.value : '').toUpperCase().trim();
        if (!code) {
          this.showMessage('参加コードを入力してください', 'error');
          return;
        }
        try {
          await CloudShare.joinSpace(code);
          this.showMessage('スペースに参加しました', 'success');
          this._updateCloudUI();
          this._startCloudFileWatch();
        } catch (e) {
          this.showMessage('参加エラー: ' + e.message, 'error');
        }
      });
    }

    // スペース離脱ボタン
    const btnLeave = document.getElementById('btn-cloud-leave-space');
    if (btnLeave) {
      btnLeave.addEventListener('click', () => {
        if (confirm('共有スペースから離れますか？')) {
          CloudShare.leaveSpace();
          this.showMessage('スペースから離れました', 'info');
          this._updateCloudUI();
        }
      });
    }



    // コピーボタン
    const btnCopy = document.getElementById('btn-cloud-copy-code');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        const code = CloudShare.getSpaceId();
        if (code) {
          navigator.clipboard.writeText(code).then(() => {
            this.showMessage('コードをコピーしました', 'success');
          }).catch(() => {
            this.showMessage('コピーに失敗しました。手動でコピーしてください。', 'error');
          });
        }
      });
    }

    // アップロードボタン: エントリーデータ
    const btnUploadEntry = document.getElementById('btn-cloud-upload-entry');
    if (btnUploadEntry) {
      btnUploadEntry.addEventListener('click', async () => {
        if (!CloudShare.isInSpace()) { this.showMessage('共有スペースに参加してください', 'error'); return; }
        try {
          const entries = EntryStore.getAll();
          if (entries.length === 0) { this.showMessage('エントリーデータがありません', 'error'); return; }
          await CloudShare.uploadFile(
            'エントリーデータ_' + new Date().toLocaleString('ja-JP'),
            'entries',
            entries
          );
          this.showMessage('エントリーデータをアップロードしました', 'success');
        } catch (e) {
          this.showMessage('アップロードエラー: ' + e.message, 'error');
        }
      });
    }

    // アップロードボタン: ドロー結果
    const btnUploadDraw = document.getElementById('btn-cloud-upload-draw');
    if (btnUploadDraw) {
      btnUploadDraw.addEventListener('click', async () => {
        if (!CloudShare.isInSpace()) { this.showMessage('共有スペースに参加してください', 'error'); return; }
        try {
          const drawKeys = Object.keys(this.drawResults);
          if (drawKeys.length === 0) { this.showMessage('ドロー結果がありません', 'error'); return; }
          await CloudShare.uploadFile(
            'ドロー結果_' + new Date().toLocaleString('ja-JP'),
            'draws',
            { drawResults: this.drawResults, confirmedEvents: this.confirmedEvents }
          );
          this.showMessage('ドロー結果をアップロードしました', 'success');
        } catch (e) {
          this.showMessage('アップロードエラー: ' + e.message, 'error');
        }
      });
    }

    // アップロードボタン: 大会データ
    const btnUploadTournament = document.getElementById('btn-cloud-upload-tournament');
    if (btnUploadTournament) {
      btnUploadTournament.addEventListener('click', async () => {
        if (!CloudShare.isInSpace()) { this.showMessage('共有スペースに参加してください', 'error'); return; }
        try {
          const tournaments = TournamentStore.getAll();
          if (tournaments.length === 0) { this.showMessage('大会データがありません', 'error'); return; }
          await CloudShare.uploadFile(
            '大会データ_' + new Date().toLocaleString('ja-JP'),
            'tournament',
            tournaments
          );
          this.showMessage('大会データをアップロードしました', 'success');
        } catch (e) {
          this.showMessage('アップロードエラー: ' + e.message, 'error');
        }
      });
    }

    // アップロードボタン: 全データバックアップ
    const btnUploadBackup = document.getElementById('btn-cloud-upload-backup');
    if (btnUploadBackup) {
      btnUploadBackup.addEventListener('click', async () => {
        if (!CloudShare.isInSpace()) { this.showMessage('共有スペースに参加してください', 'error'); return; }
        try {
          const allData = {};
          const keys = ['drawSystem_rankingBackup', 'drawSystem_tournaments', 'drawSystem_tournamentBackup', 'drawSystem_entries'];
          keys.forEach(k => {
            const val = localStorage.getItem(k);
            if (val) { try { allData[k] = JSON.parse(val); } catch (e) { allData[k] = val; } }
          });
          allData['drawSystem_drawResults'] = { drawResults: this.drawResults, confirmedEvents: this.confirmedEvents };
          allData.exportedAt = new Date().toISOString();

          await CloudShare.uploadFile(
            '全データバックアップ_' + new Date().toLocaleString('ja-JP'),
            'backup',
            allData
          );
          this.showMessage('全データバックアップをアップロードしました', 'success');
        } catch (e) {
          this.showMessage('アップロードエラー: ' + e.message, 'error');
        }
      });
    }

    // クイック共有ボタン (Web Share API)
    const btnWebShare = document.getElementById('btn-cloud-webshare');
    if (btnWebShare) {
      btnWebShare.addEventListener('click', async () => {
        try {
          const allData = {};
          const keys = ['drawSystem_rankingBackup', 'drawSystem_tournaments', 'drawSystem_entries'];
          keys.forEach(k => {
            const val = localStorage.getItem(k);
            if (val) { try { allData[k] = JSON.parse(val); } catch (e) { allData[k] = val; } }
          });
          allData['drawSystem_drawResults'] = { drawResults: this.drawResults, confirmedEvents: this.confirmedEvents };
          allData.exportedAt = new Date().toISOString();

          const title = 'ドロー会議データ_' + new Date().toISOString().slice(0, 10);
          await CloudShare.webShare(title, allData);
          this.showMessage('データを共有しました', 'success');
        } catch (e) {
          this.showMessage('共有エラー: ' + e.message, 'error');
        }
      });
    }

    // 既にスペースに参加済みならファイル監視開始
    if (CloudShare.isInSpace()) {
      this._startCloudFileWatch();
    }
  },

  _updateCloudUI() {
    const statusBadge = document.getElementById('cloud-config-status-badge');
    const notJoined = document.getElementById('cloud-space-not-joined');
    const joined = document.getElementById('cloud-space-joined');
    const spaceCode = document.getElementById('cloud-space-code');

    // 接続ステータスバッジ
    if (statusBadge) {
      if (CloudShare.isConnected()) {
        statusBadge.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;background:#d1fae5;color:#065f46;font-size:12px;font-weight:600;"><span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;"></span>接続済み</span>';
      } else {
        statusBadge.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;background:#f3f4f6;color:#6b7280;font-size:12px;font-weight:600;"><span style="width:8px;height:8px;border-radius:50%;background:#9ca3af;display:inline-block;"></span>未設定</span>';
      }
    }

    // スペース表示切り替え
    if (CloudShare.isInSpace()) {
      if (notJoined) notJoined.style.display = 'none';
      if (joined) joined.style.display = 'block';
      if (spaceCode) spaceCode.textContent = CloudShare.getSpaceId();
    } else {
      if (notJoined) notJoined.style.display = 'block';
      if (joined) joined.style.display = 'none';
    }
  },

  _startCloudFileWatch() {
    CloudShare.watchFiles((files) => {
      this._renderCloudFiles(files);
    });
  },

  _renderCloudFiles(files) {
    const tbody = document.getElementById('cloud-files-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (files.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" style="text-align:center;color:#999;">ファイルがありません</td>';
      tbody.appendChild(tr);
      return;
    }

    const typeLabels = {
      entries: 'エントリー',
      draws: 'ドロー結果',
      tournament: '大会データ',
      backup: '全データ',
      furigana: 'ふりがな',
    };

    files.forEach(file => {
      const tr = document.createElement('tr');
      const dateStr = file.uploadedAt ? new Date(file.uploadedAt).toLocaleString('ja-JP') : '-';
      const sizeKB = file.dataSize ? (file.dataSize / 1024).toFixed(1) + ' KB' : '-';
      const typeLabel = typeLabels[file.type] || file.type;

      tr.innerHTML =
        '<td>' + this._escapeHtml(file.name) + '</td>' +
        '<td><span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:600;">' + typeLabel + '</span></td>' +
        '<td style="font-size:12px;">' + dateStr + '</td>' +
        '<td style="font-size:12px;">' + this._escapeHtml(file.uploadedBy || '-') + '</td>' +
        '<td class="action-cell"></td>';

      const actionCell = tr.querySelector('.action-cell');

      const btnDownload = document.createElement('button');
      btnDownload.className = 'btn btn-sm btn-primary';
      btnDownload.textContent = '取込';
      btnDownload.addEventListener('click', () => this._cloudDownloadAndImport(file.id, file.type));
      actionCell.appendChild(btnDownload);

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn btn-sm btn-danger';
      btnDelete.textContent = '削除';
      btnDelete.style.marginLeft = '4px';
      btnDelete.addEventListener('click', async () => {
        if (!confirm(file.name + ' を削除しますか？')) return;
        try {
          await CloudShare.deleteFile(file.id);
          this.showMessage('ファイルを削除しました', 'success');
        } catch (e) {
          this.showMessage('削除エラー: ' + e.message, 'error');
        }
      });
      actionCell.appendChild(btnDelete);

      tbody.appendChild(tr);
    });
  },

  async _cloudDownloadAndImport(fileId, type) {
    try {
      const file = await CloudShare.downloadFile(fileId);
      const data = file.data;

      switch (type) {
        case 'entries':
          if (Array.isArray(data)) {
            data.forEach(entry => {
              EntryStore.add(entry);
            });
            this.showMessage('エントリーデータを取り込みました (' + data.length + '件)', 'success');
          }
          break;

        case 'draws':
          if (data.drawResults) {
            Object.assign(this.drawResults, data.drawResults);
            if (data.confirmedEvents) Object.assign(this.confirmedEvents, data.confirmedEvents);
            localStorage.setItem('drawSystem_drawResults', JSON.stringify({
              drawResults: this.drawResults,
              confirmedEvents: this.confirmedEvents,
              savedAt: new Date().toISOString()
            }));
            this.showMessage('ドロー結果を取り込みました', 'success');
          }
          break;

        case 'tournament':
          if (Array.isArray(data)) {
            data.forEach(t => {
              TournamentStore.add(t);
            });
            this.showMessage('大会データを取り込みました (' + data.length + '件)', 'success');
          }
          break;

        case 'backup':
          // 全データバックアップの復元
          if (data['drawSystem_rankingBackup']) {
            localStorage.setItem('drawSystem_rankingBackup', JSON.stringify(data['drawSystem_rankingBackup']));
          }
          if (data['drawSystem_tournaments']) {
            localStorage.setItem('drawSystem_tournaments', JSON.stringify(data['drawSystem_tournaments']));
          }
          if (data['drawSystem_tournamentBackup']) {
            localStorage.setItem('drawSystem_tournamentBackup', JSON.stringify(data['drawSystem_tournamentBackup']));
          }
          if (data['drawSystem_entries']) {
            localStorage.setItem('drawSystem_entries', JSON.stringify(data['drawSystem_entries']));
          }
          if (data['drawSystem_drawResults']) {
            const dr = data['drawSystem_drawResults'];
            if (dr.drawResults) this.drawResults = dr.drawResults;
            if (dr.confirmedEvents) this.confirmedEvents = dr.confirmedEvents;
            localStorage.setItem('drawSystem_drawResults', JSON.stringify({
              drawResults: this.drawResults,
              confirmedEvents: this.confirmedEvents,
              savedAt: new Date().toISOString()
            }));
          }
          // データを再読み込み
          RankingLoader.restoreFromBackup();
          TournamentStore.init();
          EntryStore.init();
          this.showMessage('全データバックアップを取り込みました', 'success');
          break;

        default:
          this.showMessage('不明なファイル種別です: ' + type, 'error');
      }

      this.refreshBackupTable();
    } catch (e) {
      this.showMessage('取込エラー: ' + e.message, 'error');
    }
  },

  _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  // ================================================================
  // ふりがな管理（データ画面に統合）
  // ================================================================

  _furiganaData: [],
  _furiganaNextId: 1,
  _furiganaFilter: '',
  _furiganaSourceFilter: 'all',
  _furiganaPage: 1,
  _furiganaPageSize: 50,
  _furiganaEditingId: null,
  _furiganaSortKey: 'furigana-asc',
  _furiganaEventFilter: 'all',
  FURIGANA_STORAGE_KEY: 'drawSystem_furigana',

  /**
   * よくある日本語姓の読み辞書（上位約300姓）
   */
  SURNAME_READINGS: {
    '佐藤': 'さとう', '鈴木': 'すずき', '高橋': 'たかはし', '田中': 'たなか',
    '伊藤': 'いとう', '渡辺': 'わたなべ', '山本': 'やまもと', '中村': 'なかむら',
    '小林': 'こばやし', '加藤': 'かとう', '吉田': 'よしだ', '山田': 'やまだ',
    '佐々木': 'ささき', '松本': 'まつもと', '井上': 'いのうえ', '木村': 'きむら',
    '林': 'はやし', '斎藤': 'さいとう', '清水': 'しみず', '山口': 'やまぐち',
    '森': 'もり', '池田': 'いけだ', '橋本': 'はしもと', '阿部': 'あべ',
    '石川': 'いしかわ', '山崎': 'やまさき', '中島': 'なかじま', '前田': 'まえだ',
    '藤田': 'ふじた', '小川': 'おがわ', '後藤': 'ごとう', '岡田': 'おかだ',
    '長谷川': 'はせがわ', '村上': 'むらかみ', '近藤': 'こんどう', '石井': 'いしい',
    '坂本': 'さかもと', '遠藤': 'えんどう', '青木': 'あおき', '藤井': 'ふじい',
    '西村': 'にしむら', '福田': 'ふくだ', '太田': 'おおた', '三浦': 'みうら',
    '藤原': 'ふじわら', '岡本': 'おかもと', '松田': 'まつだ', '中川': 'なかがわ',
    '中野': 'なかの', '原田': 'はらだ', '小野': 'おの', '田村': 'たむら',
    '竹内': 'たけうち', '金子': 'かねこ', '和田': 'わだ', '中山': 'なかやま',
    '石田': 'いしだ', '上田': 'うえだ', '森田': 'もりた', '原': 'はら',
    '柴田': 'しばた', '酒井': 'さかい', '工藤': 'くどう', '横山': 'よこやま',
    '宮崎': 'みやざき', '宮本': 'みやもと', '内田': 'うちだ', '高木': 'たかぎ',
    '安藤': 'あんどう', '谷口': 'たにぐち', '大野': 'おおの', '丸山': 'まるやま',
    '今井': 'いまい', '河野': 'こうの', '藤本': 'ふじもと', '村田': 'むらた',
    '武田': 'たけだ', '上野': 'うえの', '杉山': 'すぎやま', '増田': 'ますだ',
    '小山': 'こやま', '大塚': 'おおつか', '平野': 'ひらの', '菅原': 'すがわら',
    '久保': 'くぼ', '松井': 'まつい', '千葉': 'ちば', '岩崎': 'いわさき',
    '桜井': 'さくらい', '木下': 'きのした', '野口': 'のぐち', '松尾': 'まつお',
    '菊池': 'きくち', '野村': 'のむら', '新井': 'あらい', '渡部': 'わたなべ',
    '佐野': 'さの', '杉本': 'すぎもと', '浜田': 'はまだ', '北村': 'きたむら',
    '市川': 'いちかわ', '福島': 'ふくしま', '本田': 'ほんだ', '川崎': 'かわさき',
    '樋口': 'ひぐち', '島田': 'しまだ', '片山': 'かたやま', '関': 'せき',
    '中田': 'なかた', '吉川': 'よしかわ', '大谷': 'おおたに', '平田': 'ひらた',
    '川口': 'かわぐち', '辻': 'つじ', '飯田': 'いいだ', '星野': 'ほしの',
    '富田': 'とみた', '永井': 'ながい', '望月': 'もちづき', '内山': 'うちやま',
    '永田': 'ながた', '矢野': 'やの', '川上': 'かわかみ', '田口': 'たぐち',
    '小島': 'こじま', '大西': 'おおにし', '黒田': 'くろだ', '堀': 'ほり',
    '大島': 'おおしま', '須藤': 'すどう', '服部': 'はっとり', '西田': 'にしだ',
    '沢田': 'さわだ', '西川': 'にしかわ', '関口': 'せきぐち', '北川': 'きたがわ',
    '五十嵐': 'いがらし', '山下': 'やました', '松村': 'まつむら', '吉村': 'よしむら',
    '古川': 'ふるかわ', '栗原': 'くりはら', '山内': 'やまうち', '安田': 'やすだ',
    '大久保': 'おおくぼ', '中西': 'なかにし', '田辺': 'たなべ', '水野': 'みずの',
    '久保田': 'くぼた', '川村': 'かわむら', '熊谷': 'くまがい', '土屋': 'つちや',
    '浅野': 'あさの', '野田': 'のだ', '広瀬': 'ひろせ', '岩田': 'いわた',
    '松岡': 'まつおか', '秋山': 'あきやま', '奥田': 'おくだ', '中尾': 'なかお',
    '荒木': 'あらき', '南': 'みなみ', '稲葉': 'いなば', '久米': 'くめ',
    '高田': 'たかだ', '小松': 'こまつ', '高山': 'たかやま', '馬場': 'ばば',
    '白石': 'しらいし', '長田': 'おさだ', '高野': 'たかの', '大山': 'おおやま',
    '落合': 'おちあい', '吉岡': 'よしおか', '堀内': 'ほりうち', '成田': 'なりた',
    '小池': 'こいけ', '平井': 'ひらい', '石原': 'いしはら', '大石': 'おおいし',
    '鶴田': 'つるた', '石橋': 'いしばし', '有田': 'ありた', '森本': 'もりもと',
    '田代': 'たしろ', '横田': 'よこた', '小田': 'おだ', '中原': 'なかはら',
    '足立': 'あだち', '児玉': 'こだま', '荻野': 'おぎの', '植田': 'うえだ',
    '奥村': 'おくむら', '河合': 'かわい', '深田': 'ふかだ', '今村': 'いまむら',
    '福井': 'ふくい', '尾崎': 'おざき', '古賀': 'こが', '大森': 'おおもり',
    '津田': 'つだ', '堀田': 'ほった', '上原': 'うえはら', '西山': 'にしやま',
    '伊東': 'いとう', '門田': 'かどた', '相田': 'あいだ', '片岡': 'かたおか',
    '早川': 'はやかわ', '松永': 'まつなが', '谷': 'たに', '河村': 'かわむら',
    '大橋': 'おおはし', '本間': 'ほんま', '杉浦': 'すぎうら', '岩本': 'いわもと',
    '田島': 'たじま', '黒木': 'くろき', '吉野': 'よしの', '萩原': 'はぎわら',
    '赤松': 'あかまつ',
  },

  /**
   * ふりがな管理UIの初期化（データ画面内に統合）
   */
  _initFuriganaInDataScreen() {
    this._loadFuriganaData();

    // ランキングと同期ボタン
    const btnSync = document.getElementById('btn-furigana-sync-ranking');
    if (btnSync) {
      btnSync.addEventListener('click', () => this._syncFuriganaWithRanking());
    }

    // Excel取込
    const fileImport = document.getElementById('file-furigana-import');
    if (fileImport) {
      fileImport.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this._importFuriganaExcel(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Excel出力
    const btnExport = document.getElementById('btn-furigana-export');
    if (btnExport) {
      btnExport.addEventListener('click', () => this._exportFuriganaExcel());
    }

    // Excel出力（未設定のみ）
    const btnExportMissing = document.getElementById('btn-furigana-export-missing');
    if (btnExportMissing) {
      btnExportMissing.addEventListener('click', () => this._exportMissingFuriganaExcel());
    }

    // ふりがなクリアボタン
    const btnFuriganaClear = document.getElementById('btn-furigana-clear');
    if (btnFuriganaClear) {
      btnFuriganaClear.addEventListener('click', () => {
        if (confirm('すべてのふりがなデータをクリアしますか？この操作は元に戻せません。')) {
          this._clearFuriganaData();
          this.showMessage('ふりがなデータをクリアしました', 'info');
        }
      });
    }

    // ふりがな自動付与 (kuromoji.js)
    const btnAutoAssign = document.getElementById('btn-furigana-auto-assign');
    if (btnAutoAssign) {
      btnAutoAssign.addEventListener('click', () => this._autoAssignFuriganaKuromoji());
    }

    // Google Drive ふりがな保存ボタン
    const btnFuriganaGDriveUpload = document.getElementById('btn-furigana-gdrive-upload');
    if (btnFuriganaGDriveUpload) {
      btnFuriganaGDriveUpload.addEventListener('click', async () => {
        await this._uploadFuriganaToGDrive();
      });
    }

    // Google Drive ふりがな読込ボタン
    const btnFuriganaGDriveLoad = document.getElementById('btn-furigana-gdrive-load');
    if (btnFuriganaGDriveLoad) {
      btnFuriganaGDriveLoad.addEventListener('click', async () => {
        await this._loadFuriganaFromGDrive();
      });
    }

    // 全件クリア
    const btnClear = document.getElementById('btn-furigana-clear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (this._furiganaData.length === 0) {
          this.showMessage('データがありません', 'info');
          return;
        }
        if (confirm('ふりがなデータを全件削除します。よろしいですか？')) {
          this._furiganaData = [];
          this._furiganaNextId = 1;
          this._saveFuriganaData();
          this._syncFuriganaToRankingLoader();
          this._renderFuriganaTable();
          this.showMessage('ふりがなデータを全件クリアしました', 'success');
        }
      });
    }

    // 新規追加
    const btnAdd = document.getElementById('btn-furigana-add');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => this._addFuriganaFromForm());
    }
    // Enterキーでも追加
    const nameInput = document.getElementById('furigana-add-name');
    const readingInput = document.getElementById('furigana-add-reading');
    if (nameInput) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (readingInput) readingInput.focus();
        }
      });
    }
    if (readingInput) {
      readingInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._addFuriganaFromForm();
      });
    }

    // 検索フィルター
    const searchInput = document.getElementById('furigana-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this._furiganaFilter = e.target.value.trim();
        this._furiganaPage = 1;
        this._renderFuriganaTable();
      });
    }

    // ソースフィルター
    const sourceFilter = document.getElementById('furigana-filter-source');
    if (sourceFilter) {
      sourceFilter.addEventListener('change', (e) => {
        this._furiganaSourceFilter = e.target.value;
        this._furiganaPage = 1;
        this._renderFuriganaTable();
      });
    }

    // Sort dropdown
    const sortSelect = document.getElementById('furigana-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this._furiganaSortKey = e.target.value;
        this._furiganaPage = 1;
        this._renderFuriganaTable();
      });
    }

    // Event filter
    const eventFilter = document.getElementById('furigana-filter-event');
    if (eventFilter) {
      eventFilter.addEventListener('change', (e) => {
        this._furiganaEventFilter = e.target.value;
        this._furiganaPage = 1;
        this._renderFuriganaTable();
      });
    }

    // 起動時にGoogle Driveからふりがなデータを自動読み込み
    this._autoLoadFuriganaFromGDrive();

    // ふりがな編集モーダルの初期化
    this._initFuriganaEditModal();

    this._renderFuriganaTable();
  },

  /**
   * localStorageからふりがなデータを読み込み
   */
  _loadFuriganaData() {
    try {
      const saved = localStorage.getItem(this.FURIGANA_STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data)) {
          this._furiganaData = data;
          if (data.length > 0) {
            this._furiganaNextId = Math.max(...data.map(d => d.id || 0)) + 1;
          }
        }
      }
    } catch (e) {
      console.warn('ふりがなデータの読み込みに失敗:', e);
      this._furiganaData = [];
      this._furiganaNextId = 1;
    }
    this._syncFuriganaToRankingLoader();
  },

  /**
   * localStorageにふりがなデータを保存
   */
  _saveFuriganaData() {
    try {
      localStorage.setItem(this.FURIGANA_STORAGE_KEY, JSON.stringify(this._furiganaData));
    } catch (e) {
      console.error('ふりがなデータの保存に失敗:', e);
    }
    this._updateFuriganaCountDisplay();

    // 非同期でGoogle Driveへ同期（トークンがある場合のみ）
    if (typeof GoogleDriveBackup !== 'undefined' && GoogleDriveBackup.isTokenValid()) {
      const syncStatus = document.getElementById('furigana-sync-status');
      if (syncStatus) {
        syncStatus.style.display = 'block';
        syncStatus.textContent = 'Google Driveへ同期中...';
        syncStatus.style.backgroundColor = '#f0f4ff';
        syncStatus.style.color = '#3b82f6';
      }

      const token = GoogleDriveBackup.getSavedToken();
      this._doUploadFuriganaToGDrive(token)
        .then(() => {
          if (syncStatus) {
            syncStatus.textContent = '✓ Google Drive同期完了 (' + new Date().toLocaleTimeString('ja-JP') + ')';
            syncStatus.style.backgroundColor = '#f0fdf4';
            syncStatus.style.color = '#15803d';
            setTimeout(() => { syncStatus.style.display = 'none'; }, 5000);
          }
        })
        .catch(e => {
          if (syncStatus) {
            syncStatus.textContent = '⚠ Google Drive同期失敗: ' + e.message;
            syncStatus.style.backgroundColor = '#fef2f2';
            syncStatus.style.color = '#b91c1c';
          }
        });
    }
  },

  /**
   * 起動時にGoogle Driveから自動取得（トークンが有効な場合のみ）
   */
  async _autoLoadFuriganaFromGDrive() {
    if (typeof GoogleDriveBackup === 'undefined' || !GoogleDriveBackup.isTokenValid()) return;
    try {
      const token = GoogleDriveBackup.getSavedToken();
      const folderId = await GoogleDriveBackup.getBackupFolderId(token);
      const q = `'${folderId}' in parents and name='furigana.json' and trashed=false`;
      const params = new URLSearchParams({ q, fields: 'files(id,name,modifiedTime)', pageSize: '1' });
      const res = await fetch(`${GoogleDriveBackup.DRIVE_API}/files?${params}`, { headers: GoogleDriveBackup._headers(token) });
      if (!res.ok) return;
      const result = await res.json();
      const file = result.files?.[0];
      if (!file) return;

      const dataRes = await fetch(`${GoogleDriveBackup.DRIVE_API}/files/${file.id}?alt=media`, { headers: GoogleDriveBackup._headers(token) });
      if (!dataRes.ok) return;
      const data = await dataRes.json();
      if (!data || !Array.isArray(data) || data.length === 0) return;

      // マージ: Google Driveのデータのうちローカルに存在しないものを追加
      let merged = 0;
      for (const entry of data) {
        if (!entry.name) continue;
        const existing = this._furiganaData.find(d => d.name === entry.name);
        if (!existing) {
          this._furiganaData.push({
            id: this._furiganaNextId++,
            name: entry.name,
            furigana: entry.furigana || '',
            source: entry.source || 'gdrive',
            affiliation: entry.affiliation || '',
            eventCodes: entry.eventCodes || [],
            rankingPoints: entry.rankingPoints || 0,
            rankingPosition: entry.rankingPosition || 0,
            lastUpdated: entry.lastUpdated || '',
            furiganaEdited: entry.furiganaEdited || false,
          });
          merged++;
        } else if (!existing.furigana && entry.furigana) {
          existing.furigana = entry.furigana;
          existing.source = entry.source || existing.source;
          merged++;
        }
      }
      if (merged > 0) {
        localStorage.setItem(this.FURIGANA_STORAGE_KEY, JSON.stringify(this._furiganaData));
        this._syncFuriganaToRankingLoader();
        this._renderFuriganaTable();
        console.log('Google Driveからふりがなデータを ' + merged + '件マージしました');
      }
    } catch (e) {
      console.warn('起動時のGoogle Drive自動同期に失敗しました:', e);
    }
  },

  /**
   * ふりがなデータをRankingLoaderのfuriganaMapに同期
   */
  _syncFuriganaToRankingLoader() {
    if (typeof RankingLoader !== 'undefined' && RankingLoader.furiganaMap) {
      for (const entry of this._furiganaData) {
        if (entry.name && entry.furigana) {
          RankingLoader.furiganaMap[entry.name] = entry.furigana;
        }
      }
    }
  },

  /**
   * 登録数表示を更新
   */
  _updateFuriganaCountDisplay() {
    const el = document.getElementById('furigana-count-badge');
    if (el) {
      const total = this._furiganaData.length;
      const noFurigana = this._furiganaData.filter(d => !d.furigana).length;
      el.textContent = '登録数: ' + total + '件' + (noFurigana > 0 ? '（未設定: ' + noFurigana + '件）' : '');
    }
  },

  /**
   * ランキングデータとふりがなデータを同期
   * ランキングに存在する選手をふりがなDBに追加・更新する
   */
  _syncFuriganaWithRanking() {
    if (typeof RankingLoader === 'undefined' || !RankingLoader.rankings) return;

    let updated = 0;
    let added = 0;
    let noFurigana = 0;
    const now = new Date().toISOString();

    // ランキングの全種目をイテレート
    for (const eventCode of Object.keys(RankingLoader.rankings)) {
      const players = RankingLoader.rankings[eventCode];
      if (!players) continue;

      for (const player of players) {
        if (!player.name) continue;

        const existing = this._furiganaData.find(d => d.name === player.name);

        if (existing) {
          // 既存エントリーを更新（ランキング情報のみ。ふりがなは手動編集済みなら上書きしない）
          existing.affiliation = player.affiliation || existing.affiliation || '';
          if (!existing.eventCodes) existing.eventCodes = existing.eventCode ? [existing.eventCode] : [];
          if (!existing.eventCodes.includes(eventCode)) existing.eventCodes.push(eventCode);
          delete existing.eventCode; // migrate old field
          if (!existing.rankingPosition || (player.rank && player.rank < existing.rankingPosition)) {
            existing.rankingPosition = player.rank || 0;
          }
          if (!existing.rankingPoints || (player.points && player.points > existing.rankingPoints)) {
            existing.rankingPoints = player.points || 0;
          }
          existing.lastUpdated = now;
          updated++;
        } else {
          // 新規追加
          const autoResult = this._autoAssignFurigana(player.name);
          const newEntry = {
            id: this._furiganaNextId++,
            name: player.name,
            furigana: autoResult.furigana,
            source: autoResult.success ? 'auto' : 'ranking',
            affiliation: player.affiliation || '',
            eventCodes: [eventCode],
            rankingPoints: player.points || 0,
            rankingPosition: player.rank || 0,
            lastUpdated: now,
            furiganaEdited: false,
          };
          this._furiganaData.push(newEntry);
          added++;
          if (!autoResult.success) noFurigana++;
        }
      }
    }

    this._saveFuriganaData();
    this._syncFuriganaToRankingLoader();
    this._renderFuriganaTable();

    // ステータスメッセージ表示
    const statusEl = document.getElementById('furigana-sync-status');
    const msg = '同期完了: ' + updated + '件更新、' + added + '件新規追加' +
      (noFurigana > 0 ? '（うち' + noFurigana + '件はふりがな未設定）' : '');
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.style.background = noFurigana > 0 ? '#fff3cd' : '#d4edda';
      statusEl.style.color = noFurigana > 0 ? '#856404' : '#155724';
      statusEl.textContent = msg;
      setTimeout(() => { statusEl.style.display = 'none'; }, 8000);
    }
    this.showMessage(msg, noFurigana > 0 ? 'info' : 'success');
  },

  /**
   * 氏名からふりがなを自動推定する
   * @param {string} name - 氏名（全角スペース区切り）
   * @returns {{ furigana: string, success: boolean }}
   */
  _autoAssignFurigana(name) {
    if (!name) return { furigana: '', success: false };

    // 1. RankingLoader.furiganaMap に既に存在するか確認
    if (typeof RankingLoader !== 'undefined' && RankingLoader.furiganaMap && RankingLoader.furiganaMap[name]) {
      return { furigana: RankingLoader.furiganaMap[name], success: true };
    }

    // 2. 姓辞書で推定
    const parts = name.split(/[\u3000\s]+/); // 全角・半角スペースで分割
    if (parts.length === 0) return { furigana: '', success: false };

    const surname = parts[0];
    const reading = this.SURNAME_READINGS[surname];
    if (reading) {
      // 姓の読みが見つかった場合、名の部分は「？」で表示
      const givenNamePart = parts.length > 1 ? '\u3000？' : '';
      return { furigana: reading + givenNamePart, success: true };
    }

    return { furigana: '', success: false };
  },

  /**
   * Google Driveにふりがなデータをアップロード（内部ヘルパー）
   */
  async _doUploadFuriganaToGDrive(token) {
    const folderId = await GoogleDriveBackup.getBackupFolderId(token);
    // 既存の furigana.json を検索して削除（最新を1ファイルで管理）
    const q = `'${folderId}' in parents and name='furigana.json' and trashed=false`;
    const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '5' });
    const listRes = await fetch(`${GoogleDriveBackup.DRIVE_API}/files?${params}`, { headers: GoogleDriveBackup._headers(token) });
    if (listRes.ok) {
      const listData = await listRes.json();
      for (const f of (listData.files || [])) {
        await fetch(`${GoogleDriveBackup.DRIVE_API}/files/${f.id}`, { method: 'DELETE', headers: GoogleDriveBackup._headers(token) });
      }
    }
    // 新規アップロード
    await GoogleDriveBackup.uploadBackup(token, 'furigana.json', this._furiganaData);
  },

  /**
   * Google Driveにふりがなデータを手動保存（ボタン操作）
   */
  async _uploadFuriganaToGDrive() {
    const btn = document.getElementById('btn-furigana-gdrive-upload');
    try {
      let token = GoogleDriveBackup.getSavedToken();
      if (!token) {
        // トークンがない場合は認証フロー
        const clientId = GoogleDriveBackup.getSavedClientId();
        if (!clientId) {
          this.showMessage('バックアップ画面でGoogle DriveのClient IDを設定してください', 'error');
          return;
        }
        await GoogleDriveBackup.loadGisScript();
        token = await GoogleDriveBackup.requestAccessToken(clientId);
      }
      if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
      await this._doUploadFuriganaToGDrive(token);
      this.showMessage('ふりがなデータをGoogle Driveに保存しました（' + this._furiganaData.length + '件）', 'success');
    } catch (e) {
      this.showMessage('Google Drive保存失敗: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg style="width:14px;height:14px;vertical-align:middle;margin-right:4px;display:inline-block;" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#fff"/><path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L3.45 44.7c-.8 1.4-1.2 2.95-1.2 4.5h27.5L43.65 25z" fill="#fff"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85L73.55 76.8z" fill="#fff"/><path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2L43.65 25z" fill="#fff"/><path d="M59.85 53H27.5l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2L59.85 53z" fill="#fff"/><path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.2 28h27.45c0-1.55-.4-3.1-1.2-4.5L73.4 26.5z" fill="#fff"/></svg>Driveに保存'; }
    }
  },

  /**
   * Google Driveからふりがなデータを手動読込（ボタン操作）
   */
  async _loadFuriganaFromGDrive() {
    const btn = document.getElementById('btn-furigana-gdrive-load');
    try {
      let token = GoogleDriveBackup.getSavedToken();
      if (!token) {
        const clientId = GoogleDriveBackup.getSavedClientId();
        if (!clientId) {
          this.showMessage('バックアップ画面でGoogle DriveのClient IDを設定してください', 'error');
          return;
        }
        await GoogleDriveBackup.loadGisScript();
        token = await GoogleDriveBackup.requestAccessToken(clientId);
      }
      if (btn) { btn.disabled = true; btn.textContent = '読込中...'; }

      const folderId = await GoogleDriveBackup.getBackupFolderId(token);
      const q = `'${folderId}' in parents and name='furigana.json' and trashed=false`;
      const params = new URLSearchParams({ q, fields: 'files(id,name,modifiedTime)', pageSize: '1' });
      const res = await fetch(`${GoogleDriveBackup.DRIVE_API}/files?${params}`, { headers: GoogleDriveBackup._headers(token) });
      if (!res.ok) throw new Error('Google Drive API エラー (' + res.status + ')');
      const result = await res.json();
      const file = result.files?.[0];
      if (!file) {
        this.showMessage('Google Driveにふりがなデータが見つかりません。先に「Driveに保存」してください。', 'info');
        return;
      }

      const dataRes = await fetch(`${GoogleDriveBackup.DRIVE_API}/files/${file.id}?alt=media`, { headers: GoogleDriveBackup._headers(token) });
      if (!dataRes.ok) throw new Error('ダウンロード失敗 (' + dataRes.status + ')');
      const data = await dataRes.json();

      if (!Array.isArray(data)) throw new Error('データ形式が不正です');

      // マージ or 上書き
      const mode = this._furiganaData.length > 0
        ? confirm('現在 ' + this._furiganaData.length + '件のデータがあります。\n\n「OK」= マージ（統合）\n「キャンセル」= 上書き（Google Driveのデータで置換）')
          ? 'merge' : 'overwrite'
        : 'overwrite';

      if (mode === 'overwrite') {
        this._furiganaData = data;
        if (data.length > 0) {
          this._furiganaNextId = Math.max(...data.map(d => d.id || 0)) + 1;
        }
      } else {
        let merged = 0;
        for (const entry of data) {
          if (!entry.name) continue;
          const existing = this._furiganaData.find(d => d.name === entry.name);
          if (!existing) {
            this._furiganaData.push({ ...entry, id: this._furiganaNextId++ });
            merged++;
          } else if (!existing.furigana && entry.furigana) {
            existing.furigana = entry.furigana;
            merged++;
          }
        }
      }

      localStorage.setItem(this.FURIGANA_STORAGE_KEY, JSON.stringify(this._furiganaData));
      this._syncFuriganaToRankingLoader();
      this._renderFuriganaTable();
      this._updateFuriganaCountDisplay();
      const modTime = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString('ja-JP') : '';
      this.showMessage('Google Driveから ' + data.length + '件のふりがなデータを読み込みました' + (modTime ? ' (' + modTime + ')' : ''), 'success');
    } catch (e) {
      this.showMessage('Google Drive読込失敗: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg style="width:14px;height:14px;vertical-align:middle;margin-right:4px;display:inline-block;" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#fff"/><path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L3.45 44.7c-.8 1.4-1.2 2.95-1.2 4.5h27.5L43.65 25z" fill="#fff"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85L73.55 76.8z" fill="#fff"/><path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2L43.65 25z" fill="#fff"/><path d="M59.85 53H27.5l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2L59.85 53z" fill="#fff"/><path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.2 28h27.45c0-1.55-.4-3.1-1.2-4.5L73.4 26.5z" fill="#fff"/></svg>Driveから読込'; }
    }
  },

  /**
   * フォームからふりがなを追加
   */
  _addFuriganaFromForm() {
    const nameInput = document.getElementById('furigana-add-name');
    const readingInput = document.getElementById('furigana-add-reading');
    if (!nameInput || !readingInput) return;

    const name = nameInput.value.trim();
    const furigana = readingInput.value.trim();

    if (!name) {
      this.showMessage('氏名を入力してください', 'error');
      nameInput.focus();
      return;
    }
    if (!furigana) {
      this.showMessage('ふりがなを入力してください', 'error');
      readingInput.focus();
      return;
    }

    // 重複チェック
    const existing = this._furiganaData.find(d => d.name === name);
    if (existing) {
      this.showMessage('「' + name + '」は既に登録されています', 'error');
      return;
    }

    this._furiganaData.push({
      id: this._furiganaNextId++,
      name: name,
      furigana: furigana,
      source: 'manual',
      affiliation: '',
      eventCodes: [],
      rankingPoints: 0,
      rankingPosition: 0,
      lastUpdated: new Date().toISOString(),
      furiganaEdited: true,
    });
    this._saveFuriganaData();
    this._syncFuriganaToRankingLoader();
    this._renderFuriganaTable();

    nameInput.value = '';
    readingInput.value = '';
    nameInput.focus();
    this.showMessage('ふりがなを追加しました', 'success');
  },

  /**
   * ふりがなエントリーを編集（所属も更新可能に）
   */
  _editFurigana(id, name, furigana, affiliation) {
    const entry = this._furiganaData.find(d => d.id === id);
    if (!entry) return;

    // 名前変更時の重複チェック
    if (name !== entry.name) {
      const dup = this._furiganaData.find(d => d.name === name && d.id !== id);
      if (dup) {
        this.showMessage('「' + name + '」は既に登録されています', 'error');
        return false;
      }
    }

    entry.name = name;
    entry.furigana = furigana;
    if (affiliation !== undefined) entry.affiliation = affiliation;
    entry.source = 'manual';
    entry.furiganaEdited = true;
    entry.lastUpdated = new Date().toISOString();
    this._saveFuriganaData();
    this._syncFuriganaToRankingLoader();
    return true;
  },

  /**
   * ふりがな編集モーダルを開く
   */
  _openFuriganaEditModal(entry) {
    const modal = document.getElementById('modal-furigana-edit');
    if (!modal) return;

    // フィールドに値をセット
    document.getElementById('furigana-edit-name').value = entry.name || '';
    document.getElementById('furigana-edit-reading').value = entry.furigana || '';
    document.getElementById('furigana-edit-affiliation').value = entry.affiliation || '';

    // 編集対象IDを保存
    this._furiganaEditingId = entry.id;

    // モーダル表示
    modal.style.display = 'flex';
    document.getElementById('furigana-edit-name').focus();
  },

  /**
   * ふりがな編集モーダルの初期化
   */
  _initFuriganaEditModal() {
    const modal = document.getElementById('modal-furigana-edit');
    if (!modal) return;

    // 保存ボタン
    const saveBtn = document.getElementById('btn-furigana-edit-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const nameVal = document.getElementById('furigana-edit-name').value.trim();
        const furiVal = document.getElementById('furigana-edit-reading').value.trim();
        const affilVal = document.getElementById('furigana-edit-affiliation').value.trim();

        if (!nameVal) {
          this.showMessage('氏名は必須です', 'error');
          return;
        }

        const result = this._editFurigana(this._furiganaEditingId, nameVal, furiVal, affilVal);
        if (result !== false) {
          modal.style.display = 'none';
          this._furiganaEditingId = null;
          this._renderFuriganaTable();
          this.showMessage('更新しました', 'success');
        }
      });
    }

    // 閉じるボタン（×ボタンとキャンセルボタン）
    modal.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.style.display = 'none';
        this._furiganaEditingId = null;
      });
    });

    // オーバーレイクリックで閉じる
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
        this._furiganaEditingId = null;
      }
    });

    // Enterキーで保存
    modal.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          saveBtn.click();
        } else if (e.key === 'Escape') {
          modal.style.display = 'none';
          this._furiganaEditingId = null;
        }
      });
    });
  },

  /**
   * ふりがなエントリーを削除
   */
  _deleteFurigana(id) {
    const index = this._furiganaData.findIndex(d => d.id === id);
    if (index === -1) return;

    const entry = this._furiganaData[index];
    if (!confirm('「' + entry.name + '」を削除しますか？')) return;

    this._furiganaData.splice(index, 1);
    this._saveFuriganaData();
    this._syncFuriganaToRankingLoader();
    this._renderFuriganaTable();
    this.showMessage('削除しました', 'success');
  },

  /**
   * フィルタ適用済みのふりがなデータを取得
   */
  _getFilteredFurigana() {
    let data = [...this._furiganaData];

    // 動的ソート
    const sortKey = this._furiganaSortKey || 'furigana-asc';
    switch (sortKey) {
      case 'furigana-asc':
        data.sort((a, b) => (a.furigana || '').localeCompare(b.furigana || '', 'ja'));
        break;
      case 'furigana-desc':
        data.sort((a, b) => (b.furigana || '').localeCompare(a.furigana || '', 'ja'));
        break;
      case 'name-asc':
        data.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
        break;
      case 'name-desc':
        data.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ja'));
        break;
      case 'affiliation':
        data.sort((a, b) => (a.affiliation || '').localeCompare(b.affiliation || '', 'ja'));
        break;
      case 'newest':
        data.sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));
        break;
      case 'oldest':
        data.sort((a, b) => (a.lastUpdated || '').localeCompare(b.lastUpdated || ''));
        break;
    }

    // テキストフィルター
    if (this._furiganaFilter) {
      const q = this._furiganaFilter.toLowerCase();
      data = data.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.furigana || '').toLowerCase().includes(q) ||
        (d.affiliation || '').toLowerCase().includes(q)
      );
    }

    // ソースフィルター
    if (this._furiganaSourceFilter && this._furiganaSourceFilter !== 'all') {
      if (this._furiganaSourceFilter === 'no-furigana') {
        data = data.filter(d => !d.furigana);
      } else if (this._furiganaSourceFilter === 'auto') {
        data = data.filter(d => d.source === 'auto');
      } else if (this._furiganaSourceFilter === 'manual') {
        data = data.filter(d => d.source === 'manual');
      }
    }

    // イベントフィルター
    if (this._furiganaEventFilter && this._furiganaEventFilter !== 'all') {
      const evtCode = this._furiganaEventFilter;
      data = data.filter(d => {
        const codes = d.eventCodes || (d.eventCode ? [d.eventCode] : []);
        return codes.includes(evtCode);
      });
    }

    return data;
  },

  /**
   * ソースに応じたバッジHTMLを返す
   */
  _furiganaSourceBadge(entry) {
    const source = entry.source || '';
    if (!entry.furigana) {
      return '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;background:#fee2e2;color:#991b1b;">未設定</span>';
    }
    if (source === 'manual' || entry.furiganaEdited) {
      return '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;background:#dbeafe;color:#1e40af;">手動</span>';
    }
    if (source === 'auto') {
      return '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;background:#ffedd5;color:#9a3412;">自動</span>';
    }
    if (source === 'spreadsheet') {
      return '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;background:#e5e7eb;color:#374151;">SS</span>';
    }
    if (source === 'ranking') {
      return '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;background:#fee2e2;color:#991b1b;">未設定</span>';
    }
    return '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;background:#e5e7eb;color:#374151;">-</span>';
  },

  /**
   * ふりがなテーブルを描画（新データモデル対応）
   */
  _renderFuriganaTable() {
    this._updateFuriganaCountDisplay();

    const tbody = document.getElementById('furigana-table-body');
    const paginationEl = document.getElementById('furigana-pagination');
    if (!tbody) return;

    const filtered = this._getFilteredFurigana();
    const totalPages = Math.max(1, Math.ceil(filtered.length / this._furiganaPageSize));
    if (this._furiganaPage > totalPages) this._furiganaPage = totalPages;

    const start = (this._furiganaPage - 1) * this._furiganaPageSize;
    const pageData = filtered.slice(start, start + this._furiganaPageSize);

    tbody.innerHTML = '';

    if (pageData.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" style="text-align:center;color:#999;padding:24px;">データがありません</td>';
      tbody.appendChild(tr);
    } else {
      pageData.forEach((entry, idx) => {
        const tr = document.createElement('tr');
        const rowNum = start + idx + 1;

        // Build event badges
        const eventCodes = entry.eventCodes || (entry.eventCode ? [entry.eventCode] : []);
        const evtBadges = eventCodes.length > 0 ? eventCodes.map(code => {
          const evt = (typeof AppConfig !== 'undefined' && AppConfig.EVENTS) ? AppConfig.EVENTS.find(e => e.code === code) : null;
          const label = evt ? evt.shortName : code;
          return '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;background:#e8f0fe;color:#1a56db;margin:1px;">' + (this._escapeHtml ? this._escapeHtml(label) : label) + '</span>';
        }).join('') : '-';

        // 表示モード（モーダル編集方式）
        tr.innerHTML =
          '<td>' + rowNum + '</td>' +
          '<td>' + this._esc(entry.name) + '</td>' +
          '<td>' + this._esc(entry.furigana || '') + '</td>' +
          '<td>' + evtBadges + '</td>' +
          '<td>' + this._esc(entry.affiliation || '') + '</td>' +
          '<td>' + this._furiganaSourceBadge(entry) + '</td>' +
          '<td>' +
          '<button class="btn btn-secondary btn-furigana-edit" data-id="' + entry.id + '" style="padding:4px 10px;font-size:12px;margin-right:4px;">編集</button>' +
          '<button class="btn btn-danger btn-furigana-delete" data-id="' + entry.id + '" style="padding:4px 10px;font-size:12px;">削除</button>' +
          '</td>';

        // 編集ボタン → モーダルを開く
        tr.querySelector('.btn-furigana-edit').addEventListener('click', () => {
          this._openFuriganaEditModal(entry);
        });

        // 削除ボタン
        tr.querySelector('.btn-furigana-delete').addEventListener('click', () => {
          this._deleteFurigana(entry.id);
        });

        tbody.appendChild(tr);
      });
    }

    // ページネーション
    if (paginationEl) {
      paginationEl.innerHTML = '';
      if (totalPages > 1) {
        // 前へ
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-secondary';
        prevBtn.style.cssText = 'padding:4px 12px;font-size:12px;';
        prevBtn.textContent = '< 前へ';
        prevBtn.disabled = this._furiganaPage <= 1;
        prevBtn.addEventListener('click', () => {
          this._furiganaPage--;
          this._renderFuriganaTable();
        });
        paginationEl.appendChild(prevBtn);

        // ページ情報
        const info = document.createElement('span');
        info.style.cssText = 'font-size:13px;color:#555;';
        info.textContent = this._furiganaPage + ' / ' + totalPages + ' ページ（' + filtered.length + '件）';
        paginationEl.appendChild(info);

        // 次へ
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-secondary';
        nextBtn.style.cssText = 'padding:4px 12px;font-size:12px;';
        nextBtn.textContent = '次へ >';
        nextBtn.disabled = this._furiganaPage >= totalPages;
        nextBtn.addEventListener('click', () => {
          this._furiganaPage++;
          this._renderFuriganaTable();
        });
        paginationEl.appendChild(nextBtn);
      } else if (filtered.length > 0) {
        const info = document.createElement('span');
        info.style.cssText = 'font-size:13px;color:#555;';
        info.textContent = filtered.length + '件';
        paginationEl.appendChild(info);
      }
    }
  },

  /**
   * Excelからふりがなデータを取込（新データモデル対応）
   */
  async _importFuriganaExcel(file) {
    if (typeof XLSX === 'undefined') {
      this.showMessage('SheetJSが読み込まれていません', 'error');
      return;
    }

    this._showLoadingOverlay('ふりがなデータを取込中...');
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });

      let imported = 0;
      let skipped = 0;

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (rows.length === 0) continue;

        // ヘッダー行を自動検出
        let nameCol = -1;
        let furiganaCol = -1;
        let headerRowIdx = -1;

        for (let r = 0; r < Math.min(rows.length, 10); r++) {
          const row = rows[r];
          for (let c = 0; c < row.length; c++) {
            const val = String(row[c] || '').trim();
            if (/^(名前|氏名|name)$/i.test(val) && nameCol === -1) {
              nameCol = c;
              headerRowIdx = r;
            }
            if (/^(ふりがな|フリガナ|furigana|ﾌﾘｶﾞﾅ|よみがな)$/i.test(val) && furiganaCol === -1) {
              furiganaCol = c;
              headerRowIdx = r;
            }
          }
          if (nameCol >= 0 && furiganaCol >= 0) break;
        }

        // ヘッダーが見つからない場合、最初の2列を名前・ふりがなと仮定
        if (nameCol === -1 && furiganaCol === -1 && rows.length > 1) {
          nameCol = 0;
          furiganaCol = 1;
          headerRowIdx = 0;
        }

        if (nameCol === -1 || furiganaCol === -1) continue;

        // データ行を読み込み
        for (let r = headerRowIdx + 1; r < rows.length; r++) {
          const row = rows[r];
          const name = String(row[nameCol] || '').trim();
          const furigana = String(row[furiganaCol] || '').trim();

          if (!name || !furigana) continue;

          // 重複チェック（名前で判定）
          const existing = this._furiganaData.find(d => d.name === name);
          if (existing) {
            // エクセルデータを優先し、常に上書きする
            existing.furigana = furigana;
            existing.source = 'spreadsheet';
            existing.lastUpdated = new Date().toISOString();
            imported++;
            continue;
          }

          this._furiganaData.push({
            id: this._furiganaNextId++,
            name: name,
            furigana: furigana,
            source: 'spreadsheet',
            affiliation: '',
            eventCodes: [],
            rankingPoints: 0,
            rankingPosition: 0,
            lastUpdated: new Date().toISOString(),
            furiganaEdited: false,
          });
          imported++;
        }
      }

      this._saveFuriganaData();
      this._syncFuriganaToRankingLoader();
      this._renderFuriganaTable();

      let msg = imported + '件を取り込みました';
      if (skipped > 0) msg += '（重複スキップ: ' + skipped + '件）';
      this.showMessage(msg, 'success');
    } catch (err) {
      console.error('ふりがなExcel取込エラー:', err);
      this.showMessage('取込に失敗しました: ' + err.message, 'error');
    } finally {
      this._hideLoadingOverlay();
    }
  },

  /**
   * ふりがなデータをExcel出力（新データモデル対応）
   */
  _exportFuriganaExcel() {
    if (typeof XLSX === 'undefined') {
      this.showMessage('SheetJSが読み込まれていません', 'error');
      return;
    }
    if (this._furiganaData.length === 0) {
      this.showMessage('エクスポートするデータがありません', 'info');
      return;
    }

    const sorted = [...this._furiganaData].sort((a, b) =>
      (a.furigana || '').localeCompare(b.furigana || '', 'ja')
    );

    const aoa = [['氏名', 'ふりがな', '所属', '種目', 'ランキング', 'ソース']];
    for (const entry of sorted) {
      const codes = entry.eventCodes || (entry.eventCode ? [entry.eventCode] : []);
      const evtDisplay = codes.map(code => {
        const evtInfo = AppConfig.EVENTS.find(e => e.code === code);
        return evtInfo ? evtInfo.shortName : code;
      }).join(', ');
      aoa.push([
        entry.name,
        entry.furigana || '',
        entry.affiliation || '',
        evtDisplay,
        entry.rankingPosition || '',
        entry.source || '',
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ふりがな');
    XLSX.writeFile(wb, 'ふりがなデータ.xlsx');
    this.showMessage('Excelファイルを出力しました', 'success');
  },

  /**
   * ふりがな未設定・異常値のみをExcel出力
   */
  _exportMissingFuriganaExcel() {
    if (typeof XLSX === 'undefined') {
      this.showMessage('SheetJSが読み込まれていません', 'error');
      return;
    }
    
    // 未設定 または ？を含むデータを抽出
    const targets = this._furiganaData.filter(d => !d.furigana || d.furigana.includes('？'));

    if (targets.length === 0) {
      this.showMessage('ふりがなが未設定のデータはありません', 'info');
      return;
    }

    const sorted = [...targets].sort((a, b) =>
      (a.furigana || '').localeCompare(b.furigana || '', 'ja')
    );

    const aoa = [['氏名', 'ふりがな', '所属', '種目', 'ランキング', 'ソース']];
    for (const entry of sorted) {
      const codes = entry.eventCodes || (entry.eventCode ? [entry.eventCode] : []);
      const evtDisplay = codes.map(code => {
        const evtInfo = AppConfig.EVENTS.find(e => e.code === code);
        return evtInfo ? evtInfo.shortName : code;
      }).join(', ');
      aoa.push([
        entry.name,
        entry.furigana || '',
        entry.affiliation || '',
        evtDisplay,
        entry.rankingPosition || '',
        entry.source || '',
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '未設定ふりがな');
    XLSX.writeFile(wb, 'ふりがな未設定データ.xlsx');
    this.showMessage('未設定のExcelファイルを出力しました', 'success');
  },

  /**
   * Workerを利用してふりがな自動付与
   */
  async _autoAssignFuriganaKuromoji() {
    // ふりがな未設定 または ？を含むデータを抽出
    const targets = this._furiganaData.filter(d => !d.furigana || d.furigana.includes('？'));
    if (targets.length === 0) {
      this.showMessage('ふりがなが未設定のデータはありません', 'info');
      return;
    }

    const noFuriganaCount = targets.filter(d => !d.furigana).length;
    const partialCount = targets.length - noFuriganaCount;
    let confirmMsg = `対象 ${targets.length} 件に対して自動付与を実行しますか？`;
    if (noFuriganaCount > 0) confirmMsg += `\n・未設定: ${noFuriganaCount} 件`;
    if (partialCount > 0) confirmMsg += `\n・？を含む（部分未設定）: ${partialCount} 件`;
    confirmMsg += '\n※初回実行時は辞書のダウンロードに数秒かかります。';

    if (!confirm(confirmMsg)) {
      return;
    }

    const btn = document.getElementById('btn-furigana-auto-assign');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '辞書読込中...';
    }

    try {
      // 1. Initialize or get Worker Wrapper
      if (!this._kuromojiWorkerWrapper) {
        if (btn) btn.textContent = '辞書読込中... (初回のみ数秒かかります)';
        
        this._kuromojiWorkerWrapper = {
          worker: new Worker('./js/kuromoji_worker.js'),
          callbacks: {} // To store resolving promises mapped to IDs
        };

        // Handle Worker Messages
        this._kuromojiWorkerWrapper.worker.onmessage = (e) => {
          const { type, error, results, id } = e.data;
          if (this._kuromojiWorkerWrapper.callbacks[id]) {
            if (type.endsWith('_error')) {
              this._kuromojiWorkerWrapper.callbacks[id].reject(new Error(error));
            } else {
              this._kuromojiWorkerWrapper.callbacks[id].resolve(results);
            }
            delete this._kuromojiWorkerWrapper.callbacks[id];
          }
        };

        // Promisify message sending
        this._sendWorkerMessage = (type, payload) => {
          return new Promise((resolve, reject) => {
            const id = Date.now() + Math.random().toString();
            this._kuromojiWorkerWrapper.callbacks[id] = { resolve, reject };
            this._kuromojiWorkerWrapper.worker.postMessage({ type, payload, id });
          });
        };

        // Pre-warm / initialize dictionary
        await this._sendWorkerMessage('init', null);
      }

      if (btn) btn.textContent = '解析中...';

      let updated = 0;
      let processed = 0;
      const total = targets.length;
      const now = new Date().toISOString();
      const CHUNK_SIZE = 50; // Parse in chunks to update UI periodically

      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE);
        
        // UI updates
        if (btn) btn.textContent = `解析中... (${processed}/${total})`;
        
        // We only extract the names that need full processing for now to keep the payload clean
        const namesToParse = chunk.map(t => t.name);
        
        // Send batch to worker
        const furiganaResults = await this._sendWorkerMessage('tokenize', namesToParse);
        
        // Apply results back to targets
        for (let j = 0; j < chunk.length; j++) {
          const target = chunk[j];
          const newFurigana = furiganaResults[j];

          // Same logic: if it has "？", merge with what the tokenizer outputs.
          if (target.furigana && target.furigana.includes('？')) {
             const existingParts = target.furigana.split(/[\s　]+/);
             const newPartsArray = newFurigana ? newFurigana.split(/[\s　]+/) : [];
             const mergedParts = [];
             
             for (let k = 0; k < Math.max(existingParts.length, newPartsArray.length); k++) {
                const ep = existingParts[k] || '';
                const np = newPartsArray[k] || '';
                if (ep.includes('？') && np) {
                  mergedParts.push(np); // Use tokenizer output
                } else if (ep) {
                  mergedParts.push(ep); // Keep existing
                } else {
                  mergedParts.push(np);
                }
             }
             const finalFurigana = mergedParts.join('\u3000');
             if (finalFurigana && finalFurigana !== target.furigana) {
               target.furigana = finalFurigana;
               target.source = 'auto';
               target.lastUpdated = now;
               updated++;
             }
          } else {
            // Unset
            if (newFurigana) {
               target.furigana = newFurigana;
               target.source = 'auto';
               target.lastUpdated = now;
               updated++;
            }
          }
          processed++;
        }
      }

      this._saveFuriganaData();
      this._syncFuriganaToRankingLoader();
      this._renderFuriganaTable();
      this.showMessage(`${updated} 件のふりがなを自動付与しました`, 'success');

    } catch (err) {
      console.error('Worker Kuromoji Error:', err);
      this.showMessage('自動付与に失敗しました: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🪄 ふりがな自動付与 (AI)';
      }
    }
  },

  /**
   * ふりがなDBから名前を検索（外部から利用可能）
   * @param {string} name - 検索する名前
   * @returns {string|null} ふりがな、見つからなければnull
   */
  lookupFurigana(name) {
    if (!name) return null;
    const entry = this._furiganaData.find(d => d.name === name);
    return entry ? entry.furigana : null;
  },

  // ================================================================
  // Google ドライブ バックアップ
  // ================================================================

  _initGoogleDriveBackup() {
    const statusEl = document.getElementById('gdrive-backup-status');
    const setupArea = document.getElementById('gdrive-setup');
    const clientIdSetup = document.getElementById('gdrive-clientid-setup');
    const reconnectSetup = document.getElementById('gdrive-reconnect-setup');
    const controlsArea = document.getElementById('gdrive-backup-controls');
    const clientIdInput = document.getElementById('gdrive-client-id-input');
    const btnConnect = document.getElementById('btn-gdrive-connect');
    const btnReconnect = document.getElementById('btn-gdrive-reconnect');
    const btnResetClientId = document.getElementById('btn-gdrive-reset-clientid');
    const btnDisconnect = document.getElementById('btn-gdrive-disconnect');
    const btnSave = document.getElementById('btn-gdrive-backup-save');
    const btnImportLatest = document.getElementById('btn-gdrive-backup-import-latest');
    const btnRefresh = document.getElementById('btn-gdrive-backup-refresh');
    const folderLink = document.getElementById('gdrive-folder-link');

    if (!btnConnect) return;

    const savedClientId = GoogleDriveBackup.getSavedClientId();

    // 保存済み Client ID がある場合の表示切り替え
    if (savedClientId) {
      if (clientIdSetup) clientIdSetup.style.display = 'none';
      if (reconnectSetup) reconnectSetup.style.display = 'block';

      // トークンが有効ならば自動接続
      if (GoogleDriveBackup.isTokenValid()) {
        this._gdriveConnect(GoogleDriveBackup.getSavedToken());
      }
    }

    // Client ID 入力 → 接続
    const doConnect = async (clientId) => {
      try {
        await GoogleDriveBackup.loadGisScript();
        const token = await GoogleDriveBackup.requestAccessToken(clientId);
        GoogleDriveBackup.saveClientId(clientId);
        this._gdriveConnect(token);
        this.showMessage('Google ドライブに接続しました', 'success');
      } catch (e) {
        this.showMessage('接続失敗: ' + (e.message || e), 'error');
      }
    };

    btnConnect.addEventListener('click', async () => {
      const clientId = clientIdInput.value.trim();
      if (!clientId) return;
      btnConnect.disabled = true;
      btnConnect.textContent = '認証中...';
      await doConnect(clientId);
      btnConnect.disabled = false;
      btnConnect.textContent = 'Google で認証';
    });

    if (btnReconnect) {
      btnReconnect.addEventListener('click', async () => {
        btnReconnect.disabled = true;
        btnReconnect.textContent = '接続中...';
        try {
          await GoogleDriveBackup.loadGisScript();
          const token = await GoogleDriveBackup.requestAccessToken(savedClientId);
          this._gdriveConnect(token);
          this.showMessage('Google ドライブに再接続しました', 'success');
        } catch (e) {
          this.showMessage('接続失敗: ' + (e.message || e), 'error');
        } finally {
          btnReconnect.disabled = false;
          btnReconnect.textContent = 'Google ドライブに再接続';
        }
      });
    }

    if (btnResetClientId) {
      btnResetClientId.addEventListener('click', () => {
        GoogleDriveBackup.clearClientId();
        GoogleDriveBackup.clearToken();
        if (clientIdSetup) clientIdSetup.style.display = 'block';
        if (reconnectSetup) reconnectSetup.style.display = 'none';
        if (setupArea) setupArea.style.display = 'block';
        if (controlsArea) controlsArea.style.display = 'none';
        if (statusEl) { statusEl.textContent = '未接続'; statusEl.style.color = ''; }
      });
    }

    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
        const token = GoogleDriveBackup.getSavedToken();
        if (token) GoogleDriveBackup.revokeToken(token);
        if (setupArea) setupArea.style.display = 'block';
        if (controlsArea) controlsArea.style.display = 'none';
        if (clientIdSetup) clientIdSetup.style.display = 'none';
        if (reconnectSetup) reconnectSetup.style.display = 'block';
        if (statusEl) { statusEl.textContent = '未接続'; statusEl.style.color = ''; }
      });
    }

    // エクスポート
    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        const token = GoogleDriveBackup.getSavedToken();
        if (!token) { this.showMessage('Google ドライブに接続してください', 'error'); return; }
        btnSave.disabled = true;
        btnSave.textContent = 'エクスポート中...';
        try {
          const data = await this._buildAllBackupData();
          const now = new Date();
          const fileName = `full-backup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;
          await GoogleDriveBackup.uploadBackup(token, fileName, data);
          this.showMessage('Google ドライブに保存しました: ' + fileName, 'success');
          await this._refreshGDriveBackupList();
        } catch (e) {
          this.showMessage('保存失敗: ' + e.message, 'error');
        } finally {
          btnSave.disabled = false;
          btnSave.textContent = 'Google ドライブにエクスポート';
        }
      });
    }

    // 最新インポート
    if (btnImportLatest) {
      btnImportLatest.addEventListener('click', async () => {
        const token = GoogleDriveBackup.getSavedToken();
        if (!token) { this.showMessage('Google ドライブに接続してください', 'error'); return; }
        btnImportLatest.disabled = true;
        btnImportLatest.textContent = '取得中...';
        try {
          const files = await GoogleDriveBackup.listBackups(token);
          if (!files || files.length === 0) {
            this.showMessage('バックアップが見つかりません', 'error');
            return;
          }
          const latest = files[0];
          if (!confirm(`最新のバックアップ「${latest.name}」からインポートしますか？\n現在のデータは全て上書きされます。`)) return;
          this._showLoadingOverlay('最新バックアップをインポート中...');
          const data = await GoogleDriveBackup.downloadBackup(token, latest);
          await this._restoreAllBackupData(data);
          this.showMessage('最新バックアップからインポートしました。画面をリロードします。', 'success');
          setTimeout(() => location.reload(), 2000);
        } catch (e) {
          this.showMessage('インポート失敗: ' + e.message, 'error');
        } finally {
          this._hideLoadingOverlay();
          btnImportLatest.disabled = false;
          btnImportLatest.textContent = 'Google ドライブからインポート（最新）';
        }
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => this._refreshGDriveBackupList());
    }
  },

  async _gdriveConnect(token) {
    const setupArea = document.getElementById('gdrive-setup');
    const controlsArea = document.getElementById('gdrive-backup-controls');
    const statusEl = document.getElementById('gdrive-backup-status');
    const folderLink = document.getElementById('gdrive-folder-link');

    if (setupArea) setupArea.style.display = 'none';
    if (controlsArea) controlsArea.style.display = 'block';

    try {
      const email = await GoogleDriveBackup.getUserEmail(token);
      if (statusEl) {
        statusEl.textContent = email || '接続完了';
        statusEl.style.color = '#28a745';
      }
    } catch {
      if (statusEl) { statusEl.textContent = '接続完了'; statusEl.style.color = '#28a745'; }
    }

    try {
      const link = await GoogleDriveBackup.getSharedFolderLink(token);
      if (folderLink) {
        folderLink.href = link;
        folderLink.style.display = 'inline';
      }
    } catch { /* ignore */ }

    await this._refreshGDriveBackupList();
  },

  async _refreshGDriveBackupList() {
    const tbody = document.getElementById('gdrive-backup-list-body');
    if (!tbody) return;
    const token = GoogleDriveBackup.getSavedToken();
    if (!token) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">未接続</td></tr>';
      return;
    }
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">読込中...</td></tr>';

    try {
      const files = await GoogleDriveBackup.listBackups(token);
      tbody.innerHTML = '';
      if (files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">バックアップはありません</td></tr>';
        return;
      }
      files.forEach(file => {
        const tr = document.createElement('tr');
        const sizeKB = Math.round(Number(file.size) / 1024);
        const modTime = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString('ja-JP') : '-';
        tr.innerHTML = `
          <td style="font-size:12px;">${file.name}</td>
          <td style="font-size:12px;">${modTime}</td>
          <td style="font-size:12px;">${sizeKB} KB</td>
          <td>
            <button class="btn btn-sm btn-primary btn-restore" style="padding:2px 8px;">復元</button>
            <button class="btn btn-sm btn-danger btn-delete" style="padding:2px 8px;margin-left:4px;">削除</button>
          </td>
        `;
        tr.querySelector('.btn-restore').addEventListener('click', () => this._restoreFromGDrive(file));
        tr.querySelector('.btn-delete').addEventListener('click', () => this._deleteFromGDrive(file));
        tbody.appendChild(tr);
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#dc3545;">一覧取得エラー: ${e.message}</td></tr>`;
    }
  },

  async _restoreFromGDrive(file) {
    if (!confirm(`Google ドライブ上のバックアップ「${file.name}」から復元しますか？\n現在のデータは全て上書きされます。`)) return;
    const token = GoogleDriveBackup.getSavedToken();
    this._showLoadingOverlay('データを復元中...');
    try {
      const data = await GoogleDriveBackup.downloadBackup(token, file);
      await this._restoreAllBackupData(data);
      this.showMessage('Google ドライブから復元しました。画面をリロードしてください。', 'success');
      setTimeout(() => location.reload(), 2000);
    } catch (e) {
      this.showMessage('復元失敗: ' + e.message, 'error');
    } finally {
      this._hideLoadingOverlay();
    }
  },

  async _deleteFromGDrive(file) {
    if (!confirm(`バックアップ「${file.name}」を削除しますか？`)) return;
    const token = GoogleDriveBackup.getSavedToken();
    try {
      await GoogleDriveBackup.deleteBackup(token, file);
      this.showMessage('削除しました', 'success');
      await this._refreshGDriveBackupList();
    } catch (e) {
      this.showMessage('削除失敗: ' + e.message, 'error');
    }
  },

  // ================================================================
  // GitHub 全データバックアップ
  // ================================================================

  _initGitHubBackup() {
    const tokenInput = document.getElementById('github-backup-token');
    const btnConnect = document.getElementById('btn-github-backup-connect');
    const btnDisconnect = document.getElementById('btn-github-backup-disconnect');
    const btnSave = document.getElementById('btn-github-backup-save');
    const btnRefresh = document.getElementById('btn-github-backup-refresh');
    const setupArea = document.getElementById('github-backup-setup');
    const controlsArea = document.getElementById('github-backup-controls');
    const statusEl = document.getElementById('github-backup-status');

    if (GitHubBackup.config.token) {
      this._githubBackupConnect(GitHubBackup.config.token);
    }

    if (btnConnect) {
      btnConnect.addEventListener('click', async () => {
        const token = tokenInput.value.trim();
        if (!token) return;
        btnConnect.disabled = true;
        btnConnect.textContent = '接続中...';
        try {
          const ok = await GitHubBackup.validateToken(token);
          if (ok) {
            GitHubBackup.saveToken(token);
            this._githubBackupConnect(token);
            this.showMessage('GitHubに接続しました', 'success');
          } else {
            this.showMessage('トークンが無効、または権限が不足しています', 'error');
          }
        } catch (e) {
          this.showMessage('接続エラー: ' + e.message, 'error');
        } finally {
          btnConnect.disabled = false;
          btnConnect.textContent = '接続';
        }
      });
    }

    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
        GitHubBackup.saveToken('');
        setupArea.style.display = 'block';
        controlsArea.style.display = 'none';
        statusEl.textContent = '未接続';
        statusEl.style.color = '';
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        btnSave.disabled = true;
        btnSave.textContent = 'エクスポート中...';
        try {
          const data = await this._buildAllBackupData();
          const now = new Date();
          const fileName = `full-backup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;
          
          await GitHubBackup.uploadBackup(fileName, data);
          this.showMessage('GitHubに保存しました: ' + fileName, 'success');
          await this._refreshGitHubBackupList();
        } catch (e) {
          this.showMessage('保存失敗: ' + e.message, 'error');
        } finally {
          btnSave.disabled = false;
          btnSave.textContent = 'GitHubにエクスポート';
        }
      });
    }

    const btnImportLatest = document.getElementById('btn-github-backup-import-latest');
    if (btnImportLatest) {
      btnImportLatest.addEventListener('click', async () => {
        btnImportLatest.disabled = true;
        btnImportLatest.textContent = '取得中...';
        try {
          const files = await GitHubBackup.listBackups();
          if (!files || files.length === 0) {
            this.showMessage('バックアップが見つかりません', 'error');
            return;
          }
          const latest = files[0];
          if (!confirm(`最新のバックアップ「${latest.name}」からインポートしますか？\n現在のデータは全て上書きされます。`)) return;
          this._showLoadingOverlay('最新バックアップをインポート中...');
          const data = await GitHubBackup.downloadBackup(latest);
          await this._restoreAllBackupData(data);
          this.showMessage('最新バックアップからインポートしました。画面をリロードします。', 'success');
          setTimeout(() => location.reload(), 2000);
        } catch (e) {
          this.showMessage('インポート失敗: ' + e.message, 'error');
        } finally {
          this._hideLoadingOverlay();
          btnImportLatest.disabled = false;
          btnImportLatest.textContent = 'GitHubからインポート（最新）';
        }
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => this._refreshGitHubBackupList());
    }
  },

  async _githubBackupConnect(token) {
    const setupArea = document.getElementById('github-backup-setup');
    const controlsArea = document.getElementById('github-backup-controls');
    const statusEl = document.getElementById('github-backup-status');
    
    if (setupArea) setupArea.style.display = 'none';
    if (controlsArea) controlsArea.style.display = 'block';
    if (statusEl) {
      statusEl.textContent = '接続完了';
      statusEl.style.color = '#28a745';
    }
    await this._refreshGitHubBackupList();
  },

  async _refreshGitHubBackupList() {
    const tbody = document.getElementById('github-backup-list-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#888;">読込中...</td></tr>';

    try {
      const files = await GitHubBackup.listBackups();
      tbody.innerHTML = '';
      if (files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#888;">バックアップはありません</td></tr>';
        return;
      }

      files.forEach(file => {
        const tr = document.createElement('tr');
        const sizeKB = Math.round(file.size / 1024);
        tr.innerHTML = `
          <td style="font-size:12px;">${file.name}</td>
          <td style="font-size:12px;">${sizeKB} KB</td>
          <td>
            <button class="btn btn-sm btn-primary btn-restore" style="padding:2px 8px;">復元</button>
            <button class="btn btn-sm btn-danger btn-delete" style="padding:2px 8px;margin-left:4px;">削除</button>
          </td>
        `;

        tr.querySelector('.btn-restore').addEventListener('click', () => this._restoreFromGitHub(file));
        tr.querySelector('.btn-delete').addEventListener('click', () => this._deleteFromGitHub(file));
        tbody.appendChild(tr);
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#dc3545;">一覧取得エラー: ${e.message}</td></tr>`;
    }
  },

  async _restoreFromGitHub(file) {
    if (!confirm(`GitHub上のバックアップ「${file.name}」から復元しますか？\n現在のデータは全て上書きされます。`)) return;
    
    this._showLoadingOverlay('データを復元中...');
    try {
      const data = await GitHubBackup.downloadBackup(file);
      await this._restoreAllBackupData(data);
      this.showMessage('GitHubから復元しました。画面をリロードしてください。', 'success');
      setTimeout(() => location.reload(), 2000);
    } catch (e) {
      this.showMessage('復元失敗: ' + e.message, 'error');
    } finally {
      this._hideLoadingOverlay();
    }
  },

  async _deleteFromGitHub(file) {
    if (!confirm(`バックアップ「${file.name}」を削除しますか？`)) return;
    try {
      await GitHubBackup.deleteBackup(file);
      this.showMessage('削除しました', 'success');
      await this._refreshGitHubBackupList();
    } catch (e) {
      this.showMessage('削除失敗: ' + e.message, 'error');
    }
  },

  /**
   * 全データバックアップ用データの生成
   */
  async _buildAllBackupData() {
    return {
      version: '2.3',
      exportedAt: new Date().toISOString(),
      entries: EntryStore.entries,
      tournaments: TournamentStore.tournaments,
      rankingBackup: JSON.parse(localStorage.getItem('drawSystem_rankingBackup') || '{}'),
      furigana: JSON.parse(localStorage.getItem('drawSystem_furigana') || '[]'),
      drawResults: this.drawResults,
      confirmedEvents: this.confirmedEvents
    };
  },

  /**
   * 全データバックアップからの復元
   */
  async _restoreAllBackupData(data) {
    if (!data || !data.entries) throw new Error('無効なバックアップデータです');

    localStorage.setItem('drawSystem_entries', JSON.stringify(data.entries));
    localStorage.setItem('drawSystem_tournaments', JSON.stringify(data.tournaments || []));
    localStorage.setItem('drawSystem_rankingBackup', JSON.stringify(data.rankingBackup || {}));
    localStorage.setItem('drawSystem_furigana', JSON.stringify(data.furigana || []));
    localStorage.setItem('drawSystem_drawResults', JSON.stringify(data.drawResults || {}));
    
    // インメモリのデータを更新
    EntryStore.entries = data.entries;
    TournamentStore.tournaments = data.tournaments || [];
    this.drawResults = data.drawResults || {};
    this.confirmedEvents = data.confirmedEvents || {};
  },
};

// DOMContentLoaded で初期化
document.addEventListener('DOMContentLoaded', () => App.init());
