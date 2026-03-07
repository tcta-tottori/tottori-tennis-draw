/**
 * config.js - GASから移植した設定定数
 * グローバルスコープ（window.AppConfig）にエクスポート
 */
window.AppConfig = {
  // --- 大会情報 ---
  TOURNAMENT_NAME: '令和7年度 鳥取県テニス選手権大会',
  TOURNAMENT_DATE: '令和7年11月9日（日）',
  TOURNAMENT_VENUE: 'ヤマタスポーツパーク',
  MATCH_FORMAT: '8ゲームマッチ（8-8タイブレーク）',

  // --- 種目カテゴリ ---
  EVENT_CATEGORIES: [
    { key: 'singles', name: 'シングルス' },
    { key: 'doubles', name: 'ダブルス' },
  ],

  EVENTS: [
    // シングルス
    { code: 'ms',    name: '一般男子シングルス',         shortName: '男子S',      category: 'singles' },
    { code: 'ls',    name: '一般女子シングルス',         shortName: '女子S',      category: 'singles' },
    { code: 'm35s',  name: '男子35歳以上シングルス',     shortName: '男子35S',    category: 'singles' },
    { code: 'm45s',  name: '男子45歳以上シングルス',     shortName: '男子45S',    category: 'singles' },
    { code: 'm55s',  name: '男子55歳以上シングルス',     shortName: '男子55S',    category: 'singles' },
    { code: 'm65s',  name: '男子65歳以上シングルス',     shortName: '男子65S',    category: 'singles' },
    { code: 'mbs',   name: '男子B級シングルス',          shortName: '男子BS',     category: 'singles' },
    { code: 'lbs',   name: '女子B級シングルス',          shortName: '女子BS',     category: 'singles' },
    // ダブルス
    { code: 'md',    name: '一般男子ダブルス',           shortName: '男子D',      category: 'doubles' },
    { code: 'ld',    name: '一般女子ダブルス',           shortName: '女子D',      category: 'doubles' },
    { code: 'm45d',  name: '男子45歳以上ダブルス',       shortName: '男子45D',    category: 'doubles' },
    { code: 'm55d',  name: '男子55歳以上ダブルス',       shortName: '男子55D',    category: 'doubles' },
    { code: 'm65d',  name: '男子65歳以上ダブルス',       shortName: '男子65D',    category: 'doubles' },
    { code: 'l45d',  name: '女子45歳以上ダブルス',       shortName: '女子45D',    category: 'doubles' },
    { code: 'l55d',  name: '女子55歳以上ダブルス',       shortName: '女子55D',    category: 'doubles' },
    { code: 'mbd',   name: '男子B級ダブルス',            shortName: '男子BD',     category: 'doubles' },
    { code: 'lbd',   name: '女子B級ダブルス',            shortName: '女子BD',     category: 'doubles' },
  ],

  SEED_RULES: {
    8:  { seeds: 2 },
    16: { seeds: 4 },
    32: { seeds: 4 },
    64: { seeds: 8 },
    128:{ seeds: 16 },
  },
  SEED_POSITIONS: {
    8: { seed3_4: [3, 6] },
    16: { seed3_4: [5, 12], seed5_8: [4, 8, 9, 13] },
    32: { seed3_4: [9, 24], seed5_8: [8, 16, 17, 25] },
    64: { seed3_4: [17, 48], seed5_8: [8, 24, 41, 56] },
  },

  // ランキングシート設定（gidベースで全シートを定義）
  RANK_SHEETS_BY_GID: {
    2003264006: { eventCode: 'ms',   title: '男子シングルス' },
    2002393204: { eventCode: 'ls',   title: '女子シングルス' },
    158202169:  { eventCode: 'm35s', title: '35才以上男子シングルス' },
    306513713:  { eventCode: 'm45s', title: '45才以上男子シングルス' },
    2068894970: { eventCode: 'm55s', title: '55才以上男子シングルス' },
    727351230:  { eventCode: 'm65s', title: '65才以上男子シングルス' },
    1954400812: { eventCode: 'mbs',  title: '男子B級シングルス' },
    1375892271: { eventCode: 'lbs',  title: '女子B級シングルス' },
    826028207:  { eventCode: 'md',   title: '男子ダブルス' },
    2006480911: { eventCode: 'ld',   title: '女子ダブルス' },
    1545917199: { eventCode: 'm45d', title: '45才以上男子ダブルス' },
    678070807:  { eventCode: 'm55d', title: '55才以上男子ダブルス' },
    192494921:  { eventCode: 'm65d', title: '65才以上男子ダブルス' },
    1760594453: { eventCode: 'l45d', title: '45才以上女子ダブルス' },
    112600989:  { eventCode: 'l55d', title: '55才以上女子ダブルス' },
    432686857:  { eventCode: 'mbd',  title: '男子B級ダブルス' },
    382688800:  { eventCode: 'lbd',  title: '女子B級ダブルス' },
  },

  // Excel用（ローカルファイル読み込み時のシート名マッピング）
  RANK_SHEETS: {
    'ms':   { headerRow: 2 },
    'ls':   { headerRow: 3 },
    'm35s': { headerRow: 3 },
    'm45s': { headerRow: 3 },
    'm55s': { headerRow: 3 },
    'm65s': { headerRow: 3 },
    'mbs':  { headerRow: 3 },
    'lbs':  { headerRow: 3 },
    'md':   { headerRow: 3 },
    'ld':   { headerRow: 3 },
    'm45d': { headerRow: 3 },
    'm55d': { headerRow: 3 },
    'm65d': { headerRow: 3 },
    'l45d': { headerRow: 3 },
    'l55d': { headerRow: 3 },
    'mbd':  { headerRow: 3 },
    'lbd':  { headerRow: 3 },
  },

  // rank.xlsxの列構造（0-indexed）
  RANK_COL: { TIED: 0, RANK: 1, NAME: 2, AFFILIATION: 3, POINTS: 4 },

  // --- デフォルトのスプレッドシートURL ---
  DEFAULT_RANKING_SPREADSHEET: 'https://docs.google.com/spreadsheets/d/1h2kUBN8KaqSrftw3O16McFIlQ4F744TnpcI5RrgWz7E/edit?gid=826028207#gid=826028207',
  DEFAULT_FURIGANA_SPREADSHEET: 'https://docs.google.com/spreadsheets/d/16O5GlMtiOXNZgyjQ65oAVVawg9hq2AYgvn7InlFxico/edit?gid=0#gid=0',
};
