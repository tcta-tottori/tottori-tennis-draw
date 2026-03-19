/**
 * google_drive_backup.js - Google Drive API v3 を用いた全データバックアップ管理
 * Google Identity Services (GIS) で OAuth2 認証を行い、
 * 共有フォルダ「鳥取テニス協会バックアップ」内でファイル管理する
 */
window.GoogleDriveBackup = {
  DRIVE_API: 'https://www.googleapis.com/drive/v3',
  UPLOAD_API: 'https://www.googleapis.com/upload/drive/v3',
  ROOT_FOLDER_NAME: '鳥取テニス協会バックアップ',
  SUB_FOLDER_NAME: 'ドロー会議システム',
  SCOPES: 'https://www.googleapis.com/auth/drive.file',

  // localStorage キー
  TOKEN_KEY: 'drawSystem_gdriveToken',
  EXPIRY_KEY: 'drawSystem_gdriveExpiry',
  CLIENT_ID_KEY: 'drawSystem_gdriveClientId',

  // キャッシュ
  _cachedFolderId: null,
  _gisLoaded: false,
  _tokenClient: null,

  // ================================================================
  // GIS ローダー
  // ================================================================

  loadGisScript() {
    if (this._gisLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (document.getElementById('gis-script')) {
        this._gisLoaded = true;
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.id = 'gis-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => { this._gisLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Google Identity Services の読み込みに失敗'));
      document.head.appendChild(script);
    });
  },

  /** OAuth2 トークン取得（ポップアップ） */
  requestAccessToken(clientId) {
    return new Promise((resolve, reject) => {
      const google = window.google;
      if (!google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services が読み込まれていません'));
        return;
      }

      this._tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: this.SCOPES,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          const token = response.access_token;
          const expiresIn = response.expires_in || 3600;
          const expiryTime = Date.now() + expiresIn * 1000;
          this.saveToken(token, expiryTime);
          resolve(token);
        },
        error_callback: (err) => {
          reject(new Error(err.message || 'OAuth認証に失敗'));
        },
      });
      this._tokenClient.requestAccessToken();
    });
  },

  /** トークンを取り消し */
  revokeToken(token) {
    const google = window.google;
    if (google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(token);
    }
    this.clearToken();
    this._cachedFolderId = null;
  },

  // ================================================================
  // トークン管理
  // ================================================================
  saveToken(token, expiry) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.EXPIRY_KEY, String(expiry));
  },

  getSavedToken() {
    const token = localStorage.getItem(this.TOKEN_KEY) || '';
    const expiry = Number(localStorage.getItem(this.EXPIRY_KEY) || '0');
    if (token && Date.now() < expiry) return token;
    if (token) this.clearToken();
    return '';
  },

  clearToken() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.EXPIRY_KEY);
    this._cachedFolderId = null;
  },

  isTokenValid() {
    const token = localStorage.getItem(this.TOKEN_KEY) || '';
    const expiry = Number(localStorage.getItem(this.EXPIRY_KEY) || '0');
    return !!token && Date.now() < expiry;
  },

  // Client ID
  getSavedClientId() {
    return localStorage.getItem(this.CLIENT_ID_KEY) || '';
  },
  saveClientId(clientId) {
    localStorage.setItem(this.CLIENT_ID_KEY, clientId);
  },
  clearClientId() {
    localStorage.removeItem(this.CLIENT_ID_KEY);
  },

  // ================================================================
  // Drive API ヘルパー
  // ================================================================
  _headers(token) {
    return { Authorization: `Bearer ${token}` };
  },

  async validateToken(token) {
    try {
      const res = await fetch(`${this.DRIVE_API}/about?fields=user`, {
        headers: this._headers(token),
      });
      return res.ok;
    } catch { return false; }
  },

  async getUserEmail(token) {
    const res = await fetch(`${this.DRIVE_API}/about?fields=user(emailAddress)`, {
      headers: this._headers(token),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.user?.emailAddress || '';
  },

  // ================================================================
  // フォルダ管理
  // ================================================================
  async _findFolder(token, name, parentId) {
    let q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;
    const params = new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '1' });
    const res = await fetch(`${this.DRIVE_API}/files?${params}`, { headers: this._headers(token) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.files?.[0]?.id || null;
  },

  async _createFolder(token, name, parentId) {
    const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    const res = await fetch(`${this.DRIVE_API}/files`, {
      method: 'POST',
      headers: { ...this._headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `フォルダ作成失敗 (${res.status})`);
    }
    const data = await res.json();
    return data.id;
  },

  async getBackupFolderId(token) {
    if (this._cachedFolderId) return this._cachedFolderId;
    let rootId = await this._findFolder(token, this.ROOT_FOLDER_NAME);
    if (!rootId) rootId = await this._createFolder(token, this.ROOT_FOLDER_NAME);
    let subId = await this._findFolder(token, this.SUB_FOLDER_NAME, rootId);
    if (!subId) subId = await this._createFolder(token, this.SUB_FOLDER_NAME, rootId);
    this._cachedFolderId = subId;
    return subId;
  },

  // ================================================================
  // ファイル操作
  // ================================================================

  async listBackups(token) {
    const folderId = await this.getBackupFolderId(token);
    const q = `'${folderId}' in parents and trashed=false and mimeType='application/json'`;
    const params = new URLSearchParams({
      q, fields: 'files(id,name,size,modifiedTime,mimeType)', orderBy: 'modifiedTime desc', pageSize: '50',
    });
    const res = await fetch(`${this.DRIVE_API}/files?${params}`, { headers: this._headers(token) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `一覧取得失敗 (${res.status})`);
    }
    const data = await res.json();
    return (data.files || []).map(f => ({
      id: f.id, name: f.name, size: f.size || '0', modifiedTime: f.modifiedTime, mimeType: f.mimeType,
    }));
  },

  async downloadBackup(token, file) {
    const res = await fetch(`${this.DRIVE_API}/files/${file.id}?alt=media`, {
      headers: this._headers(token),
    });
    if (!res.ok) throw new Error(`ダウンロード失敗 (${res.status})`);
    return res.json();
  },

  async uploadBackup(token, fileName, content) {
    const folderId = await this.getBackupFolderId(token);
    const jsonStr = JSON.stringify(content, null, 2);
    const metadata = { name: fileName, mimeType: 'application/json', parents: [folderId] };
    const boundary = '----BackupBoundary' + Date.now();
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      jsonStr +
      `\r\n--${boundary}--`;

    const res = await fetch(`${this.UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { ...this._headers(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `アップロード失敗 (${res.status})`);
    }
  },

  async deleteBackup(token, file) {
    const res = await fetch(`${this.DRIVE_API}/files/${file.id}`, {
      method: 'DELETE',
      headers: this._headers(token),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `削除失敗 (${res.status})`);
    }
  },

  async getSharedFolderLink(token) {
    const folderId = await this.getBackupFolderId(token);
    return `https://drive.google.com/drive/folders/${folderId}`;
  },
};
