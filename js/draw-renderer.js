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
    nameAreaWidth: 210,       // 選手名+所属エリア幅
    drawNumWidth: 30,         // ドロー番号列幅
    headerHeight: 60,
    footerHeight: 40,
    centerGap: 80,            // 左右の山の中央間隔
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
   * SVGでトーナメント表を描画（左右の山形式・参考Excel準拠レイアウト）
   * @param {Element} container
   * @param {object} drawData { draw, drawSize, eventName, tournamentName, date, venue, entries, seeds, entryCount }
   * @param {object} [options]
   */
  render(container, drawData, options) {
    options = options || {};
    const P = this.PARAMS;
    const draw = drawData.draw;
    const drawSize = drawData.drawSize;
    const rounds = Math.log2(drawSize);
    const halfSize = drawSize / 2;
    const halfRounds = rounds - 1; // 各山内のラウンド数（決勝を除く）

    // ドローサイズに応じてslotHeightを動的に調整
    const vScale = options.scale || 1.0;
    let hScale = options.hScale || 1.0;
    const baseSlotHeight = drawSize <= 16 ? 28 : drawSize <= 32 ? 22 : drawSize <= 64 ? 16 : 12;
    P.slotHeight = Math.round(baseSlotHeight * vScale);

    // 文字サイズは常に固定
    P.nameAreaWidth = 210;
    P.fontSize.playerName = 13;
    P.fontSize.affiliation = 10;

    // コンテナ幅に自動フィット: 線の幅（roundWidth, centerGap）のみ調整
    const autoFit = options.autoFit !== false;
    const baseRoundWidth = 100;
    const baseCenterGap = 80;

    if (autoFit) {
      const fixedWidth = (P.drawNumWidth + P.nameAreaWidth) * 2; // 名前エリア+番号は固定
      const baseLineWidth = baseRoundWidth * 2 * halfRounds + baseCenterGap;
      const baseTotalWidth = fixedWidth + baseLineWidth;

      const containerWidth = container.clientWidth || container.offsetWidth || 0;
      if (containerWidth > 0 && baseTotalWidth > containerWidth) {
        // 線の幅だけを圧縮
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

    // 各半分のスロット数 = halfSize * 2 (選手行 + 間隔行)
    const slotsPerHalf = halfSize * 2;
    const bracketBodyHeight = slotsPerHalf * P.slotHeight;

    // 片側の幅: ドロー番号 + 名前エリア + ラウンド線
    const halfWidth = P.drawNumWidth + P.nameAreaWidth + halfRounds * P.roundWidth;
    const totalWidth = halfWidth * 2 + P.centerGap;
    const totalHeight = P.headerHeight + bracketBodyHeight + P.footerHeight;

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

    // ヘッダー
    this._drawHeader(svg, drawData, options, totalWidth);

    const bodyTop = P.headerHeight;
    const leftDraw = draw.slice(0, halfSize);
    const rightDraw = draw.slice(halfSize);

    // 左の山（→右方向に進行）
    this._drawHalf(svg, leftDraw, halfSize, halfRounds, bodyTop, 0, 'left');
    // 右の山（←左方向に進行、右端に選手名）
    this._drawHalf(svg, rightDraw, halfSize, halfRounds, bodyTop, halfWidth + P.centerGap, 'right');
    // 決勝
    this._drawFinal(svg, halfSize, halfRounds, bodyTop, halfWidth, totalWidth);
    // シード情報
    this._drawSeedInfo(svg, drawData, bodyTop + bracketBodyHeight + 8, totalWidth);
  },

  _drawHeader(svg, drawData, options, totalWidth) {
    const P = this.PARAMS;
    const eventName = drawData.eventName || '';

    // 左側: 種目名バッジ（グラデーション背景 + 白文字）
    let estChars = 0;
    for (let ci = 0; ci < eventName.length; ci++) {
      estChars += eventName.charCodeAt(ci) > 255 ? 1.0 : 0.55;
    }
    // 文字数に応じてフォントサイズを調整（長い種目名は小さく）
    let eventFontSize = P.fontSize.title + 2;
    const maxBadgeWidth = 260;
    let badgeWidth = estChars * eventFontSize * 0.72 + 28;
    if (badgeWidth > maxBadgeWidth) {
      eventFontSize = Math.max(12, Math.floor((maxBadgeWidth - 28) / (estChars * 0.72)));
      badgeWidth = estChars * eventFontSize * 0.72 + 28;
    }
    const badgeHeight = 32;
    const badgeX = 6;
    const badgeY = 4;

    // グラデーション定義
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', 'eventBadgeGrad');
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#1a5276');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', '#2980b9');
    grad.appendChild(stop1); grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // 角丸背景
    const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    badge.setAttribute('x', badgeX); badge.setAttribute('y', badgeY);
    badge.setAttribute('width', badgeWidth); badge.setAttribute('height', badgeHeight);
    badge.setAttribute('rx', 5); badge.setAttribute('ry', 5);
    badge.setAttribute('fill', 'url(#eventBadgeGrad)');
    svg.appendChild(badge);

    // 白文字
    const eventText = this._text(svg, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2, eventName, {
      fontSize: eventFontSize, fontWeight: 'bold', fill: '#fff', textAnchor: 'middle',
    });
    eventText.setAttribute('dominant-baseline', 'central');

    // 右端揃え: 大会名、日付・場所、ゲーム形式
    const tournamentName = drawData.tournamentName || AppConfig.TOURNAMENT_NAME || '';
    const matchFormat = options.matchFormat || drawData.matchFormat || AppConfig.MATCH_FORMAT || '';
    const infoX = totalWidth - 8;
    this._text(svg, infoX, 18, tournamentName, {
      fontSize: P.fontSize.title - 2, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'end',
    });

    const dateParts = [];
    if (drawData.date) dateParts.push(drawData.date);
    if (drawData.venue) dateParts.push(drawData.venue);
    if (dateParts.length > 0) {
      this._text(svg, infoX, 36, dateParts.join('  '), {
        fontSize: P.fontSize.meta, fill: P.colors.subText, textAnchor: 'end',
      });
    }
    if (matchFormat) {
      this._text(svg, infoX, 52, matchFormat, {
        fontSize: P.fontSize.meta, fill: P.colors.subText, textAnchor: 'end',
      });
    }
  },

  /**
   * 半分のブラケットを描画
   * Excel参考: 各選手は1行、間に罫線行がある
   * スロット番号: 偶数=選手行(i*2)、奇数=間の行(i*2+1)
   */
  _drawHalf(svg, halfDraw, halfSize, rounds, bodyTop, offsetX, direction) {
    const P = this.PARAMS;
    const isLeft = direction === 'left';

    // 選手iのY中心（スロット i*2 を使う）
    const playerY = (i) => bodyTop + (i * 2) * P.slotHeight + P.slotHeight / 2;
    // ペア間のY（スロット i*2+1）
    const gapY = (i) => bodyTop + (i * 2 + 1) * P.slotHeight + P.slotHeight / 2;

    // クリッピング用: 名前エリアの幅を超えないようにする
    const clipId = direction + '-name-clip-' + Math.random().toString(36).substr(2, 6);
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', clipId);
    const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    if (isLeft) {
      clipRect.setAttribute('x', offsetX + P.drawNumWidth);
      clipRect.setAttribute('y', 0);
      clipRect.setAttribute('width', P.nameAreaWidth);
      clipRect.setAttribute('height', 99999);
    } else {
      clipRect.setAttribute('x', offsetX + rounds * P.roundWidth + P.drawNumWidth);
      clipRect.setAttribute('y', 0);
      clipRect.setAttribute('width', P.nameAreaWidth);
      clipRect.setAttribute('height', 99999);
    }
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);

    // --- 所属の開始X座標を統一するため、最長名前を計算 ---
    let maxNameLen = 0;
    for (let i = 0; i < halfSize; i++) {
      const entry = halfDraw[i];
      if (entry.isBye || entry.isEmpty) continue;
      const isDoublesEntry = entry.name && entry.name.includes(' / ');
      if (isDoublesEntry) {
        const players = entry.name.split(' / ');
        maxNameLen = Math.max(maxNameLen, (players[0] || '').length, (players[1] || '').length);
      } else {
        maxNameLen = Math.max(maxNameLen, (entry.name || '').length);
      }
    }
    const affiliationX_offset = Math.min(P.nameAreaWidth * 0.6, Math.max(80, maxNameLen * (P.fontSize.playerName) * 0.65 + 8));

    // --- 選手描画 ---
    for (let i = 0; i < halfSize; i++) {
      const entry = halfDraw[i];
      const cy = playerY(i);

      let nameX, numX;
      if (isLeft) {
        numX = offsetX + P.drawNumWidth / 2;
        nameX = offsetX + P.drawNumWidth + 4;
      } else {
        numX = offsetX + rounds * P.roundWidth + P.drawNumWidth / 2;
        nameX = offsetX + rounds * P.roundWidth + P.drawNumWidth + 4;
      }

      const hasSeed = entry.seed > 0;

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
        // ドロー番号（シード番号は表示しない）
        const posEl = this._text(svg, numX, cy, String(entry.position), {
          fontSize: P.fontSize.drawNum, fill: P.colors.text, fontWeight: 'bold', textAnchor: 'middle',
        });
        posEl.setAttribute('dominant-baseline', 'central');

        const affilX = nameX + affiliationX_offset;

        // ダブルス判定
        const isDoublesEntry = entry.name && entry.name.includes(' / ');
        if (isDoublesEntry) {
          const players = entry.name.split(' / ');
          const affiliations = (entry.affiliation || '').split(' / ');
          // 1行目
          const el1 = this._text(svg, nameX, cy - 2, players[0] || '', {
            fontSize: P.fontSize.playerName - 1, fill: P.colors.text,
            fontWeight: entry.seed > 0 ? 'bold' : 'normal',
          });
          el1.setAttribute('clip-path', 'url(#' + clipId + ')');
          // 所属1
          const af1 = this._text(svg, affilX, cy - 2, affiliations[0] || '', {
            fontSize: P.fontSize.affiliation, fill: P.colors.subText,
          });
          af1.setAttribute('clip-path', 'url(#' + clipId + ')');
          // 2行目
          const el2 = this._text(svg, nameX, cy + P.slotHeight / 2 - 2, players[1] || '', {
            fontSize: P.fontSize.playerName - 1, fill: P.colors.text,
            fontWeight: entry.seed > 0 ? 'bold' : 'normal',
          });
          el2.setAttribute('clip-path', 'url(#' + clipId + ')');
          // 所属2
          const af2 = this._text(svg, affilX, cy + P.slotHeight / 2 - 2, affiliations[1] || affiliations[0] || '', {
            fontSize: P.fontSize.affiliation, fill: P.colors.subText,
          });
          af2.setAttribute('clip-path', 'url(#' + clipId + ')');
        } else {
          // シングルス: 名前の中央からブラケット線が出るように配置
          // cy = playerY(i) = ブラケット線の接続Y座標
          // dominant-baseline="central" で文字の垂直中央をcyに合わせる
          const nameEl = this._text(svg, nameX, cy, entry.name, {
            fontSize: P.fontSize.playerName, fill: P.colors.text,
            fontWeight: entry.seed > 0 ? 'bold' : 'normal',
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
      }

      // 選手の下に区切り線
      if (isLeft) {
        const lineStartX = offsetX + P.drawNumWidth;
        const lineEndX = offsetX + P.drawNumWidth + P.nameAreaWidth;
        this._line(svg, lineStartX, cy + P.slotHeight / 2, lineEndX, cy + P.slotHeight / 2, '#ddd', 0.5);
      } else {
        const lineStartX = offsetX + rounds * P.roundWidth;
        const lineEndX = lineStartX + P.drawNumWidth + P.nameAreaWidth;
        this._line(svg, lineStartX, cy + P.slotHeight / 2, lineEndX, cy + P.slotHeight / 2, '#ddd', 0.5);
      }
    }

    // --- ブラケット罫線 ---
    for (let round = 0; round < rounds; round++) {
      const pairSize = Math.pow(2, round + 1); // このラウンドで1ブロックの選手数
      const matchCount = halfSize / pairSize;

      for (let match = 0; match < matchCount; match++) {
        const blockStart = match * pairSize;

        let topY, bottomY;
        if (round === 0) {
          topY = playerY(blockStart);
          bottomY = playerY(blockStart + 1);
        } else {
          // 前ラウンドの各ブロック中間
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

        // 横線（上・下）
        this._line(svg, lineX, topY, isLeft ? nextX : nextX, topY, P.colors.line);
        this._line(svg, lineX, bottomY, isLeft ? nextX : nextX, bottomY, P.colors.line);
        // 縦線
        const vertX = isLeft ? nextX : nextX;
        this._line(svg, vertX, topY, vertX, bottomY, P.colors.line);
      }
    }
  },

  /**
   * 決勝線（中央）: 左右の山から伸びた線が中央で繋がり、上に短い線が伸びる
   */
  _drawFinal(svg, halfSize, halfRounds, bodyTop, halfWidth, totalWidth) {
    const P = this.PARAMS;
    const playerY = (i) => bodyTop + (i * 2) * P.slotHeight + P.slotHeight / 2;
    const centerX = totalWidth / 2;

    // 左右の山の最終出口Y（同じ高さ）
    const finalY = (playerY(0) + playerY(halfSize - 1)) / 2;

    // 左の山 → 中央
    const leftEndX = P.drawNumWidth + P.nameAreaWidth + halfRounds * P.roundWidth;
    this._line(svg, leftEndX, finalY, centerX, finalY, P.colors.line);

    // 右の山 → 中央
    const rightStartX = halfWidth + P.centerGap;
    this._line(svg, rightStartX, finalY, centerX, finalY, P.colors.line);

    // 中央から上に短い線（優勝者線）
    this._line(svg, centerX, finalY, centerX, finalY - 30, P.colors.line, 1);
  },

  _drawSeedInfo(svg, drawData, y, totalWidth) {
    const P = this.PARAMS;
    const seeds = drawData.seeds || [];
    if (seeds.length === 0) return;
    const isDoubles = drawData.isDoubles || false;
    const seedText = 'シード  ' + seeds.map(s => {
      let displayName = s.name;
      if (isDoubles && displayName.includes(' / ')) {
        // ダブルス: 苗字のみ表示（山本/田中）
        displayName = displayName.split(' / ').map(n => n.split(/\s+/)[0]).join('/');
      }
      return s.seed + '.' + displayName;
    }).join('   ');
    this._text(svg, totalWidth / 2, y, seedText, {
      fontSize: P.fontSize.seed, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'middle',
    });
  },

  // =============================================================
  // Excel出力（参考ファイルに近い形式）
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
    const wb = XLSX.utils.book_new();
    const wsData = [];

    // 列構成: 空白(1) + No(1) + 名前(1) + 所属(1) + 空白(1) = 5列(左) + bracket + center(2) + bracket + 4列(右)
    const leftDataCols = 5; // 空白(マージン), No, 名前, 所属, 空白
    const rightDataCols = 4; // 空白, No, 名前, 所属
    const centerCols = 2;
    const totalCols = leftDataCols + halfRounds + centerCols + halfRounds + rightDataCols;

    // 列幅設定
    const colWidths = [];
    // 左: 空白(マージン), No, 名前, 所属, 空白
    colWidths.push({ wch: 1 }, { wch: 4 }, { wch: 16 }, { wch: 10 }, { wch: 1.5 });
    for (let r = 0; r < halfRounds; r++) colWidths.push({ wch: 5 });
    // 中央2列
    colWidths.push({ wch: 3 }, { wch: 3 });
    for (let r = 0; r < halfRounds; r++) colWidths.push({ wch: 5 });
    // 右: 空白, No, 名前, 所属
    colWidths.push({ wch: 1.5 }, { wch: 4 }, { wch: 16 }, { wch: 10 });

    // ヘッダー行
    const matchFormat = drawData.matchFormat || AppConfig.MATCH_FORMAT || '';
    const centerLeftCol = leftDataCols + halfRounds;
    // 1行目: 空白行
    wsData.push(new Array(totalCols).fill(''));
    // 2行目: 種目名(左) + 大会名(右端揃え)
    const h1 = new Array(totalCols).fill('');
    h1[1] = eventName;
    h1[centerLeftCol] = drawData.tournamentName || AppConfig.TOURNAMENT_NAME || '';
    wsData.push(h1);
    // 3行目: 日付・場所(右端揃え)
    const h2 = new Array(totalCols).fill('');
    const dateVenue = [];
    if (drawData.date) dateVenue.push(drawData.date);
    if (drawData.venue) dateVenue.push(drawData.venue);
    h2[centerLeftCol] = dateVenue.join('  ');
    wsData.push(h2);
    // 4行目: ゲーム形式(右端揃え)
    const h3 = new Array(totalCols).fill('');
    h3[centerLeftCol] = matchFormat;
    wsData.push(h3);
    // 空行
    wsData.push(new Array(totalCols).fill(''));
    const headerRows = 5;

    const leftDraw = draw.slice(0, halfSize);
    const rightDraw = draw.slice(halfSize);
    const rightStartCol = leftDataCols + halfRounds + centerCols + halfRounds;

    // シングルスの2行結合セル情報を収集
    const singlesMerges = []; // { row, side: 'left'|'right' }

    for (let i = 0; i < halfSize; i++) {
      const left = leftDraw[i];
      const right = rightDraw[i];
      const leftIsDoublesEntry = isDoubles && !left.isBye && left.name && left.name.includes(' / ');
      const rightIsDoublesEntry = isDoubles && !right.isBye && right.name && right.name.includes(' / ');

      if (leftIsDoublesEntry || rightIsDoublesEntry) {
        // ダブルス: 2行で表示（選手1 + 選手2）
        const leftPlayers = leftIsDoublesEntry ? left.name.split(' / ') : [left.isBye ? 'bye' : left.name, ''];
        const leftAffils = leftIsDoublesEntry ? (left.affiliation || '').split(' / ') : [left.isBye ? '' : (left.affiliation || ''), ''];
        const rightPlayers = rightIsDoublesEntry ? right.name.split(' / ') : [right.isBye ? 'bye' : right.name, ''];
        const rightAffils = rightIsDoublesEntry ? (right.affiliation || '').split(' / ') : [right.isBye ? '' : (right.affiliation || ''), ''];

        // 1行目
        const row1 = new Array(totalCols).fill('');
        row1[1] = left.isBye ? '' : left.position;
        row1[2] = left.isBye ? 'bye' : leftPlayers[0];
        row1[3] = left.isBye ? '' : (leftAffils[0] || '');
        row1[rightStartCol + 1] = right.isBye ? '' : right.position;
        row1[rightStartCol + 2] = right.isBye ? 'bye' : rightPlayers[0];
        row1[rightStartCol + 3] = right.isBye ? '' : (rightAffils[0] || '');
        wsData.push(row1);
        // 2行目
        const row2 = new Array(totalCols).fill('');
        row2[2] = left.isBye ? '' : (leftPlayers[1] || '');
        row2[3] = left.isBye ? '' : (leftAffils[1] || leftAffils[0] || '');
        row2[rightStartCol + 2] = right.isBye ? '' : (rightPlayers[1] || '');
        row2[rightStartCol + 3] = right.isBye ? '' : (rightAffils[1] || rightAffils[0] || '');
        wsData.push(row2);
      } else {
        // シングルスまたはBYE同士: 2行使って結合セル
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

        // シングルス（非ダブルス）の場合、2行結合で名前の中央にブラケット線を合わせる
        if (!isDoubles) {
          singlesMerges.push({ row: currentRow, side: 'left' });
          singlesMerges.push({ row: currentRow, side: 'right' });
        }
      }
    }

    // シード情報行（結合セルで中央揃え）
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
    // フッター空行
    wsData.push(new Array(totalCols).fill(''));

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = colWidths;

    // --- スタイル設定 ---
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
    // 種目名: 太字、col 1 から中央線手前まで結合
    const h1cell = ensureCell(1, 1);
    h1cell.s.font = { bold: true, sz: 14 };
    const eventMergeEnd = leftDataCols + halfRounds - 1;
    ws['!merges'].push({ s: { r: 1, c: 1 }, e: { r: 1, c: eventMergeEnd } });

    // 大会名・日付・形式: 中央線から右端まで結合、右揃え
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

    // --- シングルス: 2行結合セル（名前の中央にブラケット線が来る） ---
    for (const sm of singlesMerges) {
      const cols = sm.side === 'left' ? [1, 2, 3] : [rightStartCol + 1, rightStartCol + 2, rightStartCol + 3];
      for (const c of cols) {
        ws['!merges'].push({ s: { r: sm.row, c: c }, e: { r: sm.row + 1, c: c } });
        const cell = ensureCell(sm.row, c);
        if (!cell.s.alignment) cell.s.alignment = {};
        cell.s.alignment.vertical = 'center';
      }
    }

    // --- 左の山のブラケット罫線 ---
    for (let round = 0; round < halfRounds; round++) {
      const pairSize = Math.pow(2, round + 1);
      const matchCount = halfSize / pairSize;
      const bracketCol = leftDataCols + round;

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

        const cellTop = ensureCell(topRow, bracketCol);
        cellTop.s.border.bottom = border();
        const cellBottom = ensureCell(bottomRow, bracketCol);
        cellBottom.s.border.bottom = border();
        for (let r = topRow + 1; r <= bottomRow; r++) {
          const cell = ensureCell(r, bracketCol);
          cell.s.border.right = border();
        }
      }
    }

    // --- 右の山のブラケット罫線 ---
    for (let round = 0; round < halfRounds; round++) {
      const pairSize = Math.pow(2, round + 1);
      const matchCount = halfSize / pairSize;
      const bracketCol = leftDataCols + halfRounds + centerCols + (halfRounds - 1 - round);

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

        const cellTop = ensureCell(topRow, bracketCol);
        cellTop.s.border.bottom = border();
        const cellBottom = ensureCell(bottomRow, bracketCol);
        cellBottom.s.border.bottom = border();
        for (let r = topRow + 1; r <= bottomRow; r++) {
          const cell = ensureCell(r, bracketCol);
          cell.s.border.left = border();
        }
      }
    }

    // --- 選手名行の区切り線 ---
    for (let i = 0; i < halfSize; i++) {
      const row = headerRows + i * 2;
      // 2行目（row+1）の下に区切り線（シングルス・ダブルス共通）
      const borderRow = row + 1;
      // 左側: No, 名前, 所属の3列
      for (let c = 1; c < leftDataCols - 1; c++) {
        const cell = ensureCell(borderRow, c);
        cell.s.border.bottom = border('hair');
      }
      // 右側: No, 名前, 所属の3列
      for (let c = rightStartCol + 1; c < rightStartCol + rightDataCols; c++) {
        const cell = ensureCell(borderRow, c);
        cell.s.border.bottom = border('hair');
      }
    }

    // --- 決勝線 ---
    const centerRightCol = centerLeftCol + 1;
    const midRow = headerRows + halfSize - 1;

    const finalRoundLeftCol = leftDataCols + halfRounds - 1;
    for (let c = finalRoundLeftCol + 1; c <= centerLeftCol; c++) {
      const cell = ensureCell(midRow, c);
      cell.s.border.bottom = border();
    }
    const finalRoundRightCol = leftDataCols + halfRounds + centerCols;
    for (let c = finalRoundRightCol - 1; c >= centerRightCol; c--) {
      const cell = ensureCell(midRow, c);
      cell.s.border.bottom = border();
    }
    const cellUp = ensureCell(midRow, centerLeftCol);
    cellUp.s.border.right = border();

    // シード情報行: 全列を結合して中央揃え
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
        '', '', '', '', '', '', '',
        '', '', '',
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
