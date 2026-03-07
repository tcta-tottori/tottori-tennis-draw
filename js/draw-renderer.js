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
    drawNumWidth: 26,         // ドロー番号列幅
    headerHeight: 80,
    footerHeight: 40,
    centerGap: 80,            // 左右の山の中央間隔
    fontSize: {
      title: 15, eventName: 13, meta: 10,
      playerName: 10, affiliation: 8, bye: 9,
      drawNum: 10, seed: 9, roundLabel: 9,
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
    this._text(svg, totalWidth / 2, 22, drawData.tournamentName || '', {
      fontSize: P.fontSize.title, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'middle',
    });
    this._text(svg, totalWidth / 2, 42, drawData.eventName || '', {
      fontSize: P.fontSize.eventName, fontWeight: 'bold', fill: P.colors.text, textAnchor: 'middle',
    });
    const matchFormat = options.matchFormat || drawData.matchFormat || AppConfig.MATCH_FORMAT || '';
    this._text(svg, totalWidth / 2, 58, (drawData.date || '') + '  ' + (drawData.venue || ''), {
      fontSize: P.fontSize.meta, fill: P.colors.subText, textAnchor: 'middle',
    });
    this._text(svg, totalWidth / 2, 72, matchFormat + '  エントリー: ' + (drawData.entryCount || 0) + '名  ドロー: ' + drawData.drawSize, {
      fontSize: P.fontSize.meta, fill: P.colors.subText, textAnchor: 'middle',
    });
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

    // --- 選手描画 ---
    for (let i = 0; i < halfSize; i++) {
      const entry = halfDraw[i];
      const cy = playerY(i);

      let nameX, numX;
      if (isLeft) {
        numX = offsetX + P.drawNumWidth / 2;
        nameX = offsetX + P.drawNumWidth + 4;
      } else {
        // 右山: 番号を名前の左側に配置
        numX = offsetX + rounds * P.roundWidth + P.drawNumWidth / 2;
        nameX = offsetX + rounds * P.roundWidth + P.drawNumWidth + 4;
      }

      if (entry.isBye) {
        this._text(svg, nameX, cy + 4, 'BYE', {
          fontSize: P.fontSize.bye, fill: P.colors.bye, fontStyle: 'italic',
        });
        this._text(svg, numX, cy + 4, String(entry.position), {
          fontSize: P.fontSize.drawNum, fill: P.colors.bye, textAnchor: 'middle',
        });
      } else if (entry.isEmpty) {
        // 未配置（手動配置中）
        this._text(svg, nameX, cy + 4, '---', {
          fontSize: P.fontSize.playerName, fill: P.colors.emptySlot,
        });
        this._text(svg, numX, cy + 4, String(entry.position), {
          fontSize: P.fontSize.drawNum, fill: P.colors.emptySlot, textAnchor: 'middle',
        });
      } else {
        // ドロー番号
        this._text(svg, numX, cy + 4, String(entry.position), {
          fontSize: P.fontSize.drawNum, fill: P.colors.text, fontWeight: 'bold', textAnchor: 'middle',
        });
        // 名前 + 所属（横並び）
        let nameDisplay = entry.name;
        if (entry.seed > 0) nameDisplay = '[' + entry.seed + '] ' + entry.name;
        if (entry.affiliation) nameDisplay += ' (' + entry.affiliation + ')';
        this._text(svg, nameX, cy + 4, nameDisplay, {
          fontSize: P.fontSize.playerName, fill: P.colors.text,
          fontWeight: entry.seed > 0 ? 'bold' : 'normal',
        });
      }

      // 選手の下に区切り線（ペアの間）
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
    const seedText = 'シード  ' + seeds.map(s => s.seed + '.' + s.name).join('   ');
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
    const wb = XLSX.utils.book_new();
    const wsData = [];

    // 左の列構成: No(1), 名前(1), ((1), 所属(1), )(1) = 5列
    // 各ラウンド: 1列ずつ
    // 右の列構成: 同じ（番号は名前の左側に）
    const leftDataCols = 5;
    const rightDataCols = 5;
    const centerCols = 3;  // 決勝エリア用
    const totalRoundCols = halfRounds * 2;  // 左右合わせてラウンド列
    const totalCols = leftDataCols + halfRounds + centerCols + halfRounds + rightDataCols;

    // 列幅設定
    const colWidths = [];
    // 左: No, 名前, (, 所属, )
    colWidths.push({ wch: 4 }, { wch: 14 }, { wch: 2 }, { wch: 12 }, { wch: 2 });
    // 左ラウンド列
    for (let r = 0; r < halfRounds; r++) colWidths.push({ wch: 5 });
    // 中央
    for (let r = 0; r < centerCols; r++) colWidths.push({ wch: 4 });
    // 右ラウンド列
    for (let r = 0; r < halfRounds; r++) colWidths.push({ wch: 5 });
    // 右: No, 名前, (, 所属, )
    colWidths.push({ wch: 4 }, { wch: 14 }, { wch: 2 }, { wch: 12 }, { wch: 2 });

    // ヘッダー行
    wsData.push([drawData.tournamentName || '']);
    wsData.push([]);
    const headerRow = new Array(totalCols).fill('');
    headerRow[0] = eventName;
    headerRow[totalCols - 1] = drawData.matchFormat || AppConfig.MATCH_FORMAT || '';
    wsData.push(headerRow);
    wsData.push([]);
    wsData.push([]);
    const headerRows = 5;

    const leftDraw = draw.slice(0, halfSize);
    const rightDraw = draw.slice(halfSize);

    // 右側データ開始列
    const rightStartCol = leftDataCols + halfRounds + centerCols + halfRounds;

    // 各選手は2行使う（選手行 + 間隔行）
    for (let i = 0; i < halfSize; i++) {
      const left = leftDraw[i];
      const right = rightDraw[i];

      const row = new Array(totalCols).fill('');
      // 左: No, 名前, (, 所属, )
      row[0] = left.isBye ? '' : left.position;
      row[1] = left.isBye ? 'bye' : (left.seed > 0 ? '[' + left.seed + '] ' : '') + left.name;
      row[2] = left.isBye ? '' : '(';
      row[3] = left.isBye ? '' : (left.affiliation || '');
      row[4] = left.isBye ? '' : ')';
      // 右: No, 名前, (, 所属, )
      row[rightStartCol] = right.isBye ? '' : right.position;
      row[rightStartCol + 1] = right.isBye ? 'bye' : (right.seed > 0 ? '[' + right.seed + '] ' : '') + right.name;
      row[rightStartCol + 2] = right.isBye ? '' : '(';
      row[rightStartCol + 3] = right.isBye ? '' : (right.affiliation || '');
      row[rightStartCol + 4] = right.isBye ? '' : ')';
      wsData.push(row);

      // 間隔行
      wsData.push(new Array(totalCols).fill(''));
    }

    // シード情報行
    wsData.push(new Array(totalCols).fill(''));
    const seeds = drawData.seeds || [];
    if (seeds.length > 0) {
      const seedRow = new Array(totalCols).fill('');
      seedRow[1] = 'シード: ' + seeds.map(s => s.seed + '.' + s.name).join('  ');
      wsData.push(seedRow);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = colWidths;

    // --- トーナメント罫線の追加 ---
    const border = (style) => ({ style: style || 'thin', color: { rgb: '000000' } });

    // セル参照ヘルパー
    const cellRef = (r, c) => XLSX.utils.encode_cell({ r: r, c: c });
    const ensureCell = (r, c) => {
      const ref = cellRef(r, c);
      if (!ws[ref]) ws[ref] = { v: '', t: 's' };
      if (!ws[ref].s) ws[ref].s = {};
      if (!ws[ref].s.border) ws[ref].s.border = {};
      return ws[ref];
    };

    // 左の山のブラケット罫線
    for (let round = 0; round < halfRounds; round++) {
      const pairSize = Math.pow(2, round + 1);
      const matchCount = halfSize / pairSize;
      const bracketCol = leftDataCols + round;  // この列に罫線を描く

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

        // 上横線（選手行の下罫線）
        const cellTop = ensureCell(topRow, bracketCol);
        cellTop.s.border.bottom = border();

        // 下横線
        const cellBottom = ensureCell(bottomRow, bracketCol);
        cellBottom.s.border.bottom = border();

        // 縦線（上から下まで）
        for (let r = topRow; r <= bottomRow; r++) {
          const cell = ensureCell(r, bracketCol);
          cell.s.border.right = border();
        }
      }
    }

    // 右の山のブラケット罫線
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

        // 上横線
        const cellTop = ensureCell(topRow, bracketCol);
        cellTop.s.border.bottom = border();

        // 下横線
        const cellBottom = ensureCell(bottomRow, bracketCol);
        cellBottom.s.border.bottom = border();

        // 縦線（上から下まで）- 左側に
        for (let r = topRow; r <= bottomRow; r++) {
          const cell = ensureCell(r, bracketCol);
          cell.s.border.left = border();
        }
      }
    }

    // 選手名行の下線（区切り線）
    for (let i = 0; i < halfSize; i++) {
      const row = headerRows + i * 2;
      // 左側
      for (let c = 0; c < leftDataCols; c++) {
        const cell = ensureCell(row, c);
        cell.s.border.bottom = border('hair');
      }
      // 右側
      for (let c = rightStartCol; c < rightStartCol + rightDataCols; c++) {
        const cell = ensureCell(row, c);
        cell.s.border.bottom = border('hair');
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, eventName.substring(0, 31));

    // エントリーリストシート
    const entryData = [['エントリーリスト - ' + eventName], ['順位', '氏名', 'ふりがな', '所属', 'ポイント', 'シード']];
    const sorted = [...(drawData.entries || [])].filter(e => !e.isBye).sort((a, b) => (b.points || 0) - (a.points || 0));
    sorted.forEach((e, i) => {
      entryData.push([i + 1, e.name, e.furigana || '', e.affiliation || '', e.points || 0, e.seed > 0 ? e.seed : '']);
    });
    const wsEntry = XLSX.utils.aoa_to_sheet(entryData);
    wsEntry['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 5 }];
    XLSX.utils.book_append_sheet(wb, wsEntry, 'エントリーリスト');

    XLSX.writeFile(wb, eventName.replace(/[\\/:*?"<>|]/g, '_') + '_ドロー表.xlsx');
  },

  exportToCSV(drawData) {
    const draw = drawData.draw;
    const drawSize = drawData.drawSize;
    const halfSize = drawSize / 2;
    const eventName = drawData.eventName || 'ドロー表';
    const rows = [];
    rows.push([drawData.tournamentName || '']);
    rows.push([eventName, '', '', '', '', '', '', '', '', '', '', '', '', '', '', drawData.matchFormat || AppConfig.MATCH_FORMAT || '']);
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
