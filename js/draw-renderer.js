/**
 * draw-renderer.js - トーナメント表描画（左右の山形式）+ Excel出力
 * 参考: R7県選シングルスドロー(再々).xlsx のプログラムシート
 * グローバルスコープ (window.DrawRenderer) にエクスポート
 * 依存: window.AppConfig, XLSX (SheetJS)
 */
window.DrawRenderer = {

  PARAMS: {
    slotHeight: 28,           // 1スロットの高さ (選手+間隔で2スロット使う)
    roundWidth: 100,          // ラウンドごとの幅
    nameAreaWidth: 200,       // 選手名+所属エリア幅（切り詰め）
    drawNumWidth: 24,         // ドロー番号列幅（切り詰め）
    headerHeight: 50,         // ヘッダー高さ（圧縮）
    footerHeight: 30,         // フッター高さ（圧縮・シード1行時）
    footerHeight2Row: 48,     // フッター高さ（シード2行時）
    centerGap: 60,            // 左右の山の中央間隔（圧縮）
    fontSize: {
      title: 18, eventName: 15, meta: 12,
      playerName: 13, affiliation: 10, bye: 11,
      drawNum: 12, seed: 11, roundLabel: 11,
    },
    colors: {
      text: '#222', subText: '#666', bye: '#aaa',
      line: '#333', emptySlot: '#ddd',
      seedHighlight: '#E3F2FD',
    },
  },

  /**
   * 確定済みモード用: BYEを除去した圧縮ドローデータを生成
   * 1回戦でBYEと対戦する選手は2回戦に直接進出する形に変換
   */
  _buildCompactDraw(halfDraw, halfSize) {
    // 1回戦ペア(0,1),(2,3),...のBYE判定
    const compacted = [];
    // round1Winners: 各1回戦ペアの勝者(BYEの場合は非BYE側, 両方BYEはスキップ)
    for (let i = 0; i < halfSize; i += 2) {
      const top = halfDraw[i];
      const bottom = halfDraw[i + 1];
      const topBye = top && top.isBye;
      const bottomBye = bottom && bottom.isBye;

      if (topBye && bottomBye) {
        // 両方BYE: 完全省略（2回戦の1スロットだけ作る）
        compacted.push({ type: 'bye-pair' });
      } else if (topBye) {
        // 上がBYE: 下の選手が不戦勝→2回戦直接
        compacted.push({ type: 'bye-pass', entry: bottom });
      } else if (bottomBye) {
        // 下がBYE: 上の選手が不戦勝→2回戦直接
        compacted.push({ type: 'bye-pass', entry: top });
      } else {
        // 通常の1回戦対戦
        compacted.push({ type: 'match', top: top, bottom: bottom });
      }
    }
    return compacted;
  },

  /**
   * SVGでトーナメント表を描画（左右の山形式・参考Excel準拠レイアウト）
   */
  render(container, drawData, options) {
    options = options || {};
    const P = this.PARAMS;
    const draw = drawData.draw;
    const drawSize = drawData.drawSize;
    const rounds = Math.log2(drawSize);
    const halfSize = drawSize / 2;
    const halfRounds = rounds - 1;
    const isConfirmed = options && options.confirmed;

    // ドローサイズに応じてslotHeightを動的に調整
    const vScale = options.scale || 1.0;
    let hScale = options.hScale || 1.0;
    const baseSlotHeight = drawSize <= 16 ? 28 : drawSize <= 32 ? 22 : drawSize <= 64 ? 16 : 12;
    P.slotHeight = Math.round(baseSlotHeight * vScale);

    // 確定済みモード: BYE分を圧縮してslotHeightを拡大
    let effectiveHalfSlots = halfSize;
    if (isConfirmed) {
      const leftDraw = draw.slice(0, halfSize);
      const rightDraw = draw.slice(halfSize);
      const leftCompact = this._buildCompactDraw(leftDraw, halfSize);
      const rightCompact = this._buildCompactDraw(rightDraw, halfSize);
      // match=2スロット, bye-pass=1スロット, bye-pair=0スロット
      const leftSlots = leftCompact.reduce((s, c) => s + (c.type === 'match' ? 2 : c.type === 'bye-pass' ? 1 : 0), 0);
      const rightSlots = rightCompact.reduce((s, c) => s + (c.type === 'match' ? 2 : c.type === 'bye-pass' ? 1 : 0), 0);
      effectiveHalfSlots = Math.max(leftSlots, rightSlots);
      if (effectiveHalfSlots < halfSize) {
        const ratio = halfSize / effectiveHalfSlots;
        P.slotHeight = Math.round(P.slotHeight * Math.min(ratio, 1.8));
      }
    }

    // 文字サイズは常に固定
    P.nameAreaWidth = 200;
    P.fontSize.playerName = 13;
    P.fontSize.affiliation = 10;

    // コンテナ幅に自動フィット
    const autoFit = options.autoFit !== false;
    const baseRoundWidth = 80;
    const baseCenterGap = 50;

    if (autoFit) {
      const fixedWidth = (P.drawNumWidth + P.nameAreaWidth) * 2;
      const baseLineWidth = baseRoundWidth * 2 * halfRounds + baseCenterGap;
      const baseTotalWidth = fixedWidth + baseLineWidth;
      const containerWidth = container.clientWidth || container.offsetWidth || 0;
      if (containerWidth > 0 && baseTotalWidth > containerWidth) {
        const minRoundWidth = 20;
        const minCenterGap = 16;
        const availForLines = containerWidth - fixedWidth;
        const minLineWidth = minRoundWidth * 2 * halfRounds + minCenterGap;
        if (availForLines >= minLineWidth) {
          const ratio = availForLines / baseLineWidth;
          P.roundWidth = Math.max(minRoundWidth, Math.round(baseRoundWidth * ratio));
          P.centerGap = Math.max(minCenterGap, Math.round(baseCenterGap * ratio));
        } else {
          P.roundWidth = minRoundWidth;
          P.centerGap = minCenterGap;
        }
      } else {
        P.roundWidth = Math.round(baseRoundWidth * hScale);
        P.centerGap = Math.round(baseCenterGap * hScale);
      }
    } else {
      P.roundWidth = Math.round(baseRoundWidth * hScale);
      P.centerGap = Math.round(baseCenterGap * hScale);
    }

    const slotsPerHalf = isConfirmed ? effectiveHalfSlots * 2 : halfSize * 2;
    const bracketBodyHeight = slotsPerHalf * P.slotHeight;
    const halfWidth = P.drawNumWidth + P.nameAreaWidth + halfRounds * P.roundWidth;
    const totalWidth = halfWidth * 2 + P.centerGap;
    const seedCount = (drawData.seeds || []).length;
    const footerH = seedCount > 8 ? P.footerHeight2Row : P.footerHeight;
    const totalHeight = P.headerHeight + bracketBodyHeight + footerH;

    let svg = container.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);
    }
    svg.innerHTML = '';
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', totalWidth);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', '0 0 ' + totalWidth + ' ' + totalHeight);
    svg.style.fontFamily = "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif";

    this._drawHeader(svg, drawData, options, totalWidth);

    const bodyTop = P.headerHeight;
    const leftDraw = draw.slice(0, halfSize);
    const rightDraw = draw.slice(halfSize);

    this._drawHalf(svg, leftDraw, halfSize, halfRounds, bodyTop, 0, 'left', options);
    this._drawHalf(svg, rightDraw, halfSize, halfRounds, bodyTop, halfWidth + P.centerGap, 'right', options);
    this._drawFinal(svg, halfSize, halfRounds, bodyTop, halfWidth, totalWidth, bracketBodyHeight);
    this._drawSeedInfo(svg, drawData, bodyTop + bracketBodyHeight + 8, totalWidth);
  },

  _drawHeader(svg, drawData, options, totalWidth) {
    const P = this.PARAMS;
    const eventName = drawData.eventName || '';
    this._text(svg, 4, 16, eventName, {
      fontSize: P.fontSize.title, fontWeight: 'bold', fill: P.colors.text,
    });
    const tournamentName = drawData.tournamentName || AppConfig.TOURNAMENT_NAME || '';
    const matchFormat = options.matchFormat || drawData.matchFormat || AppConfig.MATCH_FORMAT || '';
    const infoX = totalWidth - 4;
    this._text(svg, infoX, 14, tournamentName, {
      fontSize: P.fontSize.meta + 1, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'end',
    });
    const dateParts = [];
    if (drawData.date) dateParts.push(drawData.date);
    if (drawData.venue) dateParts.push(drawData.venue);
    if (dateParts.length > 0) {
      this._text(svg, infoX, 28, dateParts.join('  '), {
        fontSize: P.fontSize.meta, fill: P.colors.subText, textAnchor: 'end',
      });
    }
    if (matchFormat) {
      this._text(svg, infoX, 42, matchFormat, {
        fontSize: P.fontSize.meta, fill: P.colors.subText, textAnchor: 'end',
      });
    }
  },

  /**
   * 半分のブラケットを描画
   */
  _drawHalf(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction, options) {
    const P = this.PARAMS;
    const isLeft = direction === 'left';
    const isConfirmed = options && options.confirmed;

    const playerY = (i) => bodyTop + (i * 2) * P.slotHeight + P.slotHeight / 2;

    // クリッピング
    const clipId = direction + '-name-clip-' + Math.random().toString(36).substr(2, 6);
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', clipId);
    const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    if (isLeft) {
      clipRect.setAttribute('x', offsetX + P.drawNumWidth);
    } else {
      clipRect.setAttribute('x', offsetX + rounds * P.roundWidth + P.drawNumWidth);
    }
    clipRect.setAttribute('y', 0);
    clipRect.setAttribute('width', P.nameAreaWidth);
    clipRect.setAttribute('height', 99999);
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);

    // 所属X座標計算
    const estimateTextWidth = (text, fontSize) => {
      let w = 0;
      for (const ch of text) {
        w += ch.charCodeAt(0) > 0x7F ? fontSize : fontSize * 0.55;
      }
      return w;
    };
    let maxNameWidth = 0;
    for (let i = 0; i < halfSize; i++) {
      const entry = halfDraw[i];
      if (entry.isBye || entry.isEmpty) continue;
      const isDoublesEntry = entry.name && entry.name.includes(' / ');
      const fs = isDoublesEntry ? P.fontSize.playerName - 1 : P.fontSize.playerName;
      if (isDoublesEntry) {
        const players = entry.name.split(' / ');
        maxNameWidth = Math.max(maxNameWidth, estimateTextWidth(players[0] || '', fs), estimateTextWidth(players[1] || '', fs));
      } else {
        maxNameWidth = Math.max(maxNameWidth, estimateTextWidth(entry.name || '', fs));
      }
    }
    const affiliationX_offset = Math.min(P.nameAreaWidth * 0.65, Math.max(70, maxNameWidth + 8));

    // 確定済みモード: BYE圧縮描画
    if (isConfirmed) {
      this._drawHalfConfirmed(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction, clipId, affiliationX_offset);
      return;
    }

    // --- 通常モード: 選手描画 ---
    this._drawHalfPlayers(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction, clipId, affiliationX_offset, false);
    this._drawHalfBrackets(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction, null);
  },

  /**
   * 確定済みモード: BYEを除去した圧縮描画
   */
  _drawHalfConfirmed(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction, clipId, affiliationX_offset) {
    const P = this.PARAMS;
    const isLeft = direction === 'left';
    const compact = this._buildCompactDraw(halfDraw, halfSize);

    // 連番カウンター
    let posCounter = direction === 'left' ? 1 : halfSize + 1;

    // 圧縮後のスロットY位置マッピング
    // 各compactアイテムにY位置を割り当て（match=2スロット分, bye-pass=1スロット分）
    let slotIdx = 0;
    const itemYs = []; // 各compact itemの{topY, bottomY, midY}

    for (const item of compact) {
      if (item.type === 'match') {
        const topY = bodyTop + slotIdx * 2 * P.slotHeight + P.slotHeight / 2;
        const bottomY = bodyTop + (slotIdx * 2 + 2) * P.slotHeight + P.slotHeight / 2;
        const midY = (topY + bottomY) / 2;
        itemYs.push({ topY, bottomY, midY, type: 'match' });
        slotIdx += 2;
      } else if (item.type === 'bye-pass') {
        const cy = bodyTop + slotIdx * 2 * P.slotHeight + P.slotHeight / 2;
        itemYs.push({ topY: cy, bottomY: cy, midY: cy, type: 'bye-pass' });
        slotIdx += 1;
      } else {
        // bye-pair: スキップ（描画なし）
        itemYs.push({ topY: 0, bottomY: 0, midY: 0, type: 'bye-pair' });
      }
    }

    let nameX, numX;
    if (isLeft) {
      numX = offsetX + P.drawNumWidth / 2;
      nameX = offsetX + P.drawNumWidth + 4;
    } else {
      numX = offsetX + rounds * P.roundWidth + P.drawNumWidth / 2;
      nameX = offsetX + rounds * P.roundWidth + P.drawNumWidth + 4;
    }

    // 選手描画
    for (let ci = 0; ci < compact.length; ci++) {
      const item = compact[ci];
      const iy = itemYs[ci];

      if (item.type === 'match') {
        // 通常対戦: 2人描画
        this._drawPlayerEntry(svg, item.top, iy.topY, nameX, numX, posCounter++, clipId, affiliationX_offset);
        this._drawSeparatorLine(svg, iy.topY, offsetX, rounds, isLeft);
        this._drawPlayerEntry(svg, item.bottom, iy.bottomY, nameX, numX, posCounter++, clipId, affiliationX_offset);
        this._drawSeparatorLine(svg, iy.bottomY, offsetX, rounds, isLeft);
      } else if (item.type === 'bye-pass') {
        // BYE不戦勝: 1人だけ描画
        this._drawPlayerEntry(svg, item.entry, iy.midY, nameX, numX, posCounter++, clipId, affiliationX_offset);
        this._drawSeparatorLine(svg, iy.midY, offsetX, rounds, isLeft);
      }
    }

    // --- ブラケット罫線 ---
    // 1回戦
    const lineX0 = isLeft
      ? offsetX + P.drawNumWidth + P.nameAreaWidth
      : offsetX + (rounds - 1) * P.roundWidth + P.roundWidth;
    const nextX0 = isLeft ? lineX0 + P.roundWidth : lineX0 - P.roundWidth;

    for (let ci = 0; ci < compact.length; ci++) {
      const item = compact[ci];
      const iy = itemYs[ci];
      if (item.type === 'match') {
        // 横線上下 + 縦線
        this._line(svg, lineX0, iy.topY, nextX0, iy.topY, P.colors.line);
        this._line(svg, lineX0, iy.bottomY, nextX0, iy.bottomY, P.colors.line);
        const vertX = nextX0;
        this._line(svg, vertX, iy.topY, vertX, iy.bottomY, P.colors.line);
      } else if (item.type === 'bye-pass') {
        // 横線のみ（パススルー）
        this._line(svg, lineX0, iy.midY, nextX0, iy.midY, P.colors.line);
      }
    }

    // 2回戦以降
    // 2回戦のペアは compact の隣接2項目がペアになる
    for (let round = 1; round < rounds; round++) {
      const pairCount = compact.length / Math.pow(2, round);
      const groupSize = Math.pow(2, round);

      let lineX, nextRoundX;
      if (isLeft) {
        lineX = offsetX + P.drawNumWidth + P.nameAreaWidth + round * P.roundWidth;
        nextRoundX = lineX + P.roundWidth;
      } else {
        lineX = offsetX + (rounds - 1 - round) * P.roundWidth + P.roundWidth;
        nextRoundX = lineX - P.roundWidth;
      }

      for (let p = 0; p < pairCount; p++) {
        const startIdx = p * groupSize;
        const midIdx = startIdx + groupSize / 2;
        const endIdx = startIdx + groupSize - 1;

        // 上半分の出口Y（前ラウンドの中間Y）
        const topMids = [];
        for (let k = startIdx; k < midIdx; k++) {
          if (itemYs[k].type !== 'bye-pair') topMids.push(itemYs[k].midY);
        }
        const bottomMids = [];
        for (let k = midIdx; k <= endIdx; k++) {
          if (itemYs[k].type !== 'bye-pair') bottomMids.push(itemYs[k].midY);
        }

        if (topMids.length === 0 && bottomMids.length === 0) continue;

        const topOutY = topMids.length > 0 ? (topMids[0] + topMids[topMids.length - 1]) / 2 : 0;
        const bottomOutY = bottomMids.length > 0 ? (bottomMids[0] + bottomMids[bottomMids.length - 1]) / 2 : 0;

        if (topMids.length > 0 && bottomMids.length > 0) {
          this._line(svg, lineX, topOutY, nextRoundX, topOutY, P.colors.line);
          this._line(svg, lineX, bottomOutY, nextRoundX, bottomOutY, P.colors.line);
          this._line(svg, nextRoundX, topOutY, nextRoundX, bottomOutY, P.colors.line);
        } else if (topMids.length > 0) {
          this._line(svg, lineX, topOutY, nextRoundX, topOutY, P.colors.line);
        } else {
          this._line(svg, lineX, bottomOutY, nextRoundX, bottomOutY, P.colors.line);
        }

        // 次ラウンド用にmidYを更新
        // このペアの出口Y = (topOutY + bottomOutY) / 2
        const pairMidY = (topMids.length > 0 && bottomMids.length > 0)
          ? (topOutY + bottomOutY) / 2
          : (topMids.length > 0 ? topOutY : bottomOutY);

        // itemYsのこのグループ全体のmidYを更新
        for (let k = startIdx; k <= endIdx; k++) {
          itemYs[k].midY = pairMidY;
        }
      }
    }
  },

  /**
   * 選手エントリー1件を描画
   */
  _drawPlayerEntry(svg, entry, cy, nameX, numX, displayPos, clipId, affiliationX_offset) {
    const P = this.PARAMS;
    const affilX = nameX + affiliationX_offset;

    // ドロー番号
    const posEl = this._text(svg, numX, cy, String(displayPos), {
      fontSize: P.fontSize.drawNum, fill: P.colors.text, fontWeight: 'bold', textAnchor: 'middle',
    });
    posEl.setAttribute('dominant-baseline', 'central');

    const isDoublesEntry = entry.name && entry.name.includes(' / ');
    if (isDoublesEntry) {
      const players = entry.name.split(' / ');
      const affiliations = (entry.affiliation || '').split(' / ');
      const lineGap = Math.max(P.slotHeight * 0.40, 11);
      const y1 = cy - lineGap / 2;
      const y2 = cy + lineGap / 2;
      const el1 = this._text(svg, nameX, y1, players[0] || '', {
        fontSize: P.fontSize.playerName - 1, fill: P.colors.text, fontWeight: 'bold',
      });
      el1.setAttribute('dominant-baseline', 'central');
      el1.setAttribute('clip-path', 'url(#' + clipId + ')');
      const af1 = this._text(svg, affilX, y1, affiliations[0] || '', {
        fontSize: P.fontSize.affiliation, fill: P.colors.subText,
      });
      af1.setAttribute('dominant-baseline', 'central');
      af1.setAttribute('clip-path', 'url(#' + clipId + ')');
      const el2 = this._text(svg, nameX, y2, players[1] || '', {
        fontSize: P.fontSize.playerName - 1, fill: P.colors.text, fontWeight: 'bold',
      });
      el2.setAttribute('dominant-baseline', 'central');
      el2.setAttribute('clip-path', 'url(#' + clipId + ')');
      const af2 = this._text(svg, affilX, y2, affiliations[1] || affiliations[0] || '', {
        fontSize: P.fontSize.affiliation, fill: P.colors.subText,
      });
      af2.setAttribute('dominant-baseline', 'central');
      af2.setAttribute('clip-path', 'url(#' + clipId + ')');
    } else {
      const nameEl = this._text(svg, nameX, cy, entry.name, {
        fontSize: P.fontSize.playerName, fill: P.colors.text, fontWeight: 'bold',
      });
      nameEl.setAttribute('dominant-baseline', 'central');
      nameEl.setAttribute('clip-path', 'url(#' + clipId + ')');
      if (entry.affiliation) {
        const afEl = this._text(svg, affilX, cy, entry.affiliation, {
          fontSize: P.fontSize.affiliation, fill: P.colors.subText,
        });
        afEl.setAttribute('dominant-baseline', 'central');
        afEl.setAttribute('clip-path', 'url(#' + clipId + ')');
      }
    }
  },

  /**
   * 選手名の下の区切り線
   */
  _drawSeparatorLine(svg, cy, offsetX, rounds, isLeft) {
    const P = this.PARAMS;
    const lineY = cy + P.slotHeight / 2;
    if (isLeft) {
      const x1 = offsetX + P.drawNumWidth;
      const x2 = offsetX + P.drawNumWidth + P.nameAreaWidth;
      this._line(svg, x1, lineY, x2, lineY, '#ddd', 0.5);
    } else {
      const x1 = offsetX + rounds * P.roundWidth;
      const x2 = x1 + P.drawNumWidth + P.nameAreaWidth;
      this._line(svg, x1, lineY, x2, lineY, '#ddd', 0.5);
    }
  },

  /**
   * 通常モードの選手描画
   */
  _drawHalfPlayers(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction, clipId, affiliationX_offset, isConfirmed) {
    const P = this.PARAMS;
    const isLeft = direction === 'left';
    const playerY = (i) => bodyTop + (i * 2) * P.slotHeight + P.slotHeight / 2;

    let nameX, numX;
    if (isLeft) {
      numX = offsetX + P.drawNumWidth / 2;
      nameX = offsetX + P.drawNumWidth + 4;
    } else {
      numX = offsetX + rounds * P.roundWidth + P.drawNumWidth / 2;
      nameX = offsetX + rounds * P.roundWidth + P.drawNumWidth + 4;
    }

    for (let i = 0; i < halfSize; i++) {
      const entry = halfDraw[i];
      const cy = playerY(i);
      const affilX = nameX + affiliationX_offset;

      if (entry.isBye) {
        const byeEl = this._text(svg, nameX, cy, 'BYE', {
          fontSize: P.fontSize.bye, fill: P.colors.bye, fontStyle: 'italic',
        });
        byeEl.setAttribute('dominant-baseline', 'central');
        const byeNum = this._text(svg, numX, cy, String(entry.position), {
          fontSize: P.fontSize.drawNum, fill: P.colors.bye, textAnchor: 'middle',
        });
        byeNum.setAttribute('dominant-baseline', 'central');
      } else if (entry.isEmpty) {
        const emptyEl = this._text(svg, nameX, cy, '---', {
          fontSize: P.fontSize.playerName, fill: P.colors.emptySlot,
        });
        emptyEl.setAttribute('dominant-baseline', 'central');
        const emptyNum = this._text(svg, numX, cy, String(entry.position), {
          fontSize: P.fontSize.drawNum, fill: P.colors.emptySlot, textAnchor: 'middle',
        });
        emptyNum.setAttribute('dominant-baseline', 'central');
      } else {
        this._drawPlayerEntry(svg, entry, cy, nameX, numX, entry.position, clipId, affiliationX_offset);
      }

      // 区切り線
      if (!entry.isBye || !isConfirmed) {
        this._drawSeparatorLine(svg, cy, offsetX, rounds, isLeft);
      }
    }
  },

  /**
   * 通常モードのブラケット罫線描画
   */
  _drawHalfBrackets(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction, options) {
    const P = this.PARAMS;
    const isLeft = direction === 'left';
    const playerY = (i) => bodyTop + (i * 2) * P.slotHeight + P.slotHeight / 2;

    for (let round = 0; round < rounds; round++) {
      const pairSize = Math.pow(2, round + 1);
      const matchCount = halfSize / pairSize;

      for (let match = 0; match < matchCount; match++) {
        const blockStart = match * pairSize;
        let topY, bottomY;
        if (round === 0) {
          topY = playerY(blockStart);
          bottomY = playerY(blockStart + 1);
        } else {
          const prevPairSize = pairSize / 2;
          topY = (playerY(blockStart) + playerY(blockStart + prevPairSize - 1)) / 2;
          bottomY = (playerY(blockStart + prevPairSize) + playerY(blockStart + pairSize - 1)) / 2;
        }

        let lineX, nextX;
        if (isLeft) {
          lineX = offsetX + P.drawNumWidth + P.nameAreaWidth + round * P.roundWidth;
          nextX = lineX + P.roundWidth;
        } else {
          lineX = offsetX + (rounds - 1 - round) * P.roundWidth + P.roundWidth;
          nextX = lineX - P.roundWidth;
        }

        this._line(svg, lineX, topY, nextX, topY, P.colors.line);
        this._line(svg, lineX, bottomY, nextX, bottomY, P.colors.line);
        this._line(svg, nextX, topY, nextX, bottomY, P.colors.line);
      }
    }
  },

  /**
   * 決勝線
   */
  _drawFinal(svg, halfSize, halfRounds, bodyTop, halfWidth, totalWidth, bracketBodyHeight) {
    const P = this.PARAMS;
    const centerX = totalWidth / 2;
    const finalY = bodyTop + bracketBodyHeight / 2;
    const leftEndX = P.drawNumWidth + P.nameAreaWidth + halfRounds * P.roundWidth;
    this._line(svg, leftEndX, finalY, centerX, finalY, P.colors.line);
    const rightStartX = halfWidth + P.centerGap;
    this._line(svg, rightStartX, finalY, centerX, finalY, P.colors.line);
    this._line(svg, centerX, finalY, centerX, finalY - 30, P.colors.line, 1);
  },

  _drawSeedInfo(svg, drawData, y, totalWidth) {
    const P = this.PARAMS;
    const seeds = drawData.seeds || [];
    if (seeds.length === 0) return;
    const isDoubles = drawData.isDoubles || false;
    const formatSeed = (s) => {
      let displayName = s.name;
      if (isDoubles && displayName.includes(' / ')) {
        displayName = displayName.split(' / ').map(n => n.split(/\s+/)[0]).join('/');
      }
      return s.seed + '.' + displayName;
    };
    const seedSep = '\u3000';
    if (seeds.length > 8) {
      const half = Math.ceil(seeds.length / 2);
      const line1 = 'シード  ' + seeds.slice(0, half).map(formatSeed).join(seedSep);
      const line2 = seeds.slice(half).map(formatSeed).join(seedSep);
      this._text(svg, totalWidth / 2, y, line1, {
        fontSize: P.fontSize.seed, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'middle',
      });
      this._text(svg, totalWidth / 2, y + 16, line2, {
        fontSize: P.fontSize.seed, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'middle',
      });
    } else {
      const seedText = 'シード  ' + seeds.map(formatSeed).join(seedSep);
      this._text(svg, totalWidth / 2, y, seedText, {
        fontSize: P.fontSize.seed, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'middle',
      });
    }
  },

  // =============================================================
  // Excel出力
  // =============================================================

  exportToExcel(drawData) {
    if (typeof XLSX === 'undefined') { alert('SheetJS (XLSX) が読み込まれていません'); return; }
    const draw = drawData.draw;
    const drawSize = drawData.drawSize;
    const halfSize = drawSize / 2;
    const rounds = Math.log2(drawSize);
    const halfRounds = rounds - 1;
    const eventName = drawData.eventName || 'ドロー表';
    const isDoubles = drawData.isDoubles || false;
    const isConfirmed = drawData.confirmed || false;
    const wb = XLSX.utils.book_new();
    const wsData = [];

    const leftDataCols = 5;
    const rightDataCols = 4;
    const centerCols = 2;
    const totalCols = leftDataCols + halfRounds + centerCols + halfRounds + rightDataCols;

    const colWidths = [];
    colWidths.push({ wch: 1 }, { wch: 4 }, { wch: 16 }, { wch: 10 }, { wch: 1.5 });
    for (let r = 0; r < halfRounds; r++) colWidths.push({ wch: 5 });
    colWidths.push({ wch: 3 }, { wch: 3 });
    for (let r = 0; r < halfRounds; r++) colWidths.push({ wch: 5 });
    colWidths.push({ wch: 1.5 }, { wch: 4 }, { wch: 16 }, { wch: 10 });

    const matchFormat = drawData.matchFormat || AppConfig.MATCH_FORMAT || '';
    const centerLeftCol = leftDataCols + halfRounds;
    wsData.push(new Array(totalCols).fill(''));
    const h1 = new Array(totalCols).fill('');
    h1[1] = eventName;
    h1[centerLeftCol] = drawData.tournamentName || AppConfig.TOURNAMENT_NAME || '';
    wsData.push(h1);
    const h2 = new Array(totalCols).fill('');
    const dateVenue = [];
    if (drawData.date) dateVenue.push(drawData.date);
    if (drawData.venue) dateVenue.push(drawData.venue);
    h2[centerLeftCol] = dateVenue.join('  ');
    wsData.push(h2);
    const h3 = new Array(totalCols).fill('');
    h3[centerLeftCol] = matchFormat;
    wsData.push(h3);
    wsData.push(new Array(totalCols).fill(''));
    const headerRows = 5;

    const leftDraw = draw.slice(0, halfSize);
    const rightDraw = draw.slice(halfSize);
    const rightStartCol = leftDataCols + halfRounds + centerCols + halfRounds;

    const singlesMerges = [];

    if (isConfirmed) {
      // 確定済み: BYE圧縮出力
      this._buildExcelConfirmed(wsData, leftDraw, rightDraw, halfSize, isDoubles, leftDataCols, rightStartCol, totalCols, singlesMerges);
    } else {
      // 通常出力
      this._buildExcelNormal(wsData, leftDraw, rightDraw, halfSize, isDoubles, leftDataCols, rightStartCol, totalCols, singlesMerges);
    }

    // シード情報行
    wsData.push(new Array(totalCols).fill(''));
    const seeds = drawData.seeds || [];
    const seedInfoRow = seeds.length > 0 ? wsData.length : -1;
    if (seeds.length > 0) {
      const seedRow = new Array(totalCols).fill('');
      seedRow[0] = 'シード: ' + seeds.map(s => {
        let displayName = s.name;
        if (isDoubles && displayName.includes(' / ')) {
          displayName = displayName.split(' / ').map(n => n.split(/\s+/)[0]).join('/');
        }
        return s.seed + '.' + displayName;
      }).join('  ');
      wsData.push(seedRow);
    }
    wsData.push(new Array(totalCols).fill(''));

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = colWidths;

    const border = (style) => ({ style: style || 'thin', color: { rgb: '000000' } });
    const cellRef = (r, c) => XLSX.utils.encode_cell({ r: r, c: c });
    const ensureCell = (r, c) => {
      const ref = cellRef(r, c);
      if (!ws[ref]) ws[ref] = { v: '', t: 's' };
      if (!ws[ref].s) ws[ref].s = {};
      if (!ws[ref].s.border) ws[ref].s.border = {};
      return ws[ref];
    };

    if (!ws['!merges']) ws['!merges'] = [];

    // ヘッダースタイル
    const h1cell = ensureCell(1, 1);
    h1cell.s.font = { bold: true, sz: 14 };
    const eventMergeEnd = leftDataCols + halfRounds - 1;
    ws['!merges'].push({ s: { r: 1, c: 1 }, e: { r: 1, c: eventMergeEnd } });
    for (let hRow = 1; hRow <= 3; hRow++) {
      const hCell = ensureCell(hRow, centerLeftCol);
      if (!hCell.s.alignment) hCell.s.alignment = {};
      hCell.s.alignment.horizontal = 'right';
      if (hRow === 1) {
        if (!hCell.s.font) hCell.s.font = {};
        hCell.s.font.bold = true;
      }
      ws['!merges'].push({ s: { r: hRow, c: centerLeftCol }, e: { r: hRow, c: totalCols - 1 } });
    }

    // 結合セル
    for (const sm of singlesMerges) {
      const cols = sm.side === 'left' ? [1, 2, 3] : [rightStartCol + 1, rightStartCol + 2, rightStartCol + 3];
      for (const c of cols) {
        ws['!merges'].push({ s: { r: sm.row, c: c }, e: { r: sm.row + 1, c: c } });
        const cell = ensureCell(sm.row, c);
        if (!cell.s.alignment) cell.s.alignment = {};
        cell.s.alignment.vertical = 'center';
      }
    }

    // ブラケット罫線は wsData._bracketInfo から生成
    if (wsData._bracketInfo) {
      for (const bi of wsData._bracketInfo) {
        const cellTop = ensureCell(bi.topRow, bi.col);
        cellTop.s.border.bottom = border();
        const cellBottom = ensureCell(bi.bottomRow, bi.col);
        cellBottom.s.border.bottom = border();
        const borderSide = bi.side === 'left' ? 'right' : 'left';
        for (let r = bi.topRow + 1; r <= bi.bottomRow; r++) {
          const cell = ensureCell(r, bi.col);
          cell.s.border[borderSide] = border();
        }
      }
    }

    // 区切り線
    if (wsData._separatorRows) {
      for (const sr of wsData._separatorRows) {
        for (let c = 1; c < leftDataCols - 1; c++) {
          ensureCell(sr, c).s.border.bottom = border('hair');
        }
        for (let c = rightStartCol + 1; c < rightStartCol + rightDataCols; c++) {
          ensureCell(sr, c).s.border.bottom = border('hair');
        }
      }
    }

    // 決勝線
    const totalDataRows = wsData.length - headerRows;
    const midRow = headerRows + Math.floor(totalDataRows / 2) - 1;
    const centerRightCol = centerLeftCol + 1;
    const finalRoundLeftCol = leftDataCols + halfRounds - 1;
    for (let c = finalRoundLeftCol + 1; c <= centerLeftCol; c++) {
      ensureCell(midRow, c).s.border.bottom = border();
    }
    const finalRoundRightCol = leftDataCols + halfRounds + centerCols;
    for (let c = finalRoundRightCol - 1; c >= centerRightCol; c--) {
      ensureCell(midRow, c).s.border.bottom = border();
    }
    ensureCell(midRow, centerLeftCol).s.border.right = border();

    if (seedInfoRow >= 0) {
      ws['!merges'].push({ s: { r: seedInfoRow, c: 0 }, e: { r: seedInfoRow, c: totalCols - 1 } });
      const seedCell = ensureCell(seedInfoRow, 0);
      if (!seedCell.s.alignment) seedCell.s.alignment = {};
      seedCell.s.alignment.horizontal = 'center';
      if (!seedCell.s.font) seedCell.s.font = {};
      seedCell.s.font.bold = true;
    }

    XLSX.utils.book_append_sheet(wb, ws, eventName.substring(0, 31));

    // エントリーリストシート
    const entryData = [['エントリーリスト - ' + eventName], ['順位', '氏名', 'ふりがな', '所属', 'ポイント']];
    const sorted = [...(drawData.entries || [])].filter(e => !e.isBye).sort((a, b) => (b.points || 0) - (a.points || 0));
    sorted.forEach((e, i) => {
      entryData.push([i + 1, e.name, e.furigana || '', e.affiliation || '', e.points || 0]);
    });
    const wsEntry = XLSX.utils.aoa_to_sheet(entryData);
    wsEntry['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsEntry, 'エントリーリスト');

    XLSX.writeFile(wb, eventName.replace(/[\\/:*?"<>|]/g, '_') + '_ドロー表.xlsx');
  },

  /**
   * 通常Excel出力（BYEあり）
   */
  _buildExcelNormal(wsData, leftDraw, rightDraw, halfSize, isDoubles, leftDataCols, rightStartCol, totalCols, singlesMerges) {
    const headerRows = wsData.length;
    wsData._bracketInfo = [];
    wsData._separatorRows = [];
    const rounds = Math.log2(halfSize * 2);
    const halfRounds = rounds - 1;
    const centerCols = 2;

    for (let i = 0; i < halfSize; i++) {
      const left = leftDraw[i];
      const right = rightDraw[i];
      const leftIsDoubles = isDoubles && !left.isBye && left.name && left.name.includes(' / ');
      const rightIsDoubles = isDoubles && !right.isBye && right.name && right.name.includes(' / ');

      if (leftIsDoubles || rightIsDoubles) {
        const lp = leftIsDoubles ? left.name.split(' / ') : [left.isBye ? 'bye' : left.name, ''];
        const la = leftIsDoubles ? (left.affiliation || '').split(' / ') : [left.isBye ? '' : (left.affiliation || ''), ''];
        const rp = rightIsDoubles ? right.name.split(' / ') : [right.isBye ? 'bye' : right.name, ''];
        const ra = rightIsDoubles ? (right.affiliation || '').split(' / ') : [right.isBye ? '' : (right.affiliation || ''), ''];
        const row1 = new Array(totalCols).fill('');
        row1[1] = left.isBye ? '' : left.position;
        row1[2] = lp[0]; row1[3] = la[0] || '';
        row1[rightStartCol + 1] = right.isBye ? '' : right.position;
        row1[rightStartCol + 2] = rp[0]; row1[rightStartCol + 3] = ra[0] || '';
        wsData.push(row1);
        const row2 = new Array(totalCols).fill('');
        row2[2] = left.isBye ? '' : (lp[1] || '');
        row2[3] = left.isBye ? '' : (la[1] || la[0] || '');
        row2[rightStartCol + 2] = right.isBye ? '' : (rp[1] || '');
        row2[rightStartCol + 3] = right.isBye ? '' : (ra[1] || ra[0] || '');
        wsData.push(row2);
        if (isDoubles) wsData.push(new Array(totalCols).fill(''));
        wsData._separatorRows.push(isDoubles ? wsData.length - 1 : wsData.length - 1);
      } else {
        const currentRow = wsData.length;
        const row1 = new Array(totalCols).fill('');
        row1[1] = left.isBye ? '' : left.position;
        row1[2] = left.isBye ? 'bye' : left.name;
        row1[3] = left.isBye ? '' : (left.affiliation || '');
        row1[rightStartCol + 1] = right.isBye ? '' : right.position;
        row1[rightStartCol + 2] = right.isBye ? 'bye' : right.name;
        row1[rightStartCol + 3] = right.isBye ? '' : (right.affiliation || '');
        wsData.push(row1);
        wsData.push(new Array(totalCols).fill(''));
        wsData._separatorRows.push(wsData.length - 1);
        if (!isDoubles) {
          singlesMerges.push({ row: currentRow, side: 'left' });
          singlesMerges.push({ row: currentRow, side: 'right' });
        }
      }
    }

    // ブラケット罫線
    for (let round = 0; round < halfRounds; round++) {
      const pairSize = Math.pow(2, round + 1);
      const matchCount = halfSize / pairSize;
      const leftCol = leftDataCols + round;
      const rightCol = leftDataCols + halfRounds + centerCols + (halfRounds - 1 - round);
      for (let match = 0; match < matchCount; match++) {
        const blockStart = match * pairSize;
        let topRow, bottomRow;
        if (round === 0) {
          topRow = headerRows + blockStart * 2;
          bottomRow = headerRows + (blockStart + 1) * 2;
        } else {
          const prevPairSize = pairSize / 2;
          topRow = headerRows + blockStart * 2 + (prevPairSize - 1);
          bottomRow = headerRows + (blockStart + prevPairSize) * 2 + (prevPairSize - 1);
        }
        wsData._bracketInfo.push({ topRow, bottomRow, col: leftCol, side: 'left' });
        wsData._bracketInfo.push({ topRow, bottomRow, col: rightCol, side: 'right' });
      }
    }
  },

  /**
   * 確定済みExcel出力（BYE圧縮・連番化）
   */
  _buildExcelConfirmed(wsData, leftDraw, rightDraw, halfSize, isDoubles, leftDataCols, rightStartCol, totalCols, singlesMerges) {
    const headerRows = wsData.length;
    wsData._bracketInfo = [];
    wsData._separatorRows = [];
    const rounds = Math.log2(halfSize * 2);
    const halfRounds = rounds - 1;
    const centerCols = 2;

    const leftCompact = this._buildCompactDraw(leftDraw, halfSize);
    const rightCompact = this._buildCompactDraw(rightDraw, halfSize);

    // 左右で行を合わせるため、同じインデックスのペアを同時に処理
    const maxPairs = Math.max(leftCompact.length, rightCompact.length);
    let leftPos = 1;
    let rightPos = halfSize + 1;

    // 各compactアイテムのExcel行位置を記録
    const leftItemRows = [];
    const rightItemRows = [];

    for (let ci = 0; ci < maxPairs; ci++) {
      const lc = ci < leftCompact.length ? leftCompact[ci] : { type: 'bye-pair' };
      const rc = ci < rightCompact.length ? rightCompact[ci] : { type: 'bye-pair' };

      // 両方bye-pairならスキップ
      if (lc.type === 'bye-pair' && rc.type === 'bye-pair') {
        leftItemRows.push(null);
        rightItemRows.push(null);
        continue;
      }

      const currentBaseRow = wsData.length;
      leftItemRows.push(currentBaseRow);
      rightItemRows.push(currentBaseRow);

      // 左側のデータ
      const writeEntry = (entry, pos, side, isDoublesEntry) => {
        const startCol = side === 'left' ? 1 : rightStartCol + 1;
        if (!entry) return pos;
        if (isDoublesEntry) {
          const players = entry.name.split(' / ');
          const affils = (entry.affiliation || '').split(' / ');
          // 1行目に書く (currentBaseRow)
          const r1 = wsData[currentBaseRow] || new Array(totalCols).fill('');
          r1[startCol] = pos;
          r1[startCol + 1] = players[0] || '';
          r1[startCol + 2] = affils[0] || '';
          wsData[currentBaseRow] = r1;
          // 2行目
          let r2 = wsData[currentBaseRow + 1];
          if (!r2) { r2 = new Array(totalCols).fill(''); wsData[currentBaseRow + 1] = r2; }
          r2[startCol + 1] = players[1] || '';
          r2[startCol + 2] = affils[1] || affils[0] || '';
        } else {
          const r1 = wsData[currentBaseRow] || new Array(totalCols).fill('');
          r1[startCol] = pos;
          r1[startCol + 1] = entry.name || '';
          r1[startCol + 2] = entry.affiliation || '';
          wsData[currentBaseRow] = r1;
        }
        return pos + 1;
      };

      // 行を確保
      if (!wsData[currentBaseRow]) wsData.push(new Array(totalCols).fill(''));

      // 左側
      if (lc.type === 'match') {
        // 2行（名前行 + 空行 = 2スロット）
        writeEntry(lc.top, leftPos++, 'left', isDoubles && lc.top.name && lc.top.name.includes(' / '));
        if (!wsData[currentBaseRow + 1]) wsData.push(new Array(totalCols).fill(''));
        // 2行目に下の選手
        const secondRow = currentBaseRow + 2;
        if (!wsData[secondRow]) wsData.push(new Array(totalCols).fill(''));
        const startCol = 1;
        const entry = lc.bottom;
        const isDbl = isDoubles && entry.name && entry.name.includes(' / ');
        if (isDbl) {
          const players = entry.name.split(' / ');
          const affils = (entry.affiliation || '').split(' / ');
          wsData[secondRow][startCol] = leftPos;
          wsData[secondRow][startCol + 1] = players[0] || '';
          wsData[secondRow][startCol + 2] = affils[0] || '';
          if (!wsData[secondRow + 1]) wsData.push(new Array(totalCols).fill(''));
          wsData[secondRow + 1][startCol + 1] = players[1] || '';
          wsData[secondRow + 1][startCol + 2] = affils[1] || affils[0] || '';
        } else {
          wsData[secondRow][startCol] = leftPos;
          wsData[secondRow][startCol + 1] = entry.name || '';
          wsData[secondRow][startCol + 2] = entry.affiliation || '';
          if (!wsData[secondRow + 1]) wsData.push(new Array(totalCols).fill(''));
        }
        leftPos++;
      } else if (lc.type === 'bye-pass') {
        writeEntry(lc.entry, leftPos++, 'left', isDoubles && lc.entry.name && lc.entry.name.includes(' / '));
        if (!wsData[currentBaseRow + 1]) wsData.push(new Array(totalCols).fill(''));
      }

      // 右側
      if (rc.type === 'match') {
        const startCol = rightStartCol + 1;
        const r1 = wsData[currentBaseRow];
        const entry1 = rc.top;
        const isDbl1 = isDoubles && entry1.name && entry1.name.includes(' / ');
        if (isDbl1) {
          const players = entry1.name.split(' / ');
          const affils = (entry1.affiliation || '').split(' / ');
          r1[startCol] = rightPos;
          r1[startCol + 1] = players[0] || '';
          r1[startCol + 2] = affils[0] || '';
          if (!wsData[currentBaseRow + 1]) wsData.push(new Array(totalCols).fill(''));
          wsData[currentBaseRow + 1][startCol + 1] = players[1] || '';
          wsData[currentBaseRow + 1][startCol + 2] = affils[1] || affils[0] || '';
        } else {
          r1[startCol] = rightPos;
          r1[startCol + 1] = entry1.name || '';
          r1[startCol + 2] = entry1.affiliation || '';
        }
        rightPos++;

        const secondRow = currentBaseRow + 2;
        if (!wsData[secondRow]) wsData.push(new Array(totalCols).fill(''));
        const entry2 = rc.bottom;
        const isDbl2 = isDoubles && entry2.name && entry2.name.includes(' / ');
        if (isDbl2) {
          const players = entry2.name.split(' / ');
          const affils = (entry2.affiliation || '').split(' / ');
          wsData[secondRow][startCol] = rightPos;
          wsData[secondRow][startCol + 1] = players[0] || '';
          wsData[secondRow][startCol + 2] = affils[0] || '';
          if (!wsData[secondRow + 1]) wsData.push(new Array(totalCols).fill(''));
          wsData[secondRow + 1][startCol + 1] = players[1] || '';
          wsData[secondRow + 1][startCol + 2] = affils[1] || affils[0] || '';
        } else {
          wsData[secondRow][startCol] = rightPos;
          wsData[secondRow][startCol + 1] = entry2.name || '';
          wsData[secondRow][startCol + 2] = entry2.affiliation || '';
          if (!wsData[secondRow + 1]) wsData.push(new Array(totalCols).fill(''));
        }
        rightPos++;
      } else if (rc.type === 'bye-pass') {
        const startCol = rightStartCol + 1;
        const r1 = wsData[currentBaseRow];
        const entry = rc.entry;
        const isDbl = isDoubles && entry.name && entry.name.includes(' / ');
        if (isDbl) {
          const players = entry.name.split(' / ');
          const affils = (entry.affiliation || '').split(' / ');
          r1[startCol] = rightPos;
          r1[startCol + 1] = players[0] || '';
          r1[startCol + 2] = affils[0] || '';
          if (!wsData[currentBaseRow + 1]) wsData.push(new Array(totalCols).fill(''));
          wsData[currentBaseRow + 1][startCol + 1] = players[1] || '';
          wsData[currentBaseRow + 1][startCol + 2] = affils[1] || affils[0] || '';
        } else {
          r1[startCol] = rightPos;
          r1[startCol + 1] = entry.name || '';
          r1[startCol + 2] = entry.affiliation || '';
          if (!wsData[currentBaseRow + 1]) wsData.push(new Array(totalCols).fill(''));
        }
        rightPos++;
      }

      // ダブルスの場合はペア間に空白行追加
      if (isDoubles) {
        wsData.push(new Array(totalCols).fill(''));
      }

      wsData._separatorRows.push(wsData.length - 1);

      // シングルスの結合セル
      if (!isDoubles) {
        if (lc.type === 'match') {
          singlesMerges.push({ row: currentBaseRow, side: 'left' });
          singlesMerges.push({ row: currentBaseRow + 2, side: 'left' });
        } else if (lc.type === 'bye-pass') {
          singlesMerges.push({ row: currentBaseRow, side: 'left' });
        }
        if (rc.type === 'match') {
          singlesMerges.push({ row: currentBaseRow, side: 'right' });
          singlesMerges.push({ row: currentBaseRow + 2, side: 'right' });
        } else if (rc.type === 'bye-pass') {
          singlesMerges.push({ row: currentBaseRow, side: 'right' });
        }
      }
    }

    // ブラケット罫線: 各compact itemの実際の行位置に基づいて計算
    // 各compact itemの「出力行」(名前が書かれている行)を計算
    // match: 4行使用 (top名前, 空, bottom名前, 空) → 出力行 = startRow (top), startRow+2 (bottom)
    // bye-pass: 2行使用 (名前, 空) → 出力行 = startRow
    // bye-pair: 0行 (スキップ)

    const computeOutputRows = (compact, itemRows) => {
      const outputs = []; // 各compact itemの出力行 {nameRow, midRow, type}
      for (let ci = 0; ci < compact.length; ci++) {
        const item = compact[ci];
        const startRow = itemRows[ci];
        if (item.type === 'match') {
          const topNameRow = startRow;
          const bottomNameRow = startRow + 2;
          const midRow = startRow + 1; // midpoint between top and bottom name rows
          outputs.push({ topRow: topNameRow, bottomRow: bottomNameRow, midRow, type: 'match' });
        } else if (item.type === 'bye-pass') {
          outputs.push({ topRow: startRow, bottomRow: startRow, midRow: startRow, type: 'bye-pass' });
        } else {
          // bye-pair: no output
          outputs.push({ topRow: -1, bottomRow: -1, midRow: -1, type: 'bye-pair' });
        }
      }
      return outputs;
    };

    const leftOutputs = computeOutputRows(leftCompact, leftItemRows);
    const rightOutputs = computeOutputRows(rightCompact, rightItemRows);

    // Round 0: pair adjacent compact items and draw brackets between their output rows
    // Round N: pair groups of 2^N compact items, using midpoints from previous round grouping

    const drawBracketRounds = (compact, outputs, side) => {
      // currentMidRows[ci] tracks the "output Y" of each compact item for the current round
      const currentMidRows = outputs.map(o => o.midRow);

      for (let round = 0; round < halfRounds; round++) {
        const leftCol = leftDataCols + round;
        const rightCol = leftDataCols + halfRounds + centerCols + (halfRounds - 1 - round);
        const col = side === 'left' ? leftCol : rightCol;
        const groupSize = Math.pow(2, round + 1);
        const pairCount = Math.floor(compact.length / groupSize);

        for (let p = 0; p < pairCount; p++) {
          const startIdx = p * groupSize;
          const halfGroup = groupSize / 2;
          const midIdx = startIdx + halfGroup;
          const endIdx = startIdx + groupSize - 1;

          // Collect valid midRows for top half and bottom half of this group
          const topMids = [];
          for (let k = startIdx; k < midIdx; k++) {
            if (outputs[k].type !== 'bye-pair') topMids.push(currentMidRows[k]);
          }
          const bottomMids = [];
          for (let k = midIdx; k <= endIdx; k++) {
            if (outputs[k].type !== 'bye-pair') bottomMids.push(currentMidRows[k]);
          }

          if (topMids.length === 0 && bottomMids.length === 0) continue;

          let topRow, bottomRow, newMid;
          if (round === 0) {
            // Round 0: use the actual name rows from outputs
            if (topMids.length > 0 && bottomMids.length > 0) {
              // For a match item, use its top name row as the bracket top; for bye-pass, use its name row
              const topItem = outputs[startIdx];
              const bottomItem = outputs[startIdx + 1];
              if (topItem.type === 'match') {
                topRow = topItem.topRow;
              } else {
                topRow = topItem.midRow;
              }
              if (bottomItem.type === 'match') {
                bottomRow = bottomItem.bottomRow;
              } else {
                bottomRow = bottomItem.midRow;
              }
              newMid = Math.floor((topRow + bottomRow) / 2);
              wsData._bracketInfo.push({ topRow, bottomRow, col, side });
            } else if (topMids.length > 0) {
              newMid = topMids[0];
            } else {
              newMid = bottomMids[0];
            }
          } else {
            // Round 1+: use the midpoints from previous round grouping
            if (topMids.length > 0 && bottomMids.length > 0) {
              topRow = Math.floor((topMids[0] + topMids[topMids.length - 1]) / 2);
              bottomRow = Math.floor((bottomMids[0] + bottomMids[bottomMids.length - 1]) / 2);
              newMid = Math.floor((topRow + bottomRow) / 2);
              if (topRow >= headerRows && bottomRow < wsData.length) {
                wsData._bracketInfo.push({ topRow, bottomRow, col, side });
              }
            } else if (topMids.length > 0) {
              newMid = Math.floor((topMids[0] + topMids[topMids.length - 1]) / 2);
            } else {
              newMid = Math.floor((bottomMids[0] + bottomMids[bottomMids.length - 1]) / 2);
            }
          }

          // Update all items in this group to the new midpoint for next round
          for (let k = startIdx; k <= endIdx; k++) {
            currentMidRows[k] = newMid;
          }
        }
      }
    };

    drawBracketRounds(leftCompact, leftOutputs, 'left');
    drawBracketRounds(rightCompact, rightOutputs, 'right');
  },


  exportToCSV(drawData) {
    const draw = drawData.draw;
    const drawSize = drawData.drawSize;
    const halfSize = drawSize / 2;
    const eventName = drawData.eventName || 'ドロー表';
    const matchFormat = drawData.matchFormat || AppConfig.MATCH_FORMAT || '';
    const rows = [];
    rows.push([eventName, '', '', '', '', '', '', '', '', '', '', '', '', '', '', drawData.tournamentName || AppConfig.TOURNAMENT_NAME || '']);
    const dateVenue = [];
    if (drawData.date) dateVenue.push(drawData.date);
    if (drawData.venue) dateVenue.push(drawData.venue);
    rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', dateVenue.join('  ')]);
    rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', matchFormat]);
    rows.push([]);
    const leftDraw = draw.slice(0, halfSize);
    const rightDraw = draw.slice(halfSize);
    for (let i = 0; i < halfSize; i++) {
      const l = leftDraw[i], r = rightDraw[i];
      rows.push([
        l.isBye ? '' : l.position, l.isBye ? 'bye' : l.name, l.isBye ? '' : '(', l.isBye ? '' : (l.affiliation || ''), l.isBye ? '' : ')',
        '', '', '', '', '', '', '', '', '', '',
        r.isBye ? '' : r.position, r.isBye ? 'bye' : r.name, r.isBye ? '' : '(', r.isBye ? '' : (r.affiliation || ''), r.isBye ? '' : ')',
      ]);
      rows.push([]);
    }
    const seeds = drawData.seeds || [];
    if (seeds.length > 0) {
      rows.push([]); rows.push(['', 'シード', '', seeds.map(s => s.seed + '.' + s.name).join('  ')]);
    }
    const csvContent = rows.map(r => r.map(c => {
      const s = String(c == null ? '' : c);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = eventName.replace(/[\\/:*?"<>|]/g, '_') + '_ドロー表.csv';
    a.click();
    URL.revokeObjectURL(url);
  },

  // --- SVG ヘルパー ---
  _text(svg, x, y, text, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.textContent = text;
    if (attrs.fontSize) el.setAttribute('font-size', attrs.fontSize);
    if (attrs.fontWeight) el.setAttribute('font-weight', attrs.fontWeight);
    if (attrs.fontStyle) el.setAttribute('font-style', attrs.fontStyle);
    if (attrs.fill) el.setAttribute('fill', attrs.fill);
    if (attrs.textAnchor) el.setAttribute('text-anchor', attrs.textAnchor);
    svg.appendChild(el);
    return el;
  },
  _line(svg, x1, y1, x2, y2, stroke, strokeWidth) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('stroke', stroke || '#333');
    el.setAttribute('stroke-width', strokeWidth || 1);
    svg.appendChild(el);
    return el;
  },
  _rect(svg, x, y, width, height, fill, stroke, strokeWidth) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('width', width); el.setAttribute('height', height);
    el.setAttribute('fill', fill || 'none');
    if (stroke) { el.setAttribute('stroke', stroke); el.setAttribute('stroke-width', strokeWidth || 1); }
    svg.appendChild(el);
    return el;
  },
};
