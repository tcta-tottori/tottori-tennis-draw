/**
 * github_backup.js - GitHub REST API を用いた全データバックアップ管理
 */
window.GitHubBackup = {
  config: {
    owner: 'tcta-tottori',
    repo: 'tottori-tennis-draw',
    backupDir: 'backups',
    token: localStorage.getItem('drawSystem_ghBackupToken') || ''
  },

  /**
   * トークンを保存する
   */
  saveToken(token) {
    this.config.token = token;
    localStorage.setItem('drawSystem_ghBackupToken', token);
  },

  /**
   * ヘッダー取得
   */
  _getHeaders() {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  },

  /**
   * トークン有効性チェック
   */
  async validateToken(token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /**
   * バックアップファイル一覧を取得
   */
  async listBackups() {
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${this.config.backupDir}`;
    const res = await fetch(url, { headers: this._getHeaders() });

    if (res.status === 404) return [];
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API エラー (${res.status})`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter(f => f.type === 'file' && f.name.endsWith('.json'))
      .map(f => ({
        name: f.name,
        path: f.path,
        sha: f.sha,
        size: f.size,
        download_url: f.download_url,
      }))
      .sort((a, b) => b.name.localeCompare(a.name)); // 新しい順
  },

  /**
   * バックアップを保存
   */
  async uploadBackup(fileName, content) {
    const path = `${this.config.backupDir}/${fileName}`;
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}`;

    // 既存ファイルの sha を取得（上書き用）
    let sha;
    try {
      const existing = await fetch(url, { headers: this._getHeaders() });
      if (existing.ok) {
        const data = await existing.json();
        sha = data.sha;
      }
    } catch { /* ignore */ }

    const jsonStr = JSON.stringify(content, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(jsonStr)));

    const body = {
      message: `backup: ${fileName}`,
      content: encoded,
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: this._getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `アップロード失敗 (${res.status})`);
    }
  },

  /**
   * バックアップをダウンロード
   */
  async downloadBackup(file) {
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${file.path}`;
    const res = await fetch(url, { headers: this._getHeaders() });

    if (!res.ok) throw new Error(`ダウンロード失敗 (${res.status})`);

    const data = await res.json();
    const content = atob(data.content.replace(/\n/g, ''));
    return JSON.parse(decodeURIComponent(escape(content)));
  },

  /**
   * バックアップを削除
   */
  async deleteBackup(file) {
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${file.path}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: this._getHeaders(),
      body: JSON.stringify({
        message: `delete backup: ${file.name}`,
        sha: file.sha,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `削除失敗 (${res.status})`);
    }
  }
};
