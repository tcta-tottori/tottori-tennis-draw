/**
 * github_sync.js - GitHub REST API を用いたデータ自動更新・同期機能
 */
window.GitHubSync = {
  config: {
    repo: localStorage.getItem('drawSystem_ghRepo') || 'tcta-tottori/tottori-tennis-draw',
    pat: localStorage.getItem('drawSystem_ghPat') || '',
    filePath: localStorage.getItem('drawSystem_ghFilePath') || 'data/furigana.json'
  },

  /**
   * 設定を保存する
   */
  saveConfig(repo, pat, filePath) {
    this.config.repo = repo;
    this.config.pat = pat;
    this.config.filePath = filePath;
    localStorage.setItem('drawSystem_ghRepo', repo);
    localStorage.setItem('drawSystem_ghPat', pat);
    localStorage.setItem('drawSystem_ghFilePath', filePath);
  },

  /**
   * 設定が有効かどうか
   */
  isValid() {
    return this.config.repo && this.config.pat && this.config.filePath;
  },

  /**
   * APIリクエストのラッパー
   */
  async _request(method, url, body = null) {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${this.config.pat}`
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`https://api.github.com/repos/${this.config.repo}/${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });

    if (!res.ok) {
      throw new Error(`GitHub API Error: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  },

  /**
   * ファイルのSHA（現在のバージョンハッシュ）を取得する
   */
  async _getFileSha() {
    try {
      const data = await this._request('GET', `contents/${this.config.filePath}`);
      return data.sha;
    } catch (e) {
      if (e.message.includes('404')) {
        // ファイルが存在しない場合はSHAなしでOK
        return null;
      }
      throw e;
    }
  },

  /**
   * データをGitHubにアップロード（コミット）する
   */
  async uploadData(jsonData, commitMessage = 'Auto-update data from DrawSystem App') {
    if (!this.isValid()) return false;

    try {
      // 1. 現在のSHAを取得
      const sha = await this._getFileSha();

      // 2. Base64エンコード (UTF-8対応)
      // Unicode文字列をBase64にするための回避策
      const encodedContent = btoa(unescape(encodeURIComponent(JSON.stringify(jsonData, null, 2))));

      // 3. コミットを作成するリクエスト
      const body = {
        message: commitMessage,
        content: encodedContent,
        branch: 'main'
      };
      if (sha) {
        body.sha = sha;
      }

      await this._request('PUT', `contents/${this.config.filePath}`, body);
      return true;
    } catch (e) {
      console.error('GitHub Upload Error:', e);
      throw e;
    }
  },

  /**
   * GitHubからデータをダウンロードする
   */
  async downloadData() {
    if (!this.isValid()) return null;

    try {
      const data = await this._request('GET', `contents/${this.config.filePath}`);
      if (data && data.content) {
        // Base64デコード
        const decodedContent = decodeURIComponent(escape(atob(data.content)));
        return JSON.parse(decodedContent);
      }
      return null;
    } catch (e) {
      if (e.message.includes('404')) {
        return null; // ファイルがない
      }
      console.error('GitHub Download Error:', e);
      throw e;
    }
  }
};
