/**
 * draw-engine.js - ドロー生成エンジン
 * GAS (05_draw_system.gs) から移植したトーナメント生成ロジック
 * グローバルスコープ (window.DrawEngine) にエクスポート
 * 依存: window.AppConfig, window.EntryStore
 */
window.DrawEngine = {

  /**
   * ドローサイズを決定する（エントリー数から2のべき乗に切り上げ）
   * @param {number} entryCount エントリー数
   * @returns {number} ドローサイズ (4, 8, 16, 32, 64, 128)
   */
  getDrawSize(entryCount) {
    if (entryCount <= 4) return 4;
    if (entryCount <= 8) return 8;
    if (entryCount <= 16) return 16;
    if (entryCount <= 32) return 32;
    if (entryCount <= 64) return 64;
    return 128;
  },

  /**
   * JTA規格のトーナメントドロー番号配列を生成する（高梨アルゴリズム移植）
   * @param {number} entryCount 参加人数
   * @param {number} drawSize ドローサイズ（2のべき乗）
   * @returns {Array<number>} ドロー番号配列（0 = BYE）
   */
  generateTournamentNumbers(entryCount, drawSize) {
    if (!drawSize) {
      drawSize = this.getDrawSize(entryCount);
    }
    const entryGroup = Math.floor(Math.log2(drawSize)) - 1;
    if (entryGroup < 1) {
      // drawSize=4 の場合: entryGroup=1, 初期配列そのまま
      const base = [1, 4, 3, 2];
      return base.map(n => n > entryCount ? 0 : n);
    }

    const tableSet = [];
    tableSet[0] = [1, 4, 3, 2];

    for (let h = 0; h < entryGroup - 1; h++) {
      const tableNumber = tableSet[h].length * 2;
      tableSet[h + 1] = new Array(tableNumber);
      for (let i = 0; i < tableNumber / 2; i++) {
        tableSet[h + 1][i * 2] = tableSet[h][i];
        tableSet[h + 1][i * 2 + 1] = Math.abs(Math.pow(2, h + 3) + 1 - tableSet[h][i]);
        // 偶数インデックスペアを入れ替え（j=2,3 / j=6,7 / ...）
        if (i % 2 === 1) {
          const temp = tableSet[h + 1][i * 2];
          tableSet[h + 1][i * 2] = tableSet[h + 1][i * 2 + 1];
          tableSet[h + 1][i * 2 + 1] = temp;
        }
      }
    }

    // 参加人数を超える番号は 0（BYE）
    const finalIndex = entryGroup - 1;
    const result = tableSet[finalIndex].map(n => n > entryCount ? 0 : n);
    return result;
  },

  /**
   * 配列をシャッフルする（Fisher-Yates アルゴリズム）
   * @param {Array} arr シャッフルする配列（破壊的変更）
   * @returns {Array} シャッフルされた配列（同じ参照）
   */
  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  /**
   * 対戦相手の位置を取得（0-indexed）
   * 1回戦のペアは (0,1), (2,3), (4,5), ... なので:
   *   偶数 index → +1, 奇数 index → -1
   * @param {number} index 0-indexed のドロー位置
   * @returns {number} 対戦相手の 0-indexed 位置
   */
  getOpponentIndex(index) {
    return index % 2 === 0 ? index + 1 : index - 1;
  },

  /**
   * シード3,4の配置候補位置を返す（1-indexed, JTAルール）
   * @param {number} drawSize ドローサイズ
   * @returns {Array<number>} 1-indexed の位置配列
   */
  getSeed34Positions(drawSize) {
    const positions = AppConfig.SEED_POSITIONS[drawSize];
    if (positions && positions.seed3_4) {
      return positions.seed3_4;
    }
    // フォールバック
    return [Math.floor(drawSize / 4) + 1, Math.floor(drawSize * 3 / 4)];
  },

  /**
   * シード5-8の配置候補位置を返す（1-indexed, JTAルール）
   * @param {number} drawSize ドローサイズ
   * @returns {Array<number>} 1-indexed の位置配列
   */
  getSeed58Positions(drawSize) {
    const positions = AppConfig.SEED_POSITIONS[drawSize];
    if (positions && positions.seed5_8) {
      return positions.seed5_8;
    }
    return [];
  },

  getSeed916Positions(drawSize) {
    const positions = AppConfig.SEED_POSITIONS[drawSize];
    if (positions && positions.seed9_16) {
      return positions.seed9_16;
    }
    return [];
  },

  /**
   * シード選手を指定位置に配置するヘルパー
   * @param {Array} draw ドロー配列
   * @param {number} posIndex 0-indexed 位置
   * @param {object} entry 選手オブジェクト
   */
  _placeSeedAtPosition(draw, posIndex, entry) {
    draw[posIndex] = {
      position: posIndex + 1,
      name: entry.name,
      furigana: entry.furigana || '',
      affiliation: entry.affiliation || '',
      points: entry.points || 0,
      seed: entry.seed,
      isBye: false,
    };
  },

  /**
   * BYE 位置を決定する
   * シード選手の対戦相手位置に優先的に BYE を配置し、
   * 残りは下端→上端の交互で配置する
   * @param {Array} draw ドロー配列
   * @param {number} drawSize ドローサイズ
   * @param {number} byeCount BYE 数
   * @returns {Array<number>} BYE位置の 0-indexed 配列
   */
  _determineBYEPositions(draw, drawSize, byeCount) {
    if (byeCount <= 0) return [];

    const byePositions = [];
    const isUsed = new Set();

    // シードが配置されている位置を記録
    const seedPositions = new Set();
    const seedEntries = [];
    for (let i = 0; i < drawSize; i++) {
      if (draw[i] && draw[i].seed > 0) {
        seedPositions.add(i);
        seedEntries.push({ index: i, seed: draw[i].seed });
      }
    }
    seedEntries.sort((a, b) => a.seed - b.seed);

    // 1. シード選手の対戦相手位置に優先配置（シード順位が高い順）
    for (const se of seedEntries) {
      if (byePositions.length >= byeCount) break;
      const opponentPos = this.getOpponentIndex(se.index);
      if (opponentPos >= 0 && opponentPos < drawSize &&
          !seedPositions.has(opponentPos) && !isUsed.has(opponentPos)) {
        byePositions.push(opponentPos);
        isUsed.add(opponentPos);
      }
    }

    // 2. 残りのBYEを4つの山に均等分散配置
    const remainingByes = byeCount - byePositions.length;
    if (remainingByes > 0) {
      const halfSize = drawSize / 2;
      const quarterSize = halfSize / 2;
      // 4つの山: 左上(0~q-1), 左下(q~h-1), 右上(h~h+q-1), 右下(h+q~end)
      const quarters = [
        { start: 0, end: quarterSize },
        { start: quarterSize, end: halfSize },
        { start: halfSize, end: halfSize + quarterSize },
        { start: halfSize + quarterSize, end: drawSize },
      ];

      // 各山の空き位置を収集
      const quarterSlots = quarters.map(q => {
        const slots = [];
        for (let i = q.start; i < q.end; i++) {
          if (!seedPositions.has(i) && !isUsed.has(i)) slots.push(i);
        }
        return slots;
      });

      // 各山に既に配置済みのBYE数を計算
      const quarterByeCount = quarters.map((q, qi) => {
        let count = 0;
        for (const pos of byePositions) {
          if (pos >= q.start && pos < q.end) count++;
        }
        return count;
      });

      // 各山のシード優先度を決定（最小シード番号を持つ山が優先）
      const quarterSeedPriority = quarters.map((q, qi) => {
        let minSeed = 999;
        for (const se of seedEntries) {
          if (se.index >= q.start && se.index < q.end) {
            minSeed = Math.min(minSeed, se.seed);
          }
        }
        return minSeed;
      });

      // 均等配分: 残りのBYEを各山に分配
      const totalByePerQuarter = quarters.map((_, qi) => quarterByeCount[qi]);
      const baseBye = Math.floor(remainingByes / 4);
      let extra = remainingByes % 4;

      // 各山の追加BYE数を計算
      const additionalByes = [0, 0, 0, 0];
      for (let qi = 0; qi < 4; qi++) additionalByes[qi] = baseBye;

      // 端数をシード優先度の高い山から割り当て
      const sortedQuarters = [0, 1, 2, 3].sort((a, b) => quarterSeedPriority[a] - quarterSeedPriority[b]);
      for (let i = 0; i < extra; i++) {
        additionalByes[sortedQuarters[i]]++;
      }

      // 各山にBYEを配置（BYE同士が1回戦で対戦しないよう考慮）
      for (let qi = 0; qi < 4; qi++) {
        let count = additionalByes[qi];
        const slots = quarterSlots[qi];
        if (count <= 0 || slots.length === 0) continue;

        // BYE同士の1回戦対戦を避ける: ペア(0,1),(2,3)...で片方ずつにBYEを配置
        // 空きスロットをペア単位で管理
        const pairSlots = [];
        for (const s of slots) {
          const pairStart = Math.floor(s / 2) * 2;
          const opponent = s % 2 === 0 ? s + 1 : s - 1;
          const opponentAlreadyBye = isUsed.has(opponent);
          pairSlots.push({ pos: s, pairStart, opponentAlreadyBye });
        }

        // 対戦相手がまだBYEでないスロットを優先
        pairSlots.sort((a, b) => {
          if (a.opponentAlreadyBye !== b.opponentAlreadyBye) return a.opponentAlreadyBye ? 1 : -1;
          return a.pos - b.pos;
        });

        // 端（上端・下端交互）から配置して分散
        const fromTop = pairSlots.filter(s => !s.opponentAlreadyBye);
        const fromBoth = fromTop.length > 0 ? fromTop : pairSlots;
        let tIdx = 0, bIdx = fromBoth.length - 1;
        let fromBottom = true;
        let placed = 0;
        const usedInRound = new Set();
        while (placed < count && tIdx <= bIdx) {
          const slot = fromBottom ? fromBoth[bIdx--] : fromBoth[tIdx++];
          if (!isUsed.has(slot.pos)) {
            byePositions.push(slot.pos);
            isUsed.add(slot.pos);
            placed++;
          }
          fromBottom = !fromBottom;
        }
      }
    }

    return byePositions.slice(0, byeCount);
  },

  /**
   * ドロー配列を作成する（JTAルール準拠）
   * @param {Array} players 選手配列 [{name, affiliation, points, seed, furigana}, ...]
   *                        ポイント降順ソート済みであること
   * @param {number} drawSize ドローサイズ（2のべき乗）
   * @returns {Array} ドロー配列 [{position, name, affiliation, seed, isBye, furigana, points}, ...]
   */
  createDrawArray(players, drawSize) {
    // ドロー配列を初期化（全ポジション BYE）
    const draw = [];
    for (let i = 0; i < drawSize; i++) {
      draw.push({
        position: i + 1,
        name: '',
        furigana: '',
        affiliation: '',
        points: 0,
        seed: 0,
        isBye: true,
      });
    }

    // シード選手とノーシード選手を分離
    const seeded = players.filter(p => p.seed > 0).sort((a, b) => a.seed - b.seed);
    const unseeded = players.filter(p => !p.seed || p.seed <= 0);
    const seedCount = seeded.length;

    // --- シード配置 ---
    if (seedCount >= 1) {
      // シード1 → 最上段 (index 0)
      this._placeSeedAtPosition(draw, 0, seeded[0]);
    }

    if (seedCount >= 2) {
      // シード2 → 最下段 (index drawSize - 1)
      this._placeSeedAtPosition(draw, drawSize - 1, seeded[1]);
    }

    if (seedCount >= 3) {
      // シード3,4 の位置を決定
      const positions34 = this.getSeed34Positions(drawSize);
      const shuffled34 = this.shuffleArray([...positions34]);
      // 3番目のシードを配置
      this._placeSeedAtPosition(draw, shuffled34[0] - 1, seeded[2]);
      // 4番目のシード（存在すれば）
      if (seedCount >= 4) {
        this._placeSeedAtPosition(draw, shuffled34[1] - 1, seeded[3]);
      }
    }

    if (seedCount >= 5) {
      // シード5-8 の位置を決定
      const positions58 = this.getSeed58Positions(drawSize);
      const shuffled58 = this.shuffleArray([...positions58]);
      for (let i = 0; i < Math.min(4, seedCount - 4); i++) {
        if (i < shuffled58.length) {
          this._placeSeedAtPosition(draw, shuffled58[i] - 1, seeded[4 + i]);
        }
      }
    }

    if (seedCount >= 9) {
      // シード9-16 の位置を決定
      const positions916 = this.getSeed916Positions(drawSize);
      const shuffled916 = this.shuffleArray([...positions916]);
      for (let i = 0; i < Math.min(8, seedCount - 8); i++) {
        if (i < shuffled916.length && (8 + i) < seeded.length) {
          this._placeSeedAtPosition(draw, shuffled916[i] - 1, seeded[8 + i]);
        }
      }
    }

    // --- BYE 配置 ---
    const byeCount = drawSize - players.length;
    const byePositions = this._determineBYEPositions(draw, drawSize, byeCount);
    const byeSet = new Set(byePositions);

    // BYE位置にBYEマークを付ける（シード位置以外で空いている位置）
    for (const pos of byePositions) {
      draw[pos].isBye = true;
      draw[pos].name = '';
    }

    // --- 非シード選手をランダムに空き位置に配置 ---
    // シード配置済みでもBYEでもない位置が空き
    const seededPositions = new Set();
    for (let i = 0; i < drawSize; i++) {
      if (draw[i].seed > 0) seededPositions.add(i);
    }

    const availablePositions = [];
    for (let i = 0; i < drawSize; i++) {
      if (!seededPositions.has(i) && !byeSet.has(i)) {
        availablePositions.push(i);
      }
    }

    const shuffledUnseeded = this.shuffleArray([...unseeded]);
    for (let i = 0; i < shuffledUnseeded.length && i < availablePositions.length; i++) {
      const pos = availablePositions[i];
      draw[pos] = {
        position: pos + 1,
        name: shuffledUnseeded[i].name,
        furigana: shuffledUnseeded[i].furigana || '',
        affiliation: shuffledUnseeded[i].affiliation || '',
        points: shuffledUnseeded[i].points || 0,
        seed: 0,
        isBye: false,
      };
    }

    return draw;
  },

  /**
   * シードを自動決定する
   * ポイント上位の選手に対してシード番号を割り当てる
   * @param {Array} players 選手配列（ポイント降順ソート済み）
   * @param {number} drawSize ドローサイズ
   * @returns {Array} シード番号が付与された選手配列
   */
  assignSeeds(players, drawSize) {
    const seedRule = AppConfig.SEED_RULES[drawSize];
    const seedCount = seedRule ? seedRule.seeds : 0;

    const result = players.map(p => ({ ...p, seed: 0 }));

    if (seedCount >= 1 && result.length >= 1) result[0].seed = 1;
    if (seedCount >= 2 && result.length >= 2) result[1].seed = 2;

    // シード3,4は抽選（3位と4位をランダムに割り当て）
    if (seedCount >= 4 && result.length >= 4) {
      const seeds34 = [3, 4];
      this.shuffleArray(seeds34);
      result[2].seed = seeds34[0];
      result[3].seed = seeds34[1];
    } else if (seedCount >= 3 && result.length >= 3) {
      result[2].seed = 3;
    }

    // シード5-8は抽選（5位〜8位をランダムに割り当て）
    if (seedCount >= 5) {
      const count58 = Math.min(4, seedCount - 4, result.length - 4);
      if (count58 > 0) {
        const seeds58 = [];
        for (let i = 5; i <= 4 + count58; i++) seeds58.push(i);
        this.shuffleArray(seeds58);
        for (let i = 0; i < count58; i++) {
          result[4 + i].seed = seeds58[i];
        }
      }
    }

    // シード9-16は抽選（9位〜16位をランダムに割り当て）
    if (seedCount >= 9) {
      const count916 = Math.min(8, seedCount - 8, result.length - 8);
      if (count916 > 0) {
        const seeds916 = [];
        for (let i = 9; i <= 8 + count916; i++) seeds916.push(i);
        this.shuffleArray(seeds916);
        for (let i = 0; i < count916; i++) {
          result[8 + i].seed = seeds916[i];
        }
      }
    }

    return result;
  },

  /**
   * 全種目のドローを生成する
   * EntryStore から種目別のエントリーを取得し、各種目のドローを生成
   * @returns {object} { eventCode: { draw, drawSize, entries, seeds, eventName }, ... }
   */
  generateAllDraws() {
    if (typeof EntryStore === 'undefined') {
      console.warn('EntryStore が未定義です');
      return {};
    }

    const results = {};

    for (const evt of AppConfig.EVENTS) {
      const isDoubles = evt.category === 'doubles';
      let drawEntries;

      if (isDoubles) {
        const pairs = EntryStore.getDoublesPairs(evt.code).filter(p => !p.incomplete);
        if (pairs.length <= 3) continue;
        drawEntries = pairs.map(p => ({
          name: p.name,
          furigana: p.furigana,
          affiliation: p.affiliation,
          points: p.points,
          seed: 0,
        }));
      } else {
        drawEntries = EntryStore.getByEvent(evt.code);
        if (!drawEntries || drawEntries.length <= 3) continue;
      }

      const drawSize = this.getDrawSize(drawEntries.length);
      const sorted = [...drawEntries].sort((a, b) => (b.points || 0) - (a.points || 0));
      const withSeeds = this.assignSeeds(sorted, drawSize);
      const draw = this.createDrawArray(withSeeds, drawSize);
      const seeds = withSeeds.filter(p => p.seed > 0).sort((a, b) => a.seed - b.seed);

      results[evt.code] = {
        draw: draw,
        drawSize: drawSize,
        entries: withSeeds,
        seeds: seeds,
        eventName: evt.name,
        eventCode: evt.code,
        entryCount: drawEntries.length,
      };
    }

    return results;
  },

  /**
   * 1種目のドローを生成する
   * @param {string} eventCode 種目コード
   * @returns {object|null} { draw, drawSize, entries, seeds, eventName } または null
   */
  generateDraw(eventCode) {
    if (typeof EntryStore === 'undefined') {
      console.warn('EntryStore が未定義です');
      return null;
    }

    const evt = AppConfig.EVENTS.find(e => e.code === eventCode);
    if (!evt) return null;

    const entries = EntryStore.getByEvent(eventCode);
    if (!entries || entries.length <= 3) {
      return null;
    }

    const drawSize = this.getDrawSize(entries.length);
    const sorted = [...entries].sort((a, b) => (b.points || 0) - (a.points || 0));
    const withSeeds = this.assignSeeds(sorted, drawSize);
    const draw = this.createDrawArray(withSeeds, drawSize);
    const seeds = withSeeds.filter(p => p.seed > 0).sort((a, b) => a.seed - b.seed);

    return {
      draw: draw,
      drawSize: drawSize,
      entries: withSeeds,
      seeds: seeds,
      eventName: evt.name,
      eventCode: evt.code,
      entryCount: entries.length,
    };
  },
};
