/**
 * cloud-share.js - Firebase Realtime Database によるクラウド共有モジュール
 * グローバルスコープ (window.CloudShare) にエクスポート
 * 依存: Firebase SDK (CDN)
 */
window.CloudShare = {
  _db: null,
  _spaceId: null,
  _config: null,
  _listeners: [],

  /**
   * Firebase設定をlocalStorageから読み込んで初期化
   */
  init(config) {
    if (!config) {
      config = this.loadConfig();
    }
    if (!config || !config.apiKey || !config.databaseURL) {
      this._db = null;
      this._config = null;
      return false;
    }
    try {
      // 既存のFirebaseアプリがあれば削除
      if (firebase.apps.length > 0) {
        firebase.apps.forEach(app => app.delete());
      }
    } catch (e) { /* ignore */ }

    try {
      const app = firebase.initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain || '',
        databaseURL: config.databaseURL,
        projectId: config.projectId || '',
      });
      this._db = firebase.database();
      this._config = config;
      this.saveConfig(config);

      // 保存済みのスペースIDを復元
      const savedSpaceId = localStorage.getItem('drawSystem_cloudSpaceId');
      if (savedSpaceId) {
        this._spaceId = savedSpaceId;
      }
      return true;
    } catch (e) {
      console.error('Firebase初期化エラー:', e);
      this._db = null;
      this._config = null;
      return false;
    }
  },

  /**
   * Firebase設定をlocalStorageに保存
   */
  saveConfig(config) {
    try {
      localStorage.setItem('drawSystem_firebaseConfig', JSON.stringify(config));
    } catch (e) {
      console.error('Firebase設定の保存に失敗:', e);
    }
  },

  /**
   * Firebase設定をlocalStorageから読み込み
   */
  loadConfig() {
    try {
      const saved = localStorage.getItem('drawSystem_firebaseConfig');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * 6文字の英数字コードを生成
   */
  _generateSpaceId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * デバイス名を取得
   */
  _getDeviceName() {
    const saved = localStorage.getItem('drawSystem_deviceName');
    if (saved) return saved;
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'デバイス';
  },

  /**
   * 新しい共有スペースを作成
   * @param {string} name スペース名
   * @returns {Promise<string>} spaceId
   */
  async createSpace(name) {
    if (!this._db) throw new Error('Firebaseが初期化されていません');

    const spaceId = this._generateSpaceId();
    const metadata = {
      name: name || 'ドロー会議共有スペース',
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      memberCount: 1,
    };

    await this._db.ref('spaces/' + spaceId + '/metadata').set(metadata);
    this._spaceId = spaceId;
    localStorage.setItem('drawSystem_cloudSpaceId', spaceId);
    return spaceId;
  },

  /**
   * 既存のスペースに参加
   * @param {string} spaceId 参加コード
   */
  async joinSpace(spaceId) {
    if (!this._db) throw new Error('Firebaseが初期化されていません');

    spaceId = (spaceId || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{6}$/.test(spaceId)) {
      throw new Error('参加コードは6文字の英数字です');
    }

    const snapshot = await this._db.ref('spaces/' + spaceId + '/metadata').once('value');
    if (!snapshot.exists()) {
      throw new Error('指定されたスペースが見つかりません');
    }

    // メンバーカウントを増やす
    const current = snapshot.val();
    await this._db.ref('spaces/' + spaceId + '/metadata/memberCount').set((current.memberCount || 0) + 1);

    this._spaceId = spaceId;
    localStorage.setItem('drawSystem_cloudSpaceId', spaceId);
    return snapshot.val();
  },

  /**
   * スペースから離れる
   */
  leaveSpace() {
    this._removeListeners();
    this._spaceId = null;
    localStorage.removeItem('drawSystem_cloudSpaceId');
  },

  /**
   * リアルタイムリスナーを削除
   */
  _removeListeners() {
    this._listeners.forEach(ref => {
      try { ref.off(); } catch (e) { /* ignore */ }
    });
    this._listeners = [];
  },

  /**
   * ファイルをスペースにアップロード
   * @param {string} name ファイル名
   * @param {string} type 'entries' | 'draws' | 'tournament' | 'backup' | 'furigana'
   * @param {*} data データ（オブジェクトまたは文字列）
   * @returns {Promise<string>} fileId
   */
  async uploadFile(name, type, data) {
    if (!this._db) throw new Error('Firebaseが初期化されていません');
    if (!this._spaceId) throw new Error('共有スペースに参加していません');

    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const fileRef = this._db.ref('spaces/' + this._spaceId + '/files').push();
    const fileData = {
      name: name,
      type: type,
      data: dataStr,
      uploadedAt: firebase.database.ServerValue.TIMESTAMP,
      uploadedBy: this._getDeviceName(),
    };

    await fileRef.set(fileData);
    return fileRef.key;
  },

  /**
   * スペース内のファイル一覧を取得
   * @returns {Promise<Array>}
   */
  async listFiles() {
    if (!this._db) throw new Error('Firebaseが初期化されていません');
    if (!this._spaceId) throw new Error('共有スペースに参加していません');

    const snapshot = await this._db.ref('spaces/' + this._spaceId + '/files').once('value');
    if (!snapshot.exists()) return [];

    const files = [];
    snapshot.forEach(child => {
      const val = child.val();
      files.push({
        id: child.key,
        name: val.name,
        type: val.type,
        uploadedAt: val.uploadedAt,
        uploadedBy: val.uploadedBy,
        dataSize: (val.data || '').length,
      });
    });
    // 新しい順にソート
    files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    return files;
  },

  /**
   * ファイルをダウンロード
   * @param {string} fileId
   * @returns {Promise<Object>} { name, type, data }
   */
  async downloadFile(fileId) {
    if (!this._db) throw new Error('Firebaseが初期化されていません');
    if (!this._spaceId) throw new Error('共有スペースに参加していません');

    const snapshot = await this._db.ref('spaces/' + this._spaceId + '/files/' + fileId).once('value');
    if (!snapshot.exists()) throw new Error('ファイルが見つかりません');

    const val = snapshot.val();
    let parsedData;
    try {
      parsedData = JSON.parse(val.data);
    } catch (e) {
      parsedData = val.data;
    }

    return {
      name: val.name,
      type: val.type,
      data: parsedData,
      uploadedAt: val.uploadedAt,
      uploadedBy: val.uploadedBy,
    };
  },

  /**
   * ファイルを削除
   * @param {string} fileId
   */
  async deleteFile(fileId) {
    if (!this._db) throw new Error('Firebaseが初期化されていません');
    if (!this._spaceId) throw new Error('共有スペースに参加していません');

    await this._db.ref('spaces/' + this._spaceId + '/files/' + fileId).remove();
  },

  /**
   * ファイル一覧をリアルタイム監視
   * @param {Function} callback ファイル一覧が更新された時に呼ばれる
   */
  watchFiles(callback) {
    if (!this._db || !this._spaceId) return;

    const ref = this._db.ref('spaces/' + this._spaceId + '/files');
    ref.on('value', snapshot => {
      const files = [];
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          const val = child.val();
          files.push({
            id: child.key,
            name: val.name,
            type: val.type,
            uploadedAt: val.uploadedAt,
            uploadedBy: val.uploadedBy,
            dataSize: (val.data || '').length,
          });
        });
      }
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      callback(files);
    });
    this._listeners.push(ref);
  },

  /**
   * 現在のスペースID
   */
  getSpaceId() {
    return this._spaceId;
  },

  /**
   * Firebase接続済みかどうか
   */
  isConnected() {
    return this._db !== null;
  },

  /**
   * スペースに参加中かどうか
   */
  isInSpace() {
    return this._db !== null && this._spaceId !== null;
  },

  /**
   * Web Share API でデータを共有
   * @param {string} title タイトル
   * @param {*} data データ
   */
  async webShare(title, data) {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const file = new File([blob], title + '.json', { type: 'application/json' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: title,
          files: [file],
        });
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        // フォールバック: ダウンロード
      }
    }

    // Web Share API が使えない場合はダウンロード
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  },
};
