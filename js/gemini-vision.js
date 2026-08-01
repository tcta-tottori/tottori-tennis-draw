/**
 * gemini-vision.js - Gemini API（無料枠）による画像からのエントリー読取り
 *
 * エントリー用紙の写真やスクリーンショットを Gemini のマルチモーダルモデルに渡し、
 * 氏名・ふりがな・所属・種目を構造化JSONで受け取る。
 * Tesseract系のOCRと違い、手書き・傾き・レイアウト崩れに強く、
 * 「姓と名の区切り」「ふりがな欄」の意味を理解した上で抽出できる。
 *
 * グローバルスコープ（window.GeminiVision）にエクスポート
 * 依存: なし（fetch / canvas のみ）
 */
window.GeminiVision = {
  API_BASE: 'https://generativelanguage.googleapis.com/v1beta',

  STORAGE_KEY_API: 'drawSystem_geminiApiKey',
  STORAGE_KEY_MODEL: 'drawSystem_geminiModel',

  /**
   * 利用候補モデル（優先度順）。
   * 無料枠で画像入力が使える Flash 系を精度の高い順に並べている。
   * 「自動」選択時は、APIキーで実際に利用可能なモデルを問い合わせて先頭から採用する。
   */
  MODEL_PREFERENCE: [
    { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash（無料枠・最高精度）' },
    { id: 'gemini-3-flash',        label: 'Gemini 3 Flash（無料枠）' },
    { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash（無料枠）' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite（無料枠・高速）' },
  ],

  /** 自動判定に失敗した場合に使う既定モデル */
  FALLBACK_MODEL: 'gemini-2.5-flash',

  /** 画像の長辺上限（px）。大きすぎる写真はトークン浪費と遅延の原因になる */
  MAX_IMAGE_EDGE: 1600,

  _resolvedModel: null,
  _authTransport: null,

  // ==========================================================
  // 設定の保存 / 取得
  // ==========================================================

  getApiKey() {
    try { return localStorage.getItem(this.STORAGE_KEY_API) || ''; } catch (e) { return ''; }
  },

  saveApiKey(key) {
    try {
      if (key) localStorage.setItem(this.STORAGE_KEY_API, key.trim());
      else localStorage.removeItem(this.STORAGE_KEY_API);
    } catch (e) { /* プライベートモード等では保存できない */ }
    this._resolvedModel = null;
  },

  /** '' は「自動（推奨）」を意味する */
  getModel() {
    try { return localStorage.getItem(this.STORAGE_KEY_MODEL) || ''; } catch (e) { return ''; }
  },

  saveModel(model) {
    try {
      if (model) localStorage.setItem(this.STORAGE_KEY_MODEL, model);
      else localStorage.removeItem(this.STORAGE_KEY_MODEL);
    } catch (e) { /* noop */ }
    this._resolvedModel = null;
  },

  isConfigured() {
    return !!this.getApiKey();
  },

  /**
   * APIキーの形式を事前チェックする。
   *
   * Google AI Studio が発行するキーは2種類ある。
   *   - AQ.xxxx  … 現行の auth key（新規発行はこちら）
   *   - AIzaxxxx … 従来のキー（既存のものは引き続き利用可）
   * どちらも正当なキーなので、ここでは「明らかにキーでないもの」だけを弾く。
   *
   * @param {string} key APIキー
   * @returns {{ ok: boolean, message: string }} ok=false でも保存自体は許可する（将来の形式変更に備える）
   */
  validateApiKeyFormat(key) {
    const k = String(key || '').trim();
    if (!k) {
      return { ok: false, message: 'APIキーが入力されていません' };
    }
    if (/^https?:\/\//i.test(k)) {
      return { ok: false, message: 'URLが貼り付けられています。APIキーの文字列だけを貼り付けてください。' };
    }
    if (/^ya29\./.test(k)) {
      return {
        ok: false,
        message: 'これはOAuthのアクセストークンです。Google AI Studio の「APIキーを作成」で発行したキーを貼り付けてください。',
      };
    }
    if (/[\s　]/.test(k)) {
      return { ok: false, message: 'APIキーに空白が含まれています。前後の空白や改行を取り除いて貼り付けてください。' };
    }
    // AQ. / AIza いずれでもない場合は警告のみ（弾かない）
    if (!/^(AQ\.|AIza)/.test(k)) {
      return {
        ok: false,
        message: 'APIキーの形式が想定と異なります（通常は AQ. または AIza で始まります）。'
          + 'Google AI Studio の「APIキーを作成」で発行したキーか確認してください。',
      };
    }
    return { ok: true, message: '' };
  },

  /**
   * 認証方式を変えながらリクエストする。
   *
   * 現行の auth key（AQ.）は、送り方によって 401 ACCESS_TOKEN_TYPE_UNSUPPORTED や
   * 400 API_KEY_INVALID になる事例が報告されている。x-goog-api-key ヘッダーと
   * ?key= クエリの両方を順に試し、通った方を以降のリクエストでも使う。
   *
   * @param {string} path API_BASE 以降のパス（先頭の / を含む）
   * @param {object} [init] fetch のオプション
   * @returns {Promise<Response>} 成功したレスポンス、または最後に試した失敗レスポンス
   */
  async _authFetch(path, init) {
    const key = this.getApiKey();
    if (!key) throw new Error('Gemini APIキーが設定されていません');

    const options = init || {};
    const sep = path.indexOf('?') === -1 ? '?' : '&';

    const transports = [
      { id: 'header', build: () => ({
        url: `${this.API_BASE}${path}`,
        headers: Object.assign({}, options.headers, { 'x-goog-api-key': key }),
      }) },
      { id: 'query', build: () => ({
        url: `${this.API_BASE}${path}${sep}key=${encodeURIComponent(key)}`,
        headers: Object.assign({}, options.headers),
      }) },
    ];

    // 前回成功した方式が分かっていれば、それを最初に試す
    if (this._authTransport === 'query') transports.reverse();

    let lastRes = null;
    for (const transport of transports) {
      const { url, headers } = transport.build();
      const res = await fetch(url, Object.assign({}, options, { headers }));
      if (res.ok) {
        this._authTransport = transport.id;
        return res;
      }
      // 認証以外のエラー（レート上限・モデル不明など）は方式を変えても直らない
      if (res.status !== 400 && res.status !== 401 && res.status !== 403) return res;
      lastRes = res;
    }
    return lastRes;
  },

  // ==========================================================
  // モデル解決
  // ==========================================================

  /**
   * APIキーで利用可能なモデル一覧を取得する
   * @returns {Promise<Array<{id: string, displayName: string}>>}
   */
  async listModels() {
    const res = await this._authFetch('/models?pageSize=200');
    if (!res.ok) {
      throw new Error(await this._describeError(res));
    }
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];

    return models
      .filter(m => {
        // v1beta は supportedGenerationMethods、新しめのレスポンスは supportedActions
        const methods = m.supportedGenerationMethods || m.supportedActions || [];
        return methods.indexOf('generateContent') !== -1;
      })
      .map(m => ({
        id: String(m.name || '').replace(/^models\//, ''),
        displayName: m.displayName || String(m.name || '').replace(/^models\//, ''),
      }))
      .filter(m => m.id);
  },

  /**
   * 実際に呼び出すモデルIDを決定する。
   * 明示指定があればそれを、なければ利用可能モデルを問い合わせて優先度順に採用する。
   * @returns {Promise<string>}
   */
  async resolveModel() {
    const explicit = this.getModel();
    if (explicit) return explicit;
    if (this._resolvedModel) return this._resolvedModel;

    try {
      const available = await this.listModels();
      const ids = new Set(available.map(m => m.id));
      for (const candidate of this.MODEL_PREFERENCE) {
        if (ids.has(candidate.id)) {
          this._resolvedModel = candidate.id;
          return candidate.id;
        }
      }
      // 優先リストに無くても、画像対応の flash 系があれば拾う
      const flash = available.find(m => /flash/i.test(m.id) && !/image|tts|audio|embedding/i.test(m.id));
      if (flash) {
        this._resolvedModel = flash.id;
        return flash.id;
      }
    } catch (e) {
      console.warn('GeminiVision: モデル一覧の取得に失敗、既定モデルを使用します:', e.message);
    }

    this._resolvedModel = this.FALLBACK_MODEL;
    return this._resolvedModel;
  },

  // ==========================================================
  // 画像の前処理
  // ==========================================================

  /**
   * File/Blob を縮小し、Gemini の inline_data 形式に変換する
   * @param {File|Blob} file
   * @returns {Promise<{mime_type: string, data: string}>}
   */
  async fileToInlineData(file) {
    const dataUrl = await this._downscaleToDataUrl(file);
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const base64 = dataUrl.slice(comma + 1);
    const mimeMatch = header.match(/^data:([^;]+);/);
    return {
      mime_type: mimeMatch ? mimeMatch[1] : 'image/jpeg',
      data: base64,
    };
  },

  _downscaleToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          const scale = Math.min(1, this.MAX_IMAGE_EDGE / Math.max(w, h));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          const ctx = canvas.getContext('2d');
          // 文字が潰れないよう高品質縮小を指定
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像の読み込みに失敗しました: ' + (file.name || '')));
      };

      img.src = url;
    });
  },

  // ==========================================================
  // 抽出
  // ==========================================================

  /**
   * Gemini に渡す抽出指示
   */
  _buildPrompt(eventHint) {
    const hint = eventHint
      ? `\nこの用紙の種目は「${eventHint}」であることが分かっています。種目が読み取れない行にはこの種目を使ってください。`
      : '';

    return [
      'あなたはテニス大会のエントリー用紙を読み取る担当者です。',
      '添付画像はエントリー申込書・申込一覧・名簿のいずれかです（手書き・印刷・表計算のスクリーンショットのいずれもあり得ます）。',
      '画像に写っている選手を1人ずつ抽出し、指定のJSON形式で出力してください。',
      '',
      '【抽出ルール】',
      '1. name: 氏名を画像の表記どおりの漢字・カタカナで出力する。姓と名の間は必ず全角スペース1つで区切る。',
      '2. furigana: 用紙にふりがな・フリガナ欄がある場合のみ、ひらがなに直して出力する（姓と名の間は全角スペース1つ）。',
      '   読み取れない、または欄が無い場合は空文字にする。推測で書かないこと。',
      '3. affiliation: 所属（クラブ名・勤務先・学校名）。無ければ空文字。',
      '4. event: 種目の記載（例: 男子ダブルス、女子45歳以上ダブルス、一般男子シングルス）。読み取れなければ空文字。',
      '5. ダブルスでペア2名が1行に書かれている場合は、選手ごとに1件ずつ、計2件出力する。',
      '   その際 partner に相方の氏名を入れる。',
      '6. 見出し行・合計欄・シード番号・コート番号・日付など、選手でないものは出力しない。',
      '7. 存在しない選手を創作しない。判読できない文字は無理に補わず、読めた部分だけを出力する。',
      '8. 氏名の旧字体・異体字は画像のとおりに保つ（例: 齊/斉、髙/高 を勝手に置き換えない）。',
      hint,
    ].join('\n');
  },

  _responseSchema() {
    return {
      type: 'OBJECT',
      properties: {
        players: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: '氏名（姓と名は全角スペース区切り）' },
              furigana: { type: 'STRING', description: 'ふりがな（ひらがな）。不明なら空文字' },
              affiliation: { type: 'STRING', description: '所属。不明なら空文字' },
              event: { type: 'STRING', description: '種目の記載。不明なら空文字' },
              partner: { type: 'STRING', description: 'ダブルスの相方氏名。無ければ空文字' },
            },
            required: ['name'],
          },
        },
      },
      required: ['players'],
    };
  },

  /**
   * 1枚の画像から選手を抽出する
   * @param {File|Blob} file 画像
   * @param {object} [options]
   * @param {string} [options.eventHint] 種目のヒント（種目名）
   * @returns {Promise<Array<object>>}
   */
  async extractFromImage(file, options) {
    const opts = options || {};
    const key = this.getApiKey();
    if (!key) throw new Error('Gemini APIキーが設定されていません');

    const model = await this.resolveModel();
    const inlineData = await this.fileToInlineData(file);

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: this._buildPrompt(opts.eventHint) },
          { inline_data: inlineData },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: this._responseSchema(),
      },
    };

    const res = await this._authFetch(`/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(await this._describeError(res));
    }

    const data = await res.json();
    return this._parsePlayers(data);
  },

  /**
   * 複数画像をまとめて処理する
   * @param {Array<File|Blob>} files
   * @param {object} [options]
   * @param {string} [options.eventHint]
   * @param {function(number, number, string):void} [options.onProgress] (完了数, 総数, ファイル名)
   * @returns {Promise<{players: Array<object>, errors: Array<{file: string, message: string}>, model: string}>}
   */
  async extractFromImages(files, options) {
    const opts = options || {};
    const list = Array.from(files || []);
    const players = [];
    const errors = [];
    const model = await this.resolveModel();

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (opts.onProgress) opts.onProgress(i, list.length, file.name || `画像${i + 1}`);
      try {
        const result = await this.extractFromImage(file, opts);
        for (const player of result) {
          players.push(Object.assign({ sourceFile: file.name || '' }, player));
        }
      } catch (e) {
        errors.push({ file: file.name || `画像${i + 1}`, message: e.message });
      }
      // 無料枠のRPM制限（10回/分程度）に配慮して少し間隔を空ける
      if (i < list.length - 1) await this._sleep(1200);
    }

    if (opts.onProgress) opts.onProgress(list.length, list.length, '');
    return { players, errors, model };
  },

  // ==========================================================
  // レスポンス処理
  // ==========================================================

  _parsePlayers(data) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error('Geminiが応答をブロックしました (' + data.promptFeedback.blockReason + ')');
    }

    const candidate = data && data.candidates && data.candidates[0];
    if (!candidate) throw new Error('Geminiから有効な応答がありませんでした');

    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('応答が長すぎて途中で切れました。画像を分割して再試行してください');
    }

    const parts = (candidate.content && candidate.content.parts) || [];
    const text = parts.map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Geminiが空の応答を返しました');

    const parsed = this._parseJson(text);
    const raw = Array.isArray(parsed) ? parsed : (parsed && parsed.players) || [];

    const players = [];
    for (const item of raw) {
      if (!item || !item.name) continue;
      const name = this._normalizeName(item.name);
      if (!name) continue;
      players.push({
        name: name,
        furigana: this._normalizeFurigana(item.furigana),
        affiliation: String(item.affiliation || '').trim(),
        event: String(item.event || '').trim(),
        partner: this._normalizeName(item.partner),
      });
    }
    return players;
  },

  _parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) { /* コードフェンス付きで返ることがあるので剥がして再試行 */ }

    const fenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      return JSON.parse(fenced);
    } catch (e) { /* 最後に最初のJSONらしき塊を抜き出す */ }

    const match = fenced.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e) { /* fallthrough */ }
    }
    throw new Error('Geminiの応答をJSONとして解釈できませんでした');
  },

  /** 氏名の空白を全角スペース1つに揃える */
  _normalizeName(name) {
    if (!name) return '';
    return String(name)
      .replace(/[\s　 ]+/g, '　')
      .replace(/^　+|　+$/g, '');
  },

  /** ふりがなをひらがな・全角スペース区切りに揃える */
  _normalizeFurigana(furigana) {
    if (!furigana) return '';
    return String(furigana)
      .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
      .replace(/[\s　 ]+/g, '　')
      .replace(/^　+|　+$/g, '');
  },

  async _describeError(res) {
    let detail = '';
    let status = '';
    try {
      const body = await res.json();
      detail = (body && body.error && body.error.message) || '';
      status = (body && body.error && body.error.status) || '';
    } catch (e) { /* JSONでない場合は無視 */ }

    // Googleが返した生のエラーコード/文言も添える（原因の切り分けに必要）
    const raw = [status, detail].filter(Boolean).join(': ');
    const suffix = raw ? '\n[Google からの応答] ' + raw : '';

    const isAuth = res.status === 401
      || status === 'UNAUTHENTICATED'
      || (res.status === 400 && /API[_ ]key/i.test(status + ' ' + detail));

    if (isAuth) {
      return 'APIキーが受け付けられませんでした。以下を確認してください。'
        + '\n・キーの前後に空白や引用符が入っていないか'
        + '\n・Google AI Studio でそのキーが削除・無効化されていないか'
        + '\n・キーに「アプリケーションの制限（HTTPリファラー）」を設定している場合、'
        + ' https://tcta-tottori.github.io/* を許可しているか'
        + '\n・キーの「APIの制限」で Generative Language API が許可されているか'
        + '\n※ AQ. で始まる新しいキーが一部の環境で拒否される事例が報告されています。'
        + '解消しない場合は Google AI Studio でキーを作り直すか、'
        + 'Google Cloud Console（APIとサービス → 認証情報）で AIza 形式のキーを発行してお試しください。'
        + suffix;
    }
    if (res.status === 403) {
      return 'APIキーが拒否されました。キーのリファラー制限やAPIの制限、'
        + 'プロジェクトで Generative Language API が有効かを確認してください。' + suffix;
    }
    if (res.status === 429) {
      return '無料枠のレート上限に達しました。1分ほど待ってから再試行してください。' + suffix;
    }
    if (res.status === 404) {
      return '指定したモデルが利用できません。モデル選択を「自動」に戻すか、'
        + '「利用可能モデルを取得」で使えるモデルを確認してください。' + suffix;
    }
    return `Gemini APIエラー (HTTP ${res.status})` + suffix;
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
};
