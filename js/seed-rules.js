/**
 * seed-rules.js - JTAシードルールの実装（GASから移植）
 * グローバルスコープ（window.SeedRules）にエクスポート
 * 依存: window.AppConfig
 */
window.SeedRules = {

  /**
   * エントリー数からドローサイズを決定
   * @param {number} entryCount - エントリー数
   * @returns {number} ドローサイズ（2のべき乗）
   */
  getDrawSize(entryCount) {
    if (entryCount <= 2) return 2;
    if (entryCount <= 4) return 4;
    if (entryCount <= 8) return 8;
    if (entryCount <= 16) return 16;
    if (entryCount <= 32) return 32;
    if (entryCount <= 64) return 64;
    return 128;
  },

  /**
   * シード数を取得
   * @param {number} drawSize - ドローサイズ
   * @returns {number} シード数
   */
  getSeedCount(drawSize) {
    return (AppConfig.SEED_RULES[drawSize] || { seeds: 0 }).seeds;
  },

  /**
   * シード選手を決定（ポイント順で上位N名）
   * @param {Array} players - 選手配列 [{name, points, ...}] ポイント降順ソート済み
   * @param {number} drawSize - ドローサイズ
   * @returns {Array} seed属性付きの選手配列
   */
  assignSeeds(players, drawSize) {
    const seedCount = this.getSeedCount(drawSize);
    const result = players.map((p, i) => ({
      ...p,
      seed: (i < seedCount) ? (i + 1) : null,
    }));
    return result;
  },

  /**
   * シード位置を取得（1-indexed）
   * seed1 = 1, seed2 = drawSize,
   * seed3,4 = SEED_POSITIONS配列からランダム割当,
   * seed5-8 = SEED_POSITIONS配列からランダム割当
   *
   * @param {number} drawSize - ドローサイズ
   * @param {number} seedNumber - シード番号（1〜）
   * @returns {number} ドロー内の位置（1-indexed）
   */
  getSeedPositions(drawSize, seedNumber) {
    if (seedNumber === 1) return 1;
    if (seedNumber === 2) return drawSize;

    const positions = AppConfig.SEED_POSITIONS[drawSize];
    if (!positions) return null;

    if (seedNumber === 3 || seedNumber === 4) {
      if (positions.seed3_4) {
        // seed3_4配列のインデックスをランダムに決定しない
        // 呼び出し側で制御するためそのまま返す
        const idx = seedNumber - 3; // 0 or 1
        return positions.seed3_4[idx] || null;
      }
    }

    if (seedNumber >= 5 && seedNumber <= 8) {
      if (positions.seed5_8) {
        const idx = seedNumber - 5; // 0〜3
        return positions.seed5_8[idx] || null;
      }
    }

    return null;
  },

  /**
   * 全シード位置を一括で割り当て
   * seed3,4およびseed5-8の位置はシャッフルして割り当てる
   *
   * @param {number} drawSize - ドローサイズ
   * @returns {object} { seedNumber: position, ... } 例: {1: 1, 2: 32, 3: 9, 4: 24}
   */
  allocateSeedPositions(drawSize) {
    const seedCount = this.getSeedCount(drawSize);
    if (seedCount === 0) return {};

    const result = {};

    // seed1, seed2は固定
    if (seedCount >= 1) result[1] = 1;
    if (seedCount >= 2) result[2] = drawSize;

    const positions = AppConfig.SEED_POSITIONS[drawSize];
    if (!positions) return result;

    // seed3, seed4: 位置をシャッフルして割当
    if (seedCount >= 4 && positions.seed3_4) {
      const shuffled34 = this._shuffle([...positions.seed3_4]);
      result[3] = shuffled34[0];
      result[4] = shuffled34[1];
    } else if (seedCount >= 3 && positions.seed3_4) {
      result[3] = positions.seed3_4[0];
    }

    // seed5-8: 位置をシャッフルして割当
    if (seedCount >= 5 && positions.seed5_8) {
      const shuffled58 = this._shuffle([...positions.seed5_8]);
      for (let s = 5; s <= Math.min(seedCount, 8); s++) {
        result[s] = shuffled58[s - 5];
      }
    }

    return result;
  },

  /**
   * 配列をシャッフル（Fisher-Yates）
   * @private
   */
  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  /**
   * BYE数の計算
   * @param {number} drawSize - ドローサイズ
   * @param {number} entryCount - エントリー数
   * @returns {number} BYE数
   */
  getByeCount(drawSize, entryCount) {
    return drawSize - entryCount;
  },

  /**
   * BYE位置の決定
   * 1. シード選手の対戦相手位置（シード順位が高い順）
   * 2. 残りは上端・下端交互
   *
   * @param {Array} drawArray - ドロー配列（drawSize要素、seed配置済み）
   *   drawArray[i] = { name, seed, ... } or null
   * @param {number} drawSize - ドローサイズ
   * @param {number} byeCount - BYE数
   * @returns {Array<number>} BYE位置の配列（0-indexed）
   */
  determineBYEPositions(drawArray, drawSize, byeCount) {
    if (byeCount <= 0) return [];

    const byePositions = [];
    const usedPositions = new Set();

    // シード選手の位置を収集（seed番号順）
    const seedEntries = [];
    for (let i = 0; i < drawArray.length; i++) {
      if (drawArray[i] && drawArray[i].seed) {
        seedEntries.push({ index: i, seed: drawArray[i].seed });
      }
    }
    seedEntries.sort((a, b) => a.seed - b.seed);

    // 1. シード選手の対戦相手位置にBYEを優先配置
    for (const entry of seedEntries) {
      if (byePositions.length >= byeCount) break;

      const opponentIndex = this._getOpponentIndex(entry.index, drawSize);
      if (opponentIndex !== null && !usedPositions.has(opponentIndex)) {
        // 対戦相手位置がまだ選手で埋まっていないか確認
        if (!drawArray[opponentIndex] || !drawArray[opponentIndex].name) {
          byePositions.push(opponentIndex);
          usedPositions.add(opponentIndex);
        }
      }
    }

    // 2. 残りのBYEを上端・下端交互に配置
    let top = 0;
    let bottom = drawSize - 1;
    let fromTop = true;

    while (byePositions.length < byeCount) {
      if (fromTop) {
        while (top < drawSize && (usedPositions.has(top) || (drawArray[top] && drawArray[top].name))) {
          top++;
        }
        if (top < drawSize) {
          byePositions.push(top);
          usedPositions.add(top);
          top++;
        }
      } else {
        while (bottom >= 0 && (usedPositions.has(bottom) || (drawArray[bottom] && drawArray[bottom].name))) {
          bottom--;
        }
        if (bottom >= 0) {
          byePositions.push(bottom);
          usedPositions.add(bottom);
          bottom--;
        }
      }
      fromTop = !fromTop;

      // 無限ループ防止
      if (top > drawSize && bottom < 0) break;
    }

    return byePositions;
  },

  /**
   * 1回戦での対戦相手のインデックスを取得（0-indexed）
   * ドローは偶数・奇数のペアで1回戦の対戦組み合わせとなる
   * @private
   * @param {number} index - 選手のインデックス（0-indexed）
   * @param {number} drawSize - ドローサイズ
   * @returns {number|null} 対戦相手のインデックス
   */
  _getOpponentIndex(index, drawSize) {
    if (index < 0 || index >= drawSize) return null;
    // 1回戦のペア: 0-1, 2-3, 4-5, ...
    if (index % 2 === 0) {
      return index + 1;
    } else {
      return index - 1;
    }
  },
};
