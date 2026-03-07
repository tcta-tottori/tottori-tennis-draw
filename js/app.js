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

    // 各画面の初期化
    this.initDataScreen();
    this.initRankingScreen();
    this.initOCRScreen();
    this.initEntryScreen();
    this.initEventsScreen();
    this.initDrawScreen();
    this.initBracketScreen();
    this.initManualScreen();

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
        gsRankingStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">バックアップから復元: ' + status.total + '名</span>';
      }
      const gsFuriganaStatus = document.getElementById('gs-furigana-status');
      const furiganaCount = Object.keys(RankingLoader.furiganaMap).length;
      if (gsFuriganaStatus && furiganaCount > 0) {
        gsFuriganaStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">バックアップから復元: ' + furiganaCount + '件</span>';
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
        if (gsRankingStatus) {
          gsRankingStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">最新データ読込済: ' + status.total + '名</span>';
        }
      }
      const furiInput = document.getElementById('gs-furigana-url');
      if (furiInput && furiInput.value.trim()) {
        await RankingLoader.loadFuriganaFromSpreadsheet(furiInput.value.trim());
        const count = Object.keys(RankingLoader.furiganaMap).length;
        const gsFuriganaStatus = document.getElementById('gs-furigana-status');
        if (gsFuriganaStatus) {
          gsFuriganaStatus.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">最新データ読込済: ' + count + '件</span>';
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
    if (screenId === 'screen-events') this.refreshEventsScreen();
    if (screenId === 'screen-draw') this._refreshDrawEventSelect();
    if (screenId === 'screen-bracket') this._refreshBracketEventSelect();
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
  },

  async _loadRankingFromGS() {
    const urlInput = document.getElementById('gs-ranking-url');
    const statusEl = document.getElementById('gs-ranking-status');
    const btnEl = document.getElementById('btn-gs-ranking');
    if (!urlInput || !urlInput.value.trim()) {
      this.showMessage('スプレッドシートのURLまたはIDを入力してください', 'error');
      return;
    }

    // URL保存
    try { localStorage.setItem('drawSystem_gsRankingUrl', urlInput.value.trim()); } catch (e) {}

    // ローディング表示
    if (statusEl) {
      statusEl.innerHTML = '<span class="status-icon status-pending" style="animation:pulse 1s infinite;">&#9679;</span><span class="status-text">読込中...</span>';
    }
    if (btnEl) btnEl.disabled = true;

    try {
      const status = await RankingLoader.loadRankingFromSpreadsheet(urlInput.value.trim());
      this._updateRankingStatus(status);
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">読込済: ' + status.total + '名</span>';
      }
      this.showMessage('スプレッドシートからランキングデータを読み込みました (' + status.total + '名)', 'success');
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-icon status-error">&#9679;</span><span class="status-text">エラー: ' + err.message + '</span>';
      }
      this.showMessage('読み込み失敗: ' + err.message, 'error');
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  },

  async _loadFuriganaFromGS() {
    const urlInput = document.getElementById('gs-furigana-url');
    const statusEl = document.getElementById('gs-furigana-status');
    const btnEl = document.getElementById('btn-gs-furigana');
    if (!urlInput || !urlInput.value.trim()) {
      this.showMessage('スプレッドシートのURLまたはIDを入力してください', 'error');
      return;
    }

    try { localStorage.setItem('drawSystem_gsFuriganaUrl', urlInput.value.trim()); } catch (e) {}

    if (statusEl) {
      statusEl.innerHTML = '<span class="status-icon status-pending" style="animation:pulse 1s infinite;">&#9679;</span><span class="status-text">読込中...</span>';
    }
    if (btnEl) btnEl.disabled = true;

    try {
      await RankingLoader.loadFuriganaFromSpreadsheet(urlInput.value.trim());
      const count = Object.keys(RankingLoader.furiganaMap).length;
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-icon status-ok">&#9679;</span><span class="status-text">読込済: ' + count + '件</span>';
      }
      this.showMessage('スプレッドシートからふりがなデータを読み込みました (' + count + '件)', 'success');
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-icon status-error">&#9679;</span><span class="status-text">エラー: ' + err.message + '</span>';
      }
      this.showMessage('読み込み失敗: ' + err.message, 'error');
    } finally {
      if (btnEl) btnEl.disabled = false;
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
      if (playerCount) playerCount.textContent = status.total;
      let evtCount = 0;
      const detailLines = [];
      for (const evt of AppConfig.EVENTS) {
        if (status[evt.code] && status[evt.code].count > 0) {
          evtCount++;
          detailLines.push(evt.shortName + ': ' + status[evt.code].count + '名');
        }
      }
      if (eventCount) eventCount.textContent = evtCount;
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

      const allBtn = document.createElement('button');
      allBtn.className = 'btn btn-sm ' + (!this._rankingFilter.showList && this._rankingFilter.eventCode === '' ? 'btn-primary' : 'btn-secondary');
      allBtn.textContent = '全種目';
      allBtn.addEventListener('click', () => {
        this._rankingFilter.eventCode = '';
        this._rankingFilter.showList = false;
        this.refreshRankingTable();
      });
      tabsEl.appendChild(allBtn);

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

      tr.innerHTML =
        '<td class="text-center">' + (p.rank === '-' ? '<span style="color:#9ca3af;">-</span>' : p.rank) + '</td>' +
        '<td><strong>' + this._esc(p.name) + '</strong></td>' +
        '<td style="color:#6b7280;font-size:13px;">' + this._esc(furigana) + '</td>' +
        '<td>' + this._esc(p.affiliation || '') + '</td>' +
        '<td class="text-center">' + (p.points || '-') + '</td>' +
        '<td>' + (evtObj ? '<span class="event-badge event-badge-' + p.eventCode + '">' + evtObj.shortName + '</span>' : '<span style="color:#9ca3af;font-size:12px;">未登録</span>') + '</td>' +
        '<td class="action-cell"></td>';

      const actionCell = tr.querySelector('.action-cell');

      if (isEntered) {
        const badge = document.createElement('span');
        badge.className = 'entered-badge';
        badge.textContent = '登録済';
        actionCell.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-entry-quick';
        btn.textContent = 'エントリー';
        btn.addEventListener('click', () => this._quickEntry(p));
        actionCell.appendChild(btn);
      }

      tbody.appendChild(tr);
    });
  },

  /**
   * ランキング画面からのクイックエントリー
   */
  _quickEntry(player) {
    // 種目が決まっている場合は確認のみで登録
    if (player.eventCode) {
      const furigana = player.furigana || RankingLoader.furiganaMap[player.name] || '';
      EntryStore.add({
        name: player.name,
        furigana: furigana,
        affiliation: player.affiliation || '',
        eventCode: player.eventCode,
        points: player.points || 0,
      });
      // リストにない人は自動追加
      RankingLoader.addToFuriganaMap(player.name, furigana);
      this.showMessage(player.name + ' を ' + (AppConfig.EVENTS.find(e => e.code === player.eventCode)?.shortName || player.eventCode) + ' にエントリーしました', 'success');
      this._renderRankingRows();
    } else {
      // 種目未定（リスト登録者）→ モーダルで種目選択
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

    try {
      // Tesseract.js が読み込まれているか確認
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
    } catch (err) {
      console.error(err);
      this.showMessage('OCR認識に失敗しました: ' + err.message, 'error');
    } finally {
      if (progressEl) progressEl.style.display = 'none';
    }
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
  // エントリー一覧画面
  // ================================================================

  initEntryScreen() {
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
        document.getElementById('entry-event').value = entry.eventCode || '';
        document.getElementById('entry-point').value = entry.points || 0;
      }
    } else {
      if (title) title.textContent = 'エントリー追加';
      document.getElementById('entry-name').value = '';
      document.getElementById('entry-furigana').value = '';
      document.getElementById('entry-club').value = '';
      document.getElementById('entry-point').value = 0;
      // エントリーが1種目のみの場合はその種目を自動選択
      const allEntries = EntryStore.getAll();
      const entryEventCodes = [...new Set(allEntries.map(e => e.eventCode))];
      const evtSelect = document.getElementById('entry-event');
      if (evtSelect) {
        evtSelect.value = entryEventCodes.length === 1 ? entryEventCodes[0] : '';
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

    const results = RankingLoader.searchPlayers(query);
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
        document.getElementById('entry-event').value = p.eventCode || '';
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

    // エントリー済み種目を取得
    const allEntries = EntryStore.getAll();
    const entryEventCodes = [...new Set(allEntries.map(e => e.eventCode))];

    // 種目フィルターを動的に構築（エントリーがある種目のみ）
    const filterSelect = document.getElementById('entry-event-filter');
    if (filterSelect) {
      const prevValue = filterSelect.value;
      filterSelect.innerHTML = '<option value="">全種目</option>';
      for (const code of entryEventCodes) {
        const evt = AppConfig.EVENTS.find(e => e.code === code);
        const count = allEntries.filter(e => e.eventCode === code).length;
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = (evt ? evt.name : code) + ' (' + count + ')';
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

    // ランキング順（ポイント降順）でソート
    entries.sort((a, b) => (b.points || 0) - (a.points || 0));

    tbody.innerHTML = '';
    if (totalCount) totalCount.textContent = entries.length;

    // シード・ドロー情報の表示（フィルター下部）
    const seedInfoEl = document.getElementById('entry-seed-info');
    if (seedInfoEl) {
      seedInfoEl.innerHTML = '';
      const targetCode = filter || (entryEventCodes.length === 1 ? entryEventCodes[0] : '');
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

    entries.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      if (idx < 30) {
        tr.classList.add('row-enter');
        tr.style.animationDelay = (idx * 20) + 'ms';
      }
      const evtObj = AppConfig.EVENTS.find(e => e.code === entry.eventCode);
      const evtName = evtObj ? evtObj.shortName : entry.eventCode;

      tr.innerHTML =
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + this._esc(entry.name) + '</td>' +
        '<td>' + this._esc(entry.furigana || '') + '</td>' +
        '<td>' + this._esc(entry.affiliation || '') + '</td>' +
        '<td>' + this._esc(evtName) + '</td>' +
        '<td>' + (entry.points || 0) + '</td>' +
        '<td class="action-cell"></td>';

      const actionCell = tr.querySelector('.action-cell');

      // 編集ボタン
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-sm btn-secondary';
      btnEdit.textContent = '編集';
      btnEdit.addEventListener('click', () => this._showEntryModal(entry.id));
      actionCell.appendChild(btnEdit);

      // 削除ボタン
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
  },

  // ================================================================
  // 種目別確認画面
  // ================================================================

  initEventsScreen() {
    // 初期状態はリフレッシュ時に構築
  },

  refreshEventsScreen() {
    const tabsContainer = document.getElementById('event-tabs');
    const detailEl = document.getElementById('event-detail');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = '';

    let hasEntries = false;
    for (const evt of AppConfig.EVENTS) {
      const entries = EntryStore.getByEvent(evt.code);
      if (entries.length === 0) continue;
      hasEntries = true;

      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary event-tab-btn';
      btn.textContent = evt.shortName + ' (' + entries.length + ')';
      btn.addEventListener('click', () => {
        // タブのアクティブ状態
        tabsContainer.querySelectorAll('.event-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._showEventDetail(evt.code);
      });
      tabsContainer.appendChild(btn);
    }

    if (!hasEntries) {
      tabsContainer.innerHTML = '<p class="empty-message">エントリーデータがありません。</p>';
      if (detailEl) detailEl.style.display = 'none';
    } else {
      // 最初の種目を自動選択
      const firstBtn = tabsContainer.querySelector('.event-tab-btn');
      if (firstBtn) firstBtn.click();
    }
  },

  _showEventDetail(eventCode) {
    const detailEl = document.getElementById('event-detail');
    if (!detailEl) return;
    detailEl.style.display = '';

    const evt = AppConfig.EVENTS.find(e => e.code === eventCode);
    const entries = EntryStore.getByEvent(eventCode);
    const sorted = [...entries].sort((a, b) => (b.points || 0) - (a.points || 0));
    const drawSize = entries.length > 3 ? DrawEngine.getDrawSize(entries.length) : '-';
    const seedCount = entries.length > 3 && drawSize !== '-' && AppConfig.SEED_RULES[drawSize]
      ? AppConfig.SEED_RULES[drawSize].seeds : '-';

    document.getElementById('event-detail-name').textContent = evt ? evt.name : eventCode;
    document.getElementById('event-entry-count').textContent = entries.length;
    document.getElementById('event-draw-size').textContent = drawSize;
    document.getElementById('event-seed-count').textContent = seedCount;

    const tbody = document.getElementById('event-entry-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    sorted.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + this._esc(entry.name) + '</td>' +
        '<td>' + this._esc(entry.affiliation || '') + '</td>' +
        '<td>' + (entry.points || 0) + '</td>';
      tbody.appendChild(tr);
    });
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

    // 全種目一括（自動）
    const btnAllDraw = document.getElementById('btn-all-draw');
    if (btnAllDraw) {
      btnAllDraw.addEventListener('click', () => this._executeAllDraws());
    }
  },

  // 手動配置用の一時データ
  _manualDraw: null,        // ドロー配列
  _unplacedPlayers: [],     // 未配置選手リスト
  _selectedPlayer: null,    // 選択中の選手

  _refreshDrawEventSelect() {
    const select = document.getElementById('draw-event-select');
    if (!select) return;
    select.innerHTML = '';
    let firstCode = '';
    for (const evt of AppConfig.EVENTS) {
      const entries = EntryStore.getByEvent(evt.code);
      if (entries.length > 3) {
        const opt = document.createElement('option');
        opt.value = evt.code;
        opt.textContent = evt.name + ' (' + entries.length + '名)';
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
    const entries = EntryStore.getByEvent(eventCode);
    if (entries.length <= 3) {
      if (lotterySection) lotterySection.style.display = 'none';
      this.showMessage('エントリーが4名以上必要です', 'error');
      return;
    }

    if (lotterySection) lotterySection.style.display = '';

    // シード自動計算
    const drawSize = DrawEngine.getDrawSize(entries.length);
    const sorted = [...entries].sort((a, b) => (b.points || 0) - (a.points || 0));
    const withSeeds = DrawEngine.assignSeeds(sorted, drawSize);
    const seeds = withSeeds.filter(p => p.seed > 0);

    // シード情報バーを更新
    const seedInfoBar = document.getElementById('draw-seed-info');
    if (seedInfoBar) {
      let html = '<div class="draw-info-grid">' +
        '<div class="draw-info-item"><span class="draw-info-label">エントリー</span><span class="draw-info-value">' + entries.length + '名</span></div>' +
        '<div class="draw-info-item"><span class="draw-info-label">ドローサイズ</span><span class="draw-info-value">' + drawSize + '</span></div>' +
        '<div class="draw-info-item"><span class="draw-info-label">BYE</span><span class="draw-info-value">' + (drawSize - entries.length) + '</span></div>' +
        '<div class="draw-info-item"><span class="draw-info-label">シード</span><span class="draw-info-value">' + seeds.length + '名</span></div>' +
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

    // 手動配置の初期化
    this._initManualPlacement(withSeeds, drawSize, seeds);
  },

  /**
   * 手動配置の初期化
   * シード選手とBYEは自動配置、非シード選手は未配置リストへ
   */
  _initManualPlacement(players, drawSize, seeds) {
    // ドロー配列を初期化（全ポジション空）
    const draw = [];
    for (let i = 0; i < drawSize; i++) {
      draw.push({ position: i + 1, name: '', furigana: '', affiliation: '', points: 0, seed: 0, isBye: false, isEmpty: true });
    }

    // シード配置（DrawEngineと同じロジック）
    const seeded = players.filter(p => p.seed > 0).sort((a, b) => a.seed - b.seed);
    if (seeded.length >= 1) {
      this._placeInDraw(draw, 0, seeded[0]);
    }
    if (seeded.length >= 2) {
      this._placeInDraw(draw, drawSize - 1, seeded[1]);
    }
    if (seeded.length >= 3) {
      const pos34 = DrawEngine.getSeed34Positions(drawSize);
      const shuffled34 = DrawEngine.shuffleArray([...pos34]);
      this._placeInDraw(draw, shuffled34[0] - 1, seeded[2]);
      if (seeded.length >= 4) {
        this._placeInDraw(draw, shuffled34[1] - 1, seeded[3]);
      }
    }
    if (seeded.length >= 5) {
      const pos58 = DrawEngine.getSeed58Positions(drawSize);
      const shuffled58 = DrawEngine.shuffleArray([...pos58]);
      for (let i = 0; i < Math.min(4, seeded.length - 4); i++) {
        if (i < shuffled58.length) {
          this._placeInDraw(draw, shuffled58[i] - 1, seeded[4 + i]);
        }
      }
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
      if (this._unplacedPlayers.length === 0) {
        unplacedList.innerHTML = '<span style="color:#2E7D32;font-size:13px;">全選手が配置済みです</span>';
      } else {
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
        if (this._selectedPlayer !== null) {
          const actionCell = tr.querySelector('td:last-child');
          const btnPlace = document.createElement('button');
          btnPlace.className = 'btn btn-sm btn-primary';
          btnPlace.textContent = '配置';
          btnPlace.addEventListener('click', () => this._placePlayerAt(i));
          actionCell.appendChild(btnPlace);
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
    const drawData = {
      draw: this._manualDraw,
      drawSize: this._currentDrawData.drawSize,
      eventName: evt ? evt.name : this._currentDrawData.eventCode,
      tournamentName: AppConfig.TOURNAMENT_NAME || '',
      date: '',
      venue: '',
      entryCount: this._currentDrawData.entries.filter(e => !e.isBye).length,
      seeds: this._currentDrawData.seeds || [],
    };

    DrawRenderer.render(wrapper, drawData);

    // 空きスロットをクリック可能にする（SVG内のテキスト "---" をクリックで配置）
    const svg = wrapper.querySelector('svg');
    if (!svg || this._selectedPlayer === null) return;

    // 空きスロット位置にクリック領域を追加
    const draw = this._manualDraw;
    const P = DrawRenderer.PARAMS;
    const halfSize = draw.length / 2;
    const rounds = Math.log2(draw.length);
    const halfRounds = rounds - 1;
    const bodyTop = P.headerHeight;
    const halfWidth = P.drawNumWidth + P.nameAreaWidth + halfRounds * P.roundWidth;

    for (let i = 0; i < draw.length; i++) {
      if (!draw[i].isEmpty) continue;
      const isLeft = i < halfSize;
      const localIdx = isLeft ? i : i - halfSize;
      const cy = bodyTop + (localIdx * 2) * P.slotHeight + P.slotHeight / 2;
      const offsetX = isLeft ? 0 : halfWidth + P.centerGap;

      let rx, ry, rw, rh;
      if (isLeft) {
        rx = offsetX + P.drawNumWidth;
        ry = cy - P.slotHeight / 2;
        rw = P.nameAreaWidth;
        rh = P.slotHeight;
      } else {
        // 右山: 番号+名前エリアをカバー
        rx = offsetX + halfRounds * P.roundWidth;
        ry = cy - P.slotHeight / 2;
        rw = P.drawNumWidth + P.nameAreaWidth;
        rh = P.slotHeight;
      }

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', rx);
      rect.setAttribute('y', ry);
      rect.setAttribute('width', rw);
      rect.setAttribute('height', rh);
      rect.setAttribute('fill', 'rgba(25, 118, 210, 0.08)');
      rect.setAttribute('stroke', '#1976D2');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('stroke-dasharray', '4,2');
      rect.setAttribute('rx', '3');
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', ((idx) => () => {
        this._placePlayerAt(idx);
      })(i));
      rect.addEventListener('mouseenter', () => { rect.setAttribute('fill', 'rgba(25, 118, 210, 0.2)'); });
      rect.addEventListener('mouseleave', () => { rect.setAttribute('fill', 'rgba(25, 118, 210, 0.08)'); });
      svg.appendChild(rect);
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

  _confirmDraw() {
    if (!this._manualDraw || !this._currentDrawData) return;

    if (this._unplacedPlayers.length > 0) {
      this.showMessage('未配置の選手が ' + this._unplacedPlayers.length + '名 います。全員を配置してください。', 'error');
      return;
    }

    const eventCode = this._currentDrawData.eventCode;
    const evt = AppConfig.EVENTS.find(e => e.code === eventCode);
    const draw = this._manualDraw.map(e => ({ ...e, isEmpty: undefined }));

    this.drawResults[eventCode] = {
      draw: draw,
      drawSize: this._currentDrawData.drawSize,
      entries: this._currentDrawData.entries,
      seeds: this._currentDrawData.seeds,
      eventName: evt ? evt.name : eventCode,
      eventCode: eventCode,
      entryCount: this._currentDrawData.entries.filter(e => !e.isBye).length,
    };

    this.showMessage(evt.name + ' のドローを確定しました', 'success');
  },

  _resetDraw() {
    if (!this._currentDrawData) return;
    const { entries, drawSize, seeds } = this._currentDrawData;
    this._initManualPlacement(entries, drawSize, seeds);
    this.showMessage('配置をリセットしました', 'info');
  },

  _executeAllDraws() {
    const results = DrawEngine.generateAllDraws();
    let count = 0;
    for (const code of Object.keys(results)) {
      this.drawResults[code] = results[code];
      count++;
    }
    if (count > 0) {
      this.showMessage(count + '種目のドローを自動生成しました', 'success');
    } else {
      this.showMessage('4名以上のエントリーがある種目がありません', 'error');
    }
  },

  // ================================================================
  // ドロー表画面
  // ================================================================

  initBracketScreen() {
    const select = document.getElementById('bracket-event-select');
    if (select) {
      select.addEventListener('change', () => this._onBracketEventChange());
    }

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
  },

  _exportDrawExcel() {
    const select = document.getElementById('bracket-event-select');
    if (!select || !select.value) { this.showMessage('種目を選択してください', 'error'); return; }
    const result = this.drawResults[select.value];
    if (!result) { this.showMessage('ドローが生成されていません', 'error'); return; }
    DrawRenderer.exportToExcel({
      ...result,
      tournamentName: AppConfig.TOURNAMENT_NAME || '',
      date: AppConfig.TOURNAMENT_DATE || '',
      venue: AppConfig.TOURNAMENT_VENUE || '',
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
    });
    this.showMessage('CSVファイルをダウンロードしました', 'success');
  },

  _refreshBracketEventSelect() {
    const select = document.getElementById('bracket-event-select');
    if (!select) return;
    select.innerHTML = '';

    let firstCode = '';
    for (const code of Object.keys(this.drawResults)) {
      const result = this.drawResults[code];
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = result.eventName;
      select.appendChild(opt);
      if (!firstCode) firstCode = code;
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
      return;
    }

    const eventCode = select.value;
    const result = this.drawResults[eventCode];
    if (!result) return;

    if (emptyMsg) emptyMsg.style.display = 'none';

    // SVG 描画
    const container = document.getElementById('bracket-container');
    if (container) {
      DrawRenderer.render(container, {
        draw: result.draw,
        drawSize: result.drawSize,
        eventName: result.eventName,
        tournamentName: AppConfig.TOURNAMENT_NAME || '鳥取県テニス選手権大会',
        date: AppConfig.TOURNAMENT_DATE || '',
        venue: AppConfig.TOURNAMENT_VENUE || '',
        entries: result.entries,
        seeds: result.seeds,
        entryCount: result.entryCount,
      });
    }

    // エントリーリスト表示
    if (entryList) {
      entryList.style.display = '';
      const tbody = document.getElementById('bracket-entry-body');
      if (tbody) {
        tbody.innerHTML = '';
        for (const entry of result.draw) {
          if (entry.isBye) continue;
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + entry.position + '</td>' +
            '<td>' + this._esc(entry.name) + '</td>' +
            '<td>' + this._esc(entry.affiliation || '') + '</td>';
          tbody.appendChild(tr);
        }
      }
    }
  },

  // ================================================================
  // マニュアル画面
  // ================================================================

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
