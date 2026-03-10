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
    headerHeight: 42,         // ヘッダー高さ（圧縮）
    footerHeight: 24,         // フッター高さ（圧縮・シード1行時）
    footerHeight2Row: 40,     // フッター高さ（シード2行時）
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
      const containerWidth = container.clientWidth || container.offsetWidth || 0;
      if (containerWidth > 0) {
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

    // スケジュール注記を描画
    if (options.scheduleMap && options.eventCode) {
      this._drawScheduleAnnotations(svg, options.scheduleMap, options.eventCode,
        drawSize, halfRounds, bodyTop, halfWidth, P, isConfirmed,
        leftDraw, rightDraw, halfSize);
    }
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
        const topIsDbl = item.top.name && item.top.name.includes(' / ');
        const btmIsDbl = item.bottom.name && item.bottom.name.includes(' / ');
        this._drawPlayerEntry(svg, item.top, iy.topY, nameX, numX, posCounter++, clipId, affiliationX_offset);
        this._drawSeparatorLine(svg, iy.topY, offsetX, rounds, isLeft, topIsDbl);
        this._drawPlayerEntry(svg, item.bottom, iy.bottomY, nameX, numX, posCounter++, clipId, affiliationX_offset);
        this._drawSeparatorLine(svg, iy.bottomY, offsetX, rounds, isLeft, btmIsDbl);
      } else if (item.type === 'bye-pass') {
        // BYE不戦勝: 1人だけ描画
        const entryIsDbl = item.entry.name && item.entry.name.includes(' / ');
        this._drawPlayerEntry(svg, item.entry, iy.midY, nameX, numX, posCounter++, clipId, affiliationX_offset);
        this._drawSeparatorLine(svg, iy.midY, offsetX, rounds, isLeft, entryIsDbl);
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
      const lineGap = Math.max(P.slotHeight * 0.45, 13);
      const y1 = cy - lineGap / 2;
      const y2 = cy + lineGap / 2;
      // 名前の均等配置
      const formattedName1 = this._formatDoublesName(players[0] || '');
      const formattedName2 = this._formatDoublesName(players[1] || '');
      const el1 = this._text(svg, nameX, y1, formattedName1, {
        fontSize: P.fontSize.playerName - 1, fill: P.colors.text, fontWeight: 'bold',
      });
      el1.setAttribute('dominant-baseline', 'central');
      el1.setAttribute('clip-path', 'url(#' + clipId + ')');
      const af1 = this._text(svg, affilX, y1, affiliations[0] || '', {
        fontSize: P.fontSize.affiliation, fill: P.colors.subText,
      });
      af1.setAttribute('dominant-baseline', 'central');
      af1.setAttribute('clip-path', 'url(#' + clipId + ')');
      const el2 = this._text(svg, nameX, y2, formattedName2, {
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
      const formattedSinglesName = this._formatPlayerName(entry.name);
      const nameEl = this._text(svg, nameX, cy, formattedSinglesName, {
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
  _drawSeparatorLine(svg, cy, offsetX, rounds, isLeft, isDoubles) {
    const P = this.PARAMS;
    const lineY = cy + P.slotHeight / 2 + (isDoubles ? 4 : 0);
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
        const entIsDbl = entry.name && entry.name.includes(' / ');
        this._drawSeparatorLine(svg, cy, offsetX, rounds, isLeft, entIsDbl);
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
    const seeds = (drawData.seeds || []).slice().sort((a, b) => a.seed - b.seed);
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
      this._buildExcelConfirmed(wsData, leftDraw, rightDraw, halfSize, isDoubles, leftDataCols, rightStartCol, totalCols, singlesMerges, drawData);
    } else {
      // 通常出力
      this._buildExcelNormal(wsData, leftDraw, rightDraw, halfSize, isDoubles, leftDataCols, rightStartCol, totalCols, singlesMerges);
    }

    // シード情報行
    wsData.push(new Array(totalCols).fill(''));
    const seeds = (drawData.seeds || []).slice().sort((a, b) => a.seed - b.seed);
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
    h1cell.s.font = { bold: true, sz: 18 };
    const eventMergeEnd = leftDataCols + halfRounds - 1;
    ws['!merges'].push({ s: { r: 1, c: 1 }, e: { r: 1, c: eventMergeEnd } });
    for (let hRow = 1; hRow <= 3; hRow++) {
      const hCell = ensureCell(hRow, centerLeftCol);
      if (!hCell.s.alignment) hCell.s.alignment = {};
      hCell.s.alignment.horizontal = 'right';
      if (hRow === 1) {
        if (!hCell.s.font) hCell.s.font = {};
        hCell.s.font.bold = true;
        hCell.s.font.sz = 16;
      }
      ws['!merges'].push({ s: { r: hRow, c: centerLeftCol }, e: { r: hRow, c: totalCols - 1 } });
    }
    // タイトル行高さ
    if (!ws['!rows']) ws['!rows'] = [];
    ws['!rows'][1] = { hpt: 24 };

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

    // ダブルス: 2人目の行に薄いグレー下線（ペア区切り）
    const grayBorder = { style: 'thin', color: { rgb: '808080' } };
    if (wsData._playerPairRows) {
      for (const pr of wsData._playerPairRows) {
        for (let c = pr.startCol; c <= pr.endCol; c++) {
          ensureCell(pr.row, c).s.border.bottom = grayBorder;
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

    // スケジュール時間をブラケットセルに埋め込む
    if (wsData._timeMerges) {
      for (const tm of wsData._timeMerges) {
        const cell = ensureCell(tm.startRow, tm.col);
        cell.v = tm.timeValue;
        cell.t = 'n';
        cell.z = 'h:mm';
        if (!cell.s.alignment) cell.s.alignment = {};
        cell.s.alignment.vertical = 'center';
        cell.s.alignment.horizontal = 'center';
        cell.s.font = { sz: 9, color: { rgb: '1565C0' } };
        if (tm.startRow !== tm.endRow) {
          ws['!merges'].push({ s: { r: tm.startRow, c: tm.col }, e: { r: tm.endRow, c: tm.col } });
        }
      }
    }

    // グリッド線非表示
    if (!ws['!sheetViews']) ws['!sheetViews'] = [{}];
    ws['!sheetViews'][0].showGridLines = false;

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
    wsData._playerPairRows = [];
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
        const row2Idx = wsData.length;
        const row2 = new Array(totalCols).fill('');
        row2[2] = left.isBye ? '' : (lp[1] || '');
        row2[3] = left.isBye ? '' : (la[1] || la[0] || '');
        row2[rightStartCol + 2] = right.isBye ? '' : (rp[1] || '');
        row2[rightStartCol + 3] = right.isBye ? '' : (ra[1] || ra[0] || '');
        wsData.push(row2);
        // 2人目の行にグレー下線
        if (leftIsDoubles) wsData._playerPairRows.push({ row: row2Idx, startCol: 1, endCol: 3 });
        if (rightIsDoubles) wsData._playerPairRows.push({ row: row2Idx, startCol: rightStartCol + 1, endCol: rightStartCol + 3 });
        if (isDoubles) wsData.push(new Array(totalCols).fill(''));
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
  _buildExcelConfirmed(wsData, leftDraw, rightDraw, halfSize, isDoubles, leftDataCols, rightStartCol, totalCols, singlesMerges, drawData) {
    const headerRows = wsData.length;
    wsData._bracketInfo = [];
    wsData._playerPairRows = [];
    wsData._timeMerges = [];
    const rounds = Math.log2(halfSize * 2);
    const halfRounds = rounds - 1;
    const centerCols = 2;

    const leftCompact = this._buildCompactDraw(leftDraw, halfSize);
    const rightCompact = this._buildCompactDraw(rightDraw, halfSize);

    const maxPairs = Math.max(leftCompact.length, rightCompact.length);
    let leftPos = 1;
    let rightPos = halfSize + 1;

    const leftItemRows = [];
    const rightItemRows = [];

    // ダブルスエントリーを書き込むヘルパー
    const writeDoublesEntry = (row, entry, pos, startCol) => {
      const players = entry.name.split(' / ');
      const affils = (entry.affiliation || '').split(' / ');
      wsData[row][startCol] = pos;
      wsData[row][startCol + 1] = players[0] || '';
      wsData[row][startCol + 2] = affils[0] || '';
      if (!wsData[row + 1]) wsData[row + 1] = new Array(totalCols).fill('');
      wsData[row + 1][startCol + 1] = players[1] || '';
      wsData[row + 1][startCol + 2] = affils[1] || affils[0] || '';
      // 2人目の行にグレー下線
      wsData._playerPairRows.push({ row: row + 1, startCol: startCol, endCol: startCol + 2 });
    };

    const writeSinglesEntry = (row, entry, pos, startCol) => {
      wsData[row][startCol] = pos;
      wsData[row][startCol + 1] = entry.name || '';
      wsData[row][startCol + 2] = entry.affiliation || '';
    };

    // 各エントリーを処理: ダブルスは2行(player1+player2) + 1空行 = 3行/エントリー
    // matchは2エントリー分 = 上2行+空1行+下2行+空1行 = 6行（ダブルス）
    // bye-passは1エントリー = 2行+空1行 = 3行（ダブルス）
    // シングルスは1行+空1行 = 2行/エントリー

    const writeSide = (compact, startPos, side) => {
      const startCol = side === 'left' ? 1 : rightStartCol + 1;
      let pos = startPos;
      const itemRows = [];

      for (let ci = 0; ci < compact.length; ci++) {
        const item = compact[ci];
        if (item.type === 'bye-pair') {
          itemRows.push(null);
          continue;
        }
        itemRows.push(wsData.length);

        if (item.type === 'match') {
          const topRow = wsData.length;
          // 上選手
          if (!wsData[topRow]) wsData.push(new Array(totalCols).fill(''));
          const topEntry = item.top;
          const topIsDbl = isDoubles && topEntry.name && topEntry.name.includes(' / ');
          if (topIsDbl) {
            writeDoublesEntry(topRow, topEntry, pos, startCol);
            if (!wsData[topRow + 1]) wsData.push(new Array(totalCols).fill(''));
          } else {
            writeSinglesEntry(topRow, topEntry, pos, startCol);
            if (!wsData[topRow + 1]) wsData.push(new Array(totalCols).fill(''));
          }
          pos++;

          // 下選手
          const bottomRow = isDoubles ? topRow + 3 : topRow + 2;
          while (wsData.length <= bottomRow) wsData.push(new Array(totalCols).fill(''));
          const btmEntry = item.bottom;
          const btmIsDbl = isDoubles && btmEntry.name && btmEntry.name.includes(' / ');
          if (btmIsDbl) {
            writeDoublesEntry(bottomRow, btmEntry, pos, startCol);
            while (wsData.length <= bottomRow + 1) wsData.push(new Array(totalCols).fill(''));
          } else {
            writeSinglesEntry(bottomRow, btmEntry, pos, startCol);
          }
          pos++;

          if (!isDoubles) {
            singlesMerges.push({ row: topRow, side });
            singlesMerges.push({ row: bottomRow, side });
          }
        } else if (item.type === 'bye-pass') {
          const entryRow = wsData.length;
          if (!wsData[entryRow]) wsData.push(new Array(totalCols).fill(''));
          const entry = item.entry;
          const isDbl = isDoubles && entry.name && entry.name.includes(' / ');
          if (isDbl) {
            writeDoublesEntry(entryRow, entry, pos, startCol);
            if (!wsData[entryRow + 1]) wsData.push(new Array(totalCols).fill(''));
          } else {
            writeSinglesEntry(entryRow, entry, pos, startCol);
            if (!wsData[entryRow + 1]) wsData.push(new Array(totalCols).fill(''));
          }
          pos++;

          if (!isDoubles) {
            singlesMerges.push({ row: entryRow, side });
          }
        }

        // 空行（スペーサー）
        wsData.push(new Array(totalCols).fill(''));
      }
      return { itemRows, endPos: pos };
    };

    // 左右を独立に行数計算してから、行数を揃えて書き込む
    // まず左を書く
    const leftResult = writeSide(leftCompact, leftPos, 'left');
    const leftEndRow = wsData.length;

    // 左のデータを退避して右も同じ行から書き直すため、行位置だけ記録
    // 実際には左右を同じ行に配置する必要がある
    // → 左右を同時に進めるアプローチに戻す

    // 上のwriteSideの結果を使わず、同時処理に書き直し
    wsData.length = headerRows; // リセット
    leftPos = 1;
    rightPos = halfSize + 1;

    for (let ci = 0; ci < maxPairs; ci++) {
      const lc = ci < leftCompact.length ? leftCompact[ci] : { type: 'bye-pair' };
      const rc = ci < rightCompact.length ? rightCompact[ci] : { type: 'bye-pair' };

      if (lc.type === 'bye-pair' && rc.type === 'bye-pair') {
        leftItemRows.push(null);
        rightItemRows.push(null);
        continue;
      }

      const baseRow = wsData.length;
      leftItemRows.push(baseRow);
      rightItemRows.push(baseRow);

      // 必要な行数を計算
      const calcRows = (item) => {
        if (item.type === 'match') return isDoubles ? 6 : 4;
        if (item.type === 'bye-pass') return isDoubles ? 3 : 2;
        return 0;
      };
      const neededRows = Math.max(calcRows(lc), calcRows(rc));
      // 行を確保（+1 for spacer）
      for (let r = 0; r < neededRows + 1; r++) {
        if (wsData.length <= baseRow + r) wsData.push(new Array(totalCols).fill(''));
      }

      // 左側書込
      if (lc.type === 'match') {
        const topIsDbl = isDoubles && lc.top.name && lc.top.name.includes(' / ');
        const btmIsDbl = isDoubles && lc.bottom.name && lc.bottom.name.includes(' / ');
        if (topIsDbl) {
          writeDoublesEntry(baseRow, lc.top, leftPos++, 1);
        } else {
          writeSinglesEntry(baseRow, lc.top, leftPos++, 1);
          if (!isDoubles) singlesMerges.push({ row: baseRow, side: 'left' });
        }
        const btmRow = isDoubles ? baseRow + 3 : baseRow + 2;
        if (btmIsDbl) {
          writeDoublesEntry(btmRow, lc.bottom, leftPos++, 1);
        } else {
          writeSinglesEntry(btmRow, lc.bottom, leftPos++, 1);
          if (!isDoubles) singlesMerges.push({ row: btmRow, side: 'left' });
        }
      } else if (lc.type === 'bye-pass') {
        const isDbl = isDoubles && lc.entry.name && lc.entry.name.includes(' / ');
        if (isDbl) {
          writeDoublesEntry(baseRow, lc.entry, leftPos++, 1);
        } else {
          writeSinglesEntry(baseRow, lc.entry, leftPos++, 1);
          if (!isDoubles) singlesMerges.push({ row: baseRow, side: 'left' });
        }
      }

      // 右側書込
      const rCol = rightStartCol + 1;
      if (rc.type === 'match') {
        const topIsDbl = isDoubles && rc.top.name && rc.top.name.includes(' / ');
        const btmIsDbl = isDoubles && rc.bottom.name && rc.bottom.name.includes(' / ');
        if (topIsDbl) {
          writeDoublesEntry(baseRow, rc.top, rightPos++, rCol);
        } else {
          writeSinglesEntry(baseRow, rc.top, rightPos++, rCol);
          if (!isDoubles) singlesMerges.push({ row: baseRow, side: 'right' });
        }
        const btmRow = isDoubles ? baseRow + 3 : baseRow + 2;
        if (btmIsDbl) {
          writeDoublesEntry(btmRow, rc.bottom, rightPos++, rCol);
        } else {
          writeSinglesEntry(btmRow, rc.bottom, rightPos++, rCol);
          if (!isDoubles) singlesMerges.push({ row: btmRow, side: 'right' });
        }
      } else if (rc.type === 'bye-pass') {
        const isDbl = isDoubles && rc.entry.name && rc.entry.name.includes(' / ');
        if (isDbl) {
          writeDoublesEntry(baseRow, rc.entry, rightPos++, rCol);
        } else {
          writeSinglesEntry(baseRow, rc.entry, rightPos++, rCol);
          if (!isDoubles) singlesMerges.push({ row: baseRow, side: 'right' });
        }
      }
    }

    // ブラケット罫線の計算
    const computeOutputRows = (compact, itemRows) => {
      const outputs = [];
      for (let ci = 0; ci < compact.length; ci++) {
        const item = compact[ci];
        const startRow = itemRows[ci];
        if (item.type === 'match') {
          const topNameRow = startRow;
          const bottomNameRow = isDoubles ? startRow + 3 : startRow + 2;
          const midRow = Math.floor((topNameRow + bottomNameRow) / 2);
          outputs.push({ topRow: topNameRow, bottomRow: bottomNameRow, midRow, type: 'match' });
        } else if (item.type === 'bye-pass') {
          outputs.push({ topRow: startRow, bottomRow: startRow, midRow: startRow, type: 'bye-pass' });
        } else {
          outputs.push({ topRow: -1, bottomRow: -1, midRow: -1, type: 'bye-pair' });
        }
      }
      return outputs;
    };

    const leftOutputs = computeOutputRows(leftCompact, leftItemRows);
    const rightOutputs = computeOutputRows(rightCompact, rightItemRows);

    // スケジュールマップ取得
    const scheduleMap = drawData.scheduleMap || null;
    const eventCode = drawData.eventCode || '';

    const drawBracketRounds = (compact, outputs, side, halfLabel) => {
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
            if (topMids.length > 0 && bottomMids.length > 0) {
              const topItem = outputs[startIdx];
              const bottomItem = outputs[startIdx + 1];
              topRow = topItem.type === 'match' ? topItem.topRow : topItem.midRow;
              bottomRow = bottomItem.type === 'match' ? bottomItem.bottomRow : bottomItem.midRow;
              newMid = Math.floor((topRow + bottomRow) / 2);
              wsData._bracketInfo.push({ topRow, bottomRow, col, side });

              // R1 スケジュール時間
              if (scheduleMap && eventCode) {
                const matchId = eventCode + '-R1-' + halfLabel + (p + 1);
                const info = scheduleMap[matchId];
                if (info) {
                  const timeHours = parseInt(info.startTime.split(':')[0]);
                  const timeMins = parseInt(info.startTime.split(':')[1]);
                  const timeVal = (timeHours * 60 + timeMins) / 1440;
                  wsData._timeMerges.push({
                    startRow: topRow + 1, endRow: bottomRow - 1, col, timeValue: timeVal
                  });
                }
              }
            } else if (topMids.length > 0) {
              newMid = topMids[0];
            } else {
              newMid = bottomMids[0];
            }
          } else {
            if (topMids.length > 0 && bottomMids.length > 0) {
              topRow = Math.floor((topMids[0] + topMids[topMids.length - 1]) / 2);
              bottomRow = Math.floor((bottomMids[0] + bottomMids[bottomMids.length - 1]) / 2);
              newMid = Math.floor((topRow + bottomRow) / 2);
              if (topRow >= headerRows && bottomRow < wsData.length) {
                wsData._bracketInfo.push({ topRow, bottomRow, col, side });

                // R2+ スケジュール時間
                if (scheduleMap && eventCode) {
                  const globalRound = round + 1;
                  const matchId = eventCode + '-R' + globalRound + '-' + halfLabel + (p + 1);
                  const info = scheduleMap[matchId];
                  if (info) {
                    const timeHours = parseInt(info.startTime.split(':')[0]);
                    const timeMins = parseInt(info.startTime.split(':')[1]);
                    const timeVal = (timeHours * 60 + timeMins) / 1440;
                    wsData._timeMerges.push({
                      startRow: topRow + 1, endRow: bottomRow - 1, col, timeValue: timeVal
                    });
                  }
                }
              }
            } else if (topMids.length > 0) {
              newMid = Math.floor((topMids[0] + topMids[topMids.length - 1]) / 2);
            } else {
              newMid = Math.floor((bottomMids[0] + bottomMids[bottomMids.length - 1]) / 2);
            }
          }

          for (let k = startIdx; k <= endIdx; k++) {
            currentMidRows[k] = newMid;
          }
        }
      }
    };

    drawBracketRounds(leftCompact, leftOutputs, 'left', 'L');
    drawBracketRounds(rightCompact, rightOutputs, 'right', 'R');
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

  /**
   * ダブルス名前の均等配置フォーマット
   * 苗字と名前の開始・終了位置を揃えるためにスペースを調整
   * 目標: 全角5文字分（苗字3文字+名前2文字程度）に収まるよう調整
   */
  /**
   * 名前フォーマット（シングルス・ダブルス共通）
   * 5文字: 半角スペース、4文字: 全角+半角、3文字: 全角×2+半角
   */
  _formatPlayerName(name) {
    if (!name) return '';
    const parts = name.split(/[\s\u3000]+/).filter(Boolean);
    if (parts.length < 2) return name;
    const family = parts[0];
    const given = parts.slice(1).join('');
    const totalLen = family.length + given.length;
    if (totalLen <= 3) {
      return family + '\u3000\u3000 ' + given;
    } else if (totalLen <= 4) {
      return family + '\u3000 ' + given;
    } else {
      return family + ' ' + given;
    }
  },

  _formatDoublesName(name) {
    return this._formatPlayerName(name);
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
  /**
   * スケジュール注記（時間・コート番号）をブラケットSVG上に描画
   * scheduleMap のキーは matchId: {eventCode}-R{round}-{L|R}{num} or {eventCode}-F
   */
  _drawScheduleAnnotations(svg, scheduleMap, eventCode, drawSize, halfRounds, bodyTop, halfWidth, P, isConfirmed, leftDraw, rightDraw, halfSize) {
    if (!isConfirmed) return;

    const totalRounds = Math.log2(drawSize);
    const self = this;

    const buildCompact = (halfDraw) => {
      return this._buildCompactDraw(halfDraw, halfSize);
    };

    const annotateSide = (halfLabel, compact, offsetX, isLeft) => {
      if (!compact) return;

      // compact item Y位置を計算
      let slotIdx = 0;
      const itemYs = [];
      for (const item of compact) {
        if (item.type === 'match') {
          const topY = bodyTop + slotIdx * 2 * P.slotHeight + P.slotHeight / 2;
          const bottomY = bodyTop + (slotIdx * 2 + 2) * P.slotHeight + P.slotHeight / 2;
          itemYs.push({ midY: (topY + bottomY) / 2, type: 'match' });
          slotIdx += 2;
        } else if (item.type === 'bye-pass') {
          const cy = bodyTop + slotIdx * 2 * P.slotHeight + P.slotHeight / 2;
          itemYs.push({ midY: cy, type: 'bye-pass' });
          slotIdx += 1;
        } else {
          itemYs.push({ midY: 0, type: 'bye-pair' });
        }
      }

      // R1注記: compact[ci]がmatchの場合にmatchIdを計算
      // matchId = {eventCode}-R1-{halfLabel}{ci+1}
      // 注記位置: コの字の内側（縦線の反対側）
      //   左山: 縦線の左側 (end anchor)、右山: 縦線の右側 (start anchor)
      for (let ci = 0; ci < compact.length; ci++) {
        if (compact[ci].type !== 'match') continue;
        const matchId = eventCode + '-R1-' + halfLabel + (ci + 1);
        const info = scheduleMap[matchId];
        if (!info) continue;

        const midY = itemYs[ci].midY;
        const lineX0 = isLeft
          ? offsetX + P.drawNumWidth + P.nameAreaWidth
          : offsetX + (halfRounds - 1) * P.roundWidth + P.roundWidth;
        const nextX0 = isLeft ? lineX0 + P.roundWidth : lineX0 - P.roundWidth;
        // コの字内側 = 縦線から名前側に配置
        const annotX = isLeft ? nextX0 - 2 : nextX0 + 2;
        const anchor = isLeft ? 'end' : 'start';

        self._text(svg, annotX, midY - 4, info.startTime, {
          fontSize: 8, fill: '#1565C0', textAnchor: anchor,
        }).setAttribute('dominant-baseline', 'central');
        self._text(svg, annotX, midY + 6, 'C' + info.courtName, {
          fontSize: 7, fill: '#666', textAnchor: anchor,
        }).setAttribute('dominant-baseline', 'central');
      }

      // R2以降: _drawHalfConfirmed と同じロジックでY位置を追跡
      for (let round = 1; round < halfRounds; round++) {
        const pairCount = compact.length / Math.pow(2, round);
        const groupSize = Math.pow(2, round);
        const globalRound = round + 1;

        let nextRoundX;
        if (isLeft) {
          nextRoundX = offsetX + P.drawNumWidth + P.nameAreaWidth + (round + 1) * P.roundWidth;
        } else {
          nextRoundX = offsetX + (halfRounds - 1 - round) * P.roundWidth;
        }

        for (let p = 0; p < pairCount; p++) {
          const startIdx = p * groupSize;
          const midIdx = startIdx + groupSize / 2;
          const endIdx = startIdx + groupSize - 1;

          const topMids = [];
          for (let k = startIdx; k < midIdx; k++) {
            if (itemYs[k].type !== 'bye-pair') topMids.push(itemYs[k].midY);
          }
          const bottomMids = [];
          for (let k = midIdx; k <= endIdx; k++) {
            if (itemYs[k].type !== 'bye-pair') bottomMids.push(itemYs[k].midY);
          }

          const topOutY = topMids.length > 0 ? (topMids[0] + topMids[topMids.length - 1]) / 2 : 0;
          const bottomOutY = bottomMids.length > 0 ? (bottomMids[0] + bottomMids[bottomMids.length - 1]) / 2 : 0;
          const pairMidY = (topMids.length > 0 && bottomMids.length > 0)
            ? (topOutY + bottomOutY) / 2
            : (topMids.length > 0 ? topOutY : bottomOutY);

          const matchId = eventCode + '-R' + globalRound + '-' + halfLabel + (p + 1);
          const info = scheduleMap[matchId];
          if (info && pairMidY > 0) {
            // コの字内側 = 縦線から名前側に配置
            const annotX = isLeft ? nextRoundX - 2 : nextRoundX + 2;
            const anchor = isLeft ? 'end' : 'start';
            self._text(svg, annotX, pairMidY - 4, info.startTime, {
              fontSize: 8, fill: '#1565C0', textAnchor: anchor,
            }).setAttribute('dominant-baseline', 'central');
            self._text(svg, annotX, pairMidY + 6, 'C' + info.courtName, {
              fontSize: 7, fill: '#666', textAnchor: anchor,
            }).setAttribute('dominant-baseline', 'central');
          }

          // 次ラウンド用にmidYを更新
          for (let k = startIdx; k <= endIdx; k++) {
            itemYs[k].midY = pairMidY;
          }
        }
      }
    };

    const leftCompact = buildCompact(leftDraw);
    const rightCompact = buildCompact(rightDraw);
    annotateSide('L', leftCompact, 0, true);
    annotateSide('R', rightCompact, halfWidth + P.centerGap, false);

    // 決勝の注記
    const finalInfo = scheduleMap[eventCode + '-F'];
    if (finalInfo) {
      const centerX = halfWidth + P.centerGap / 2;
      const centerY = bodyTop + 20;
      self._text(svg, centerX, centerY, finalInfo.startTime + ' C' + finalInfo.courtName, {
        fontSize: 9, fill: '#1565C0', textAnchor: 'middle', fontWeight: 'bold',
      }).setAttribute('dominant-baseline', 'central');
    }
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
