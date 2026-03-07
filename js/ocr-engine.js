/**
 * ocr-engine.js - Tesseract.jsを使ったOCRエンジン
 * グローバルスコープ（window.OCREngine）にエクスポート
 * 依存: Tesseract.js v5
 */
window.OCREngine = {
  worker: null,
  ready: false,

  /**
   * Tesseract.jsの初期化（日本語モデルロード）
   * Tesseract.js v5 APIを使用
   */
  async init() {
    if (this.ready) return;

    try {
      this.worker = await Tesseract.createWorker('jpn');
      this.ready = true;
      console.log('OCREngine: 日本語モデルのロード完了');
    } catch (e) {
      console.error('OCREngine: 初期化に失敗:', e);
      throw e;
    }
  },

  /**
   * 画像の前処理（Canvas API）
   * グレースケール変換、コントラスト強調、二値化を行う
   * @param {HTMLImageElement|HTMLCanvasElement} imageElement - 入力画像
   * @returns {HTMLCanvasElement} 処理後のCanvas
   */
  preprocessImage(imageElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // 画像サイズを取得
    let width, height;
    if (imageElement instanceof HTMLCanvasElement) {
      width = imageElement.width;
      height = imageElement.height;
    } else {
      width = imageElement.naturalWidth || imageElement.width;
      height = imageElement.naturalHeight || imageElement.height;
    }

    canvas.width = width;
    canvas.height = height;

    // 元画像を描画
    ctx.drawImage(imageElement, 0, 0, width, height);

    // ピクセルデータを取得
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Step 1: グレースケール変換
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    // Step 2: コントラスト強調（コントラスト係数1.5）
    const contrastFactor = 1.5;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = data[i + c];
        val = ((val / 255 - 0.5) * contrastFactor + 0.5) * 255;
        data[i + c] = Math.max(0, Math.min(255, val));
      }
    }

    // Step 3: 二値化（大津の方法の簡易版）
    // ヒストグラム計算
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[Math.round(data[i])]++;
    }

    // 大津の閾値を計算
    const totalPixels = width * height;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }

    let sumB = 0;
    let wB = 0;
    let maxVariance = 0;
    let threshold = 128; // デフォルト

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;

      const wF = totalPixels - wB;
      if (wF === 0) break;

      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const variance = wB * wF * (mB - mF) * (mB - mF);
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }

    // 二値化適用
    for (let i = 0; i < data.length; i += 4) {
      const val = data[i] > threshold ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }

    // 処理結果を書き戻す
    ctx.putImageData(imageData, 0, 0);

    return canvas;
  },

  /**
   * OCR実行
   * @param {File|Blob|HTMLCanvasElement|HTMLImageElement} imageSource - 画像ソース
   * @param {object} [options] - オプション
   * @param {boolean} [options.preprocess=true] - 前処理を行うかどうか
   * @returns {Promise<{text: string, words: Array, confidence: number}>}
   */
  async recognize(imageSource, options) {
    if (!this.ready) {
      await this.init();
    }

    const opts = Object.assign({ preprocess: true }, options);

    let processedSource = imageSource;

    // 前処理が有効で、画像要素の場合は前処理を行う
    if (opts.preprocess) {
      if (imageSource instanceof HTMLImageElement || imageSource instanceof HTMLCanvasElement) {
        processedSource = this.preprocessImage(imageSource);
      } else if (imageSource instanceof File || imageSource instanceof Blob) {
        // File/Blobの場合はimg要素に読み込んでから前処理
        processedSource = await this._blobToProcessedCanvas(imageSource);
      }
    }

    try {
      const result = await this.worker.recognize(processedSource);
      const { text, words } = result.data;

      // 平均信頼度を計算
      let confidence = 0;
      if (words && words.length > 0) {
        const totalConf = words.reduce((sum, w) => sum + (w.confidence || 0), 0);
        confidence = totalConf / words.length;
      }

      return {
        text: text || '',
        words: words || [],
        confidence: confidence,
      };
    } catch (e) {
      console.error('OCREngine: 認識に失敗:', e);
      throw e;
    }
  },

  /**
   * Blob/Fileを画像として読み込み、前処理してCanvasを返す
   * @private
   */
  _blobToProcessedCanvas(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const canvas = this.preprocessImage(img);
          resolve(canvas);
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像の読み込みに失敗しました'));
      };

      img.src = url;
    });
  },

  /**
   * 終了処理
   */
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.ready = false;
      console.log('OCREngine: 終了');
    }
  },
};
