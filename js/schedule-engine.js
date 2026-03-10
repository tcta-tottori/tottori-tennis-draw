/**
 * schedule-engine.js - 試合スケジュール自動生成エンジン
 * 確定済みドローから試合一覧を抽出し、コート・時間枠に自動配置する
 * グローバルスコープ (window.ScheduleEngine) にエクスポート
 * 依存: window.AppConfig（種目順序の参照、任意）
 * DOM依存なし - 純粋ロジックモジュール
 */
window.ScheduleEngine = {

  // =========================================================================
  //  種目名マップ（AppConfig.EVENTS が利用可能な場合はそちらを参照）
  // =========================================================================
  _getEventName(eventCode) {
    if (typeof AppConfig !== 'undefined' && AppConfig.EVENTS) {
      const evt = AppConfig.EVENTS.find(e => e.code === eventCode);
      if (evt) return evt.name;
    }
    return eventCode;
  },

  /**
   * 種目の表示順インデックスを取得する
   * @param {string} eventCode 種目コード
   * @returns {number} 順序インデックス（見つからない場合は999）
   */
  _getEventOrder(eventCode) {
    if (typeof AppConfig !== 'undefined' && AppConfig.EVENTS) {
      const idx = AppConfig.EVENTS.findIndex(e => e.code === eventCode);
      if (idx >= 0) return idx;
    }
    return 999;
  },

  // =========================================================================
  //  getRoundLabel - ラウンド表記を返す
  // =========================================================================

  /**
   * ラウンド番号からラベル文字列を生成する
   * @param {number} round ラウンド番号（1始まり）
   * @param {number} totalRounds 総ラウンド数 = log2(drawSize)
   * @returns {string} 'F', 'SF', 'QF', または '{round}R'
   */
  getRoundLabel(round, totalRounds) {
    if (round === totalRounds) return 'F';
    if (round === totalRounds - 1) return 'SF';
    if (round === totalRounds - 2) return 'QF';
    return round + 'R';
  },

  // =========================================================================
  //  extractMatchesFromDraw - ドロー結果から試合一覧を抽出
  // =========================================================================

  /**
   * 確定済みドローから全ラウンドの試合（Match オブジェクト）を抽出する
   *
   * @param {object} drawResult - { draw: Array, drawSize: number, eventName?: string }
   *   draw 配列要素: { name, affiliation, isBye, position, seed }
   * @param {string} eventCode - 種目コード（例: 'ms'）
   * @returns {Array<object>} Match オブジェクト配列
   */
  extractMatchesFromDraw(drawResult, eventCode) {
    const { draw, drawSize } = drawResult;
    const eventName = drawResult.eventName || this._getEventName(eventCode);
    const totalRounds = Math.log2(drawSize);
    const halfSize = drawSize / 2;
    const matches = [];

    // -----------------------------------------------------------------
    //  1回戦（R1）: ドロー配列のペアを走査
    //  各ペア (i, i+1) について:
    //    - 両方非BYE → 実試合
    //    - 片方BYE   → BYE勝ち上がり（R2の依存に記録）
    //    - 両方BYE   → スキップ（あり得ないが念のため）
    // -----------------------------------------------------------------

    // r1Results[i] = { matchId, playerName(s), isByeAdvance }
    // i はペアインデックス (0 .. drawSize/2 - 1)
    const r1Results = [];

    for (let pairIdx = 0; pairIdx < drawSize / 2; pairIdx++) {
      const idx1 = pairIdx * 2;
      const idx2 = pairIdx * 2 + 1;
      const p1 = draw[idx1];
      const p2 = draw[idx2];

      const halfLabel = pairIdx < halfSize / 2 ? 'L' : 'R';
      const matchNumInHalf = halfLabel === 'L'
        ? pairIdx + 1
        : pairIdx - Math.floor(halfSize / 2) + 1;

      const bothBye = p1.isBye && p2.isBye;
      const oneBye = p1.isBye !== p2.isBye;

      if (bothBye) {
        // 両方BYE: 実試合なし
        r1Results.push({ matchId: null, isByeAdvance: true, advancingPlayer: null });
        continue;
      }

      if (oneBye) {
        // BYE勝ち上がり
        const advancer = p1.isBye ? p2 : p1;
        const matchId = `${eventCode}-R1-${halfLabel}${matchNumInHalf}`;
        r1Results.push({
          matchId,
          isByeAdvance: true,
          advancingPlayer: advancer.name,
        });
        // BYE勝ち上がりは試合として記録しない（コートに割り当てない）
        continue;
      }

      // 実試合
      const matchId = `${eventCode}-R1-${halfLabel}${matchNumInHalf}`;
      const match = {
        matchId,
        eventCode,
        eventName,
        round: 1,
        roundLabel: this.getRoundLabel(1, totalRounds),
        matchNumInRound: pairIdx + 1,
        halfLabel,
        players: [p1.name, p2.name],
        hasByeAdvance: false,
        drawSize,
        dependsOn: [],
      };
      matches.push(match);

      r1Results.push({
        matchId,
        isByeAdvance: false,
        advancingPlayer: null,
      });
    }

    // -----------------------------------------------------------------
    //  2回戦以降: トーナメントツリーを辿る
    //  各ラウンドの試合数 = drawSize / (2^round)
    //  各試合は前ラウンドの2試合（またはBYE勝ち上がり）に依存
    // -----------------------------------------------------------------

    // prevRoundSlots[slotIdx] = { matchId | null, isByeAdvance }
    let prevRoundSlots = r1Results;

    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = drawSize / Math.pow(2, round);
      const currentRoundSlots = [];

      for (let slotIdx = 0; slotIdx < matchesInRound; slotIdx++) {
        const feederA = prevRoundSlots[slotIdx * 2];
        const feederB = prevRoundSlots[slotIdx * 2 + 1];

        // 半面判定
        const totalSlotsInHalf = matchesInRound / 2;
        let halfLabel, matchNumInHalf;

        if (round === totalRounds) {
          // 決勝: 特別な matchId
          halfLabel = null;
          matchNumInHalf = null;
        } else {
          halfLabel = slotIdx < totalSlotsInHalf ? 'L' : 'R';
          matchNumInHalf = halfLabel === 'L'
            ? slotIdx + 1
            : slotIdx - totalSlotsInHalf + 1;
        }

        const matchId = round === totalRounds
          ? `${eventCode}-F`
          : `${eventCode}-R${round}-${halfLabel}${matchNumInHalf}`;

        // 依存関係を収集
        const dependsOn = [];
        const hasByeAdvance = feederA.isByeAdvance || feederB.isByeAdvance;
        const players = [];

        if (feederA.matchId && !feederA.isByeAdvance) {
          dependsOn.push(feederA.matchId);
        } else if (feederA.isByeAdvance && feederA.advancingPlayer) {
          players.push(feederA.advancingPlayer);
        }

        if (feederB.matchId && !feederB.isByeAdvance) {
          dependsOn.push(feederB.matchId);
        } else if (feederB.isByeAdvance && feederB.advancingPlayer) {
          players.push(feederB.advancingPlayer);
        }

        // 両方のフィーダーがBYEで試合がない場合（非常にまれ）
        if (!feederA.matchId && !feederB.matchId &&
            feederA.isByeAdvance && feederB.isByeAdvance) {
          // 2人ともBYE勝ち上がり → このラウンドが実質初戦
          // players は上で追加済み
        }

        const match = {
          matchId,
          eventCode,
          eventName,
          round,
          roundLabel: this.getRoundLabel(round, totalRounds),
          matchNumInRound: slotIdx + 1,
          halfLabel: halfLabel || (round === totalRounds ? 'F' : ''),
          players,
          hasByeAdvance,
          drawSize,
          dependsOn,
        };
        matches.push(match);

        currentRoundSlots.push({
          matchId,
          isByeAdvance: false,
          advancingPlayer: null,
        });
      }

      prevRoundSlots = currentRoundSlots;
    }

    return matches;
  },

  // =========================================================================
  //  calcTimeString - 時刻文字列を計算
  // =========================================================================

  /**
   * 開始時刻とスロットインデックスから時刻文字列を計算する
   * @param {string} startTimeStr 開始時刻 'HH:MM'
   * @param {number} slotIndex スロットインデックス（0始まり）
   * @param {number} durationMinutes 1試合の所要時間（分）
   * @returns {string} 'HH:MM' 形式の時刻文字列
   */
  calcTimeString(startTimeStr, slotIndex, durationMinutes) {
    const parts = startTimeStr.split(':');
    const startHour = parseInt(parts[0], 10);
    const startMin = parseInt(parts[1], 10);
    const totalMinutes = startHour * 60 + startMin + slotIndex * durationMinutes;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  },

  // =========================================================================
  //  autoSchedule - 試合を自動スケジューリング
  // =========================================================================

  /**
   * 試合一覧をコート×時間枠のグリッドに自動配置する
   * 照明制約・コート集約ロジック付き
   *
   * @param {Array<object>} matches - Match オブジェクト配列（複数種目を含む）
   * @param {object} config - スケジュール設定
   *   { courtCount: number,
   *     courtNames: string[],    // 例: ['1', '2', ..., '16']
   *     matchDuration: number,   // 分単位（例: 40）
   *     startTime: string }      // 'HH:MM' 形式
   * @returns {Array<object>} ScheduleSlot 配列
   */
  autoSchedule(matches, config) {
    const { courtCount, courtNames, matchDuration, startTime } = config;

    // -----------------------------------------------------------------
    //  ソート: ラウンド昇順 → ドローサイズ降順 → 種目順
    // -----------------------------------------------------------------
    const sorted = [...matches].sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      if (a.drawSize !== b.drawSize) return b.drawSize - a.drawSize;
      return this._getEventOrder(a.eventCode) - this._getEventOrder(b.eventCode);
    });

    // -----------------------------------------------------------------
    //  最大ラウンドを算出（後半判定に使用）
    // -----------------------------------------------------------------
    const maxRound = Math.max(...sorted.map(m => m.round), 1);

    // -----------------------------------------------------------------
    //  グリッドとスケジュール管理
    // -----------------------------------------------------------------
    const maxSlots = 200;
    const grid = [];
    for (let c = 0; c < courtCount; c++) {
      grid.push(new Array(maxSlots).fill(null));
    }

    const completionSlot = {};
    const slotPlayers = {};
    const result = [];

    // -----------------------------------------------------------------
    //  照明制約チェック: コート番号(数値)と時刻から使用可否を判定
    // -----------------------------------------------------------------
    const _isCourtAvailable = (courtNum, slotIdx) => {
      const totalMinutes = this._calcTotalMinutes(startTime, slotIdx, matchDuration);
      const hour = totalMinutes / 60;
      if (courtNum >= 1 && courtNum <= 8) {
        // 照明なし: 18:00以降は使用不可
        return hour < 18;
      }
      if (courtNum >= 9 && courtNum <= 16) {
        // 最大21:00まで
        return hour < 21;
      }
      return true;
    };

    // -----------------------------------------------------------------
    //  コート優先順序を決定する
    //  - 後半（準決勝以降 or ラウンドが全体の60%超）: 5-8, 9-12を優先、特に5,9を最優先
    //  - 前半: 全コートを均等に使用（番号順）
    // -----------------------------------------------------------------
    const _getCourtOrder = (match) => {
      const isLateRound = match.round >= maxRound - 1 || match.round / maxRound > 0.6;
      const indices = [];

      if (isLateRound) {
        // 後半: 本部近く（5, 9）を最優先、次に5-8, 9-12ブロック、最後に1-4, 13-16
        const preferred = [];
        const secondary = [];
        const tertiary = [];

        for (let i = 0; i < courtCount; i++) {
          const num = parseInt(courtNames[i], 10);
          if (num === 5 || num === 9) {
            preferred.push(i);
          } else if ((num >= 6 && num <= 8) || (num >= 10 && num <= 12)) {
            secondary.push(i);
          } else {
            tertiary.push(i);
          }
        }
        indices.push(...preferred, ...secondary, ...tertiary);
      } else {
        // 前半: 番号順にすべて使用
        for (let i = 0; i < courtCount; i++) {
          indices.push(i);
        }
      }
      return indices;
    };

    // -----------------------------------------------------------------
    //  試合配置ループ
    // -----------------------------------------------------------------
    for (const match of sorted) {
      let minSlot = 0;
      for (const depId of match.dependsOn) {
        if (completionSlot[depId] !== undefined) {
          minSlot = Math.max(minSlot, completionSlot[depId] + 1);
        }
      }

      let assigned = false;
      const courtOrder = _getCourtOrder(match);

      for (let slot = minSlot; slot < maxSlots; slot++) {
        if (this._hasPlayerConflict(match, slot, slotPlayers)) {
          continue;
        }

        for (const courtIdx of courtOrder) {
          const courtNum = parseInt(courtNames[courtIdx], 10);

          // 照明制約チェック
          if (!_isCourtAvailable(courtNum, slot)) {
            continue;
          }

          if (grid[courtIdx][slot] === null) {
            grid[courtIdx][slot] = match.matchId;
            completionSlot[match.matchId] = slot;

            if (!slotPlayers[slot]) slotPlayers[slot] = new Set();
            for (const player of match.players) {
              if (player) slotPlayers[slot].add(player);
            }

            result.push({
              matchId: match.matchId,
              courtIndex: courtIdx,
              courtName: courtNames[courtIdx] || String(courtIdx + 1),
              timeSlotIndex: slot,
              startTime: this.calcTimeString(startTime, slot, matchDuration),
              eventCode: match.eventCode,
              roundLabel: match.roundLabel,
            });
            assigned = true;
            break;
          }
        }
        if (assigned) break;
      }

      if (!assigned) {
        console.warn(`スケジュール配置失敗: ${match.matchId}`);
      }
    }

    return result;
  },

  /**
   * 開始時刻とスロットインデックスから総分数を計算する（内部用）
   */
  _calcTotalMinutes(startTime, slotIndex, durationMinutes) {
    const parts = startTime.split(':');
    const startHour = parseInt(parts[0], 10);
    const startMin = parseInt(parts[1], 10);
    return startHour * 60 + startMin + slotIndex * durationMinutes;
  },

  /**
   * 指定スロットで選手の衝突があるかチェックする（内部用）
   * @param {object} match Match オブジェクト
   * @param {number} slot タイムスロットインデックス
   * @param {object} slotPlayers スロット別の選手セットマップ
   * @returns {boolean} 衝突がある場合 true
   */
  _hasPlayerConflict(match, slot, slotPlayers) {
    const playersInSlot = slotPlayers[slot];
    if (!playersInSlot) return false;
    for (const player of match.players) {
      if (player && playersInSlot.has(player)) {
        return true;
      }
    }
    return false;
  },

  // =========================================================================
  //  buildScheduleMap - スケジュール結果をマップに変換
  // =========================================================================

  /**
   * ScheduleSlot 配列を matchId → { startTime, courtName } のマップに変換する
   * DrawRenderer での時刻注記表示などに使用
   *
   * @param {Array<object>} slots ScheduleSlot 配列
   * @returns {object} { [matchId]: { startTime, courtName } }
   */
  buildScheduleMap(slots) {
    const map = {};
    for (const slot of slots) {
      map[slot.matchId] = {
        startTime: slot.startTime,
        courtName: slot.courtName,
      };
    }
    return map;
  },
};
