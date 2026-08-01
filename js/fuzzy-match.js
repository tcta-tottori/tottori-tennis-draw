/**
 * fuzzy-match.js - ファジーマッチング
 * OCR結果とランキングデータを紐付ける
 * グローバルスコープ（window.FuzzyMatch）にエクスポート
 * 依存: window.RankingLoader
 */
window.FuzzyMatch = {

  /**
   * レーベンシュタイン距離を計算
   * @param {string} a - 文字列1
   * @param {string} b - 文字列2
   * @returns {number} 編集距離
   */
  levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,       // 削除
          matrix[i][j - 1] + 1,       // 挿入
          matrix[i - 1][j - 1] + cost // 置換
        );
      }
    }

    return matrix[b.length][a.length];
  },

  /**
   * 文字列を正規化（全角スペース統一、トリム）
   */
  _normalize(text) {
    if (!text) return '';
    return String(text).replace(/ /g, '\u3000').replace(/\s+/g, '\u3000').trim();
  },

  /**
   * 氏名を姓と名に分割
   * @param {string} name - 全角スペース区切りの氏名
   * @returns {{ sei: string, mei: string }} 姓と名
   */
  _splitName(name) {
    const parts = name.split('\u3000');
    if (parts.length >= 2) {
      return { sei: parts[0], mei: parts.slice(1).join('\u3000') };
    }
    return { sei: name, mei: '' };
  },

  /**
   * 氏名でマッチング。候補をスコア順で返す
   * strategy:
   *   1. 完全一致 (score: 100)
   *   2. 姓一致 + 名の距離 <= 1 (score: 80)
   *   3. 全体の距離 <= 2 (score: 60)
   *   4. ふりがな類似 (score: 40)
   *
   * @param {string} ocrText - OCRで読み取ったテキスト
   * @param {string} [eventCode] - 種目コード（省略時は全種目検索）
   * @returns {Array} マッチ候補 [{ name, affiliation, points, rank, score, matchType }, ...]
   */
  matchName(ocrText, eventCode) {
    const normalized = this._normalize(ocrText);
    if (!normalized) return [];

    const ocrParts = this._splitName(normalized);
    const candidates = [];

    // 検索対象の選手リストを決定
    let players;
    if (eventCode && RankingLoader.rankings[eventCode]) {
      players = RankingLoader.rankings[eventCode];
    } else {
      players = RankingLoader.allPlayers;
    }

    const seen = new Set();

    for (const player of players) {
      const key = player.name + '|' + (player.eventCode || '');
      if (seen.has(key)) continue;
      seen.add(key);

      const playerParts = this._splitName(player.name);
      let score = 0;
      let matchType = '';

      // 1. 完全一致
      if (normalized === player.name) {
        score = 100;
        matchType = 'exact';
      }
      // 2. 姓一致 + 名の距離 <= 1
      else if (ocrParts.sei === playerParts.sei && ocrParts.mei && playerParts.mei) {
        const meiDist = this.levenshtein(ocrParts.mei, playerParts.mei);
        if (meiDist <= 1) {
          score = 80 - meiDist * 5;
          matchType = 'sei_match';
        }
      }

      // 3. 全体の距離 <= 2
      if (score === 0) {
        const fullDist = this.levenshtein(normalized, player.name);
        if (fullDist <= 2) {
          score = 60 - fullDist * 10;
          matchType = 'levenshtein';
        }
      }

      // 4. ふりがな類似
      const playerFurigana = RankingLoader.getFurigana(player.name);
      if (score === 0 && playerFurigana) {
        const furigana = playerFurigana;
        // OCRテキストがひらがな/カタカナの場合、ふりがなと比較
        const ocrHiragana = this._toHiragana(normalized);
        const furiganaNorm = this._toHiragana(furigana);
        if (ocrHiragana && furiganaNorm) {
          const furiDist = this.levenshtein(ocrHiragana, furiganaNorm);
          if (furiDist <= 2) {
            score = 40 - furiDist * 5;
            matchType = 'furigana';
          }
        }
      }

      if (score > 0) {
        candidates.push({
          name: player.name,
          affiliation: player.affiliation,
          points: player.points,
          rank: player.rank,
          eventCode: player.eventCode,
          score: score,
          matchType: matchType,
        });
      }
    }

    // スコア降順でソート
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  },

  /**
   * カタカナをひらがなに変換
   */
  _toHiragana(str) {
    if (!str) return '';
    return str.replace(/[\u30A1-\u30F6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  },

  /**
   * 複数行テキストから氏名候補を抽出
   * @param {string} text - OCRで読み取った複数行テキスト
   * @returns {Array} [{ rawText, possibleName, possibleAffiliation }, ...]
   */
  extractNames(text) {
    if (!text) return [];

    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
    const results = [];

    // 日本語氏名パターン:
    //   漢字2-4文字 + スペース + 漢字1-4文字
    //   カタカナ2-5文字 + スペース + カタカナ1-5文字
    const namePatterns = [
      /([一-龥ぁ-んァ-ヶ]{1,5}[\s\u3000]+[一-龥ぁ-んァ-ヶ]{1,5})/,
      /([一-龥]{2,4}[\s\u3000]+[一-龥]{1,4})/,
      /([ァ-ヶー]{2,6}[\s\u3000]+[ァ-ヶー]{1,6})/,
    ];

    for (const line of lines) {
      let possibleName = '';
      let possibleAffiliation = '';

      for (const pattern of namePatterns) {
        const match = line.match(pattern);
        if (match) {
          possibleName = this._normalize(match[1]);
          // 氏名部分を除いた残りを所属候補とする
          const remaining = line.replace(match[0], '').trim();
          if (remaining) {
            possibleAffiliation = remaining.replace(/^[\s\u3000,、:：]+/, '').trim();
          }
          break;
        }
      }

      results.push({
        rawText: line,
        possibleName: possibleName,
        possibleAffiliation: possibleAffiliation,
      });
    }

    return results;
  },
};
