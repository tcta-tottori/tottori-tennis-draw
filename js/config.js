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
    // シングルス（男子→女子、種類ごと）
    { code: 'ms',    name: '一般男子シングルス',         shortName: '男子S',      category: 'singles' },
    { code: 'ls',    name: '一般女子シングルス',         shortName: '女子S',      category: 'singles' },
    { code: 'm35s',  name: '男子35歳以上シングルス',     shortName: '男子35S',    category: 'singles' },
    { code: 'm45s',  name: '男子45歳以上シングルス',     shortName: '男子45S',    category: 'singles' },
    { code: 'm55s',  name: '男子55歳以上シングルス',     shortName: '男子55S',    category: 'singles' },
    { code: 'm65s',  name: '男子65歳以上シングルス',     shortName: '男子65S',    category: 'singles' },
    { code: 'l45s',  name: '女子45歳以上シングルス',     shortName: '女子45S',    category: 'singles' },
    { code: 'mbs',   name: '男子B級シングルス',          shortName: '男子BS',     category: 'singles' },
    { code: 'lbs',   name: '女子B級シングルス',          shortName: '女子BS',     category: 'singles' },
    // ダブルス（男子→女子、種類ごと）
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
    32: { seeds: 8 },
    64: { seeds: 16 },
    128:{ seeds: 16 },
  },
  SEED_POSITIONS: {
    16: { seed3_4: [5, 12] },
    32: { seed3_4: [9, 24], seed5_8: [8, 16, 17, 25] },
    64: { seed3_4: [17, 48], seed5_8: [16, 32, 33, 49], seed9_16: [8, 24, 25, 41, 40, 56, 57, 9] },
    128:{ seed3_4: [33, 96], seed5_8: [32, 64, 65, 97], seed9_16: [16, 48, 49, 81, 80, 112, 113, 17] },
  },

  VENUE_OPTIONS: [
    'ヤマタスポーツパーク・テニスコート',
    '千代テニス場',
  ],

  MATCH_FORMAT_OPTIONS: [
    '6ゲームマッチ（6-6タイブレーク）',
    '6ゲームマッチ（6-6タイブレーク）ノーアドバンテージ',
    '8ゲームマッチ（8-8タイブレーク）',
    '8ゲームマッチ（8-8タイブレーク）ノーアドバンテージ',
  ],

  // デフォルト大会日程
  DEFAULT_TOURNAMENTS: [
    { name: '第56回東部地区テニス選手権', events: '男女シングルス', date: '3月22日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '3/28', reserveVenue: '千代' },
    { name: '第56回東部地区テニス選手権', events: '男女ダブルス', date: '3月29日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '4/4', reserveVenue: '千代' },
    { name: '佐々木杯テニス大会', events: 'ミックスダブルス', date: '4月5日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '4/11', reserveVenue: '千代' },
    { name: '第61回鳥取市テニス協会会長杯（春季）', events: '団体戦', date: '4月29日', dayOfWeek: '（祝）', venue: 'テニスコート', reserveDate: '5/6', reserveVenue: '千代' },
    { name: '第70回鳥取健康テニス（春期） 一般の部・ジュニアの部', events: '一般：男女複 / ジュニア：男女単', date: '5月2日', dayOfWeek: '（土）', venue: 'テニスコート', reserveDate: '荒天中止', reserveVenue: '' },
    { name: '令和８年度クラブ対抗戦 前期日程', events: '男子1部～8部', date: '5月10日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '5/31', reserveVenue: '千代' },
    { name: '鳥取市市民体育祭（BCグループ）', events: '校区別対抗戦', date: '7月5日', dayOfWeek: '（日）', venue: '鳥取市千代テニス場', reserveDate: '7/19', reserveVenue: '千代' },
    { name: '令和８年度クラブ対抗戦 後期日程', events: '女子1部～4部 / 男・女予選会', date: '7月12日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '7/18', reserveVenue: '千代' },
    { name: '第11回気高カップシングルス大会', events: '男女シングルス', date: '8月2日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '8/8', reserveVenue: '千代' },
    { name: 'サマーミックスダブルス', events: 'ミックスダブルス', date: '8月16日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '9/6', reserveVenue: '千代' },
    { name: '第49回ダンロップテニストーナメント', events: '男女ダブルス', date: '8月30日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '9/5', reserveVenue: '千代' },
    { name: '鳥取市テニス協会 テニス祭り', events: 'テニス教室他', date: '10月12日', dayOfWeek: '（祝）', venue: '鳥取産業体育館', reserveDate: '', reserveVenue: '' },
    { name: '第30回エネトピア杯ミックスダブルス', events: 'ミックスダブルス', date: '10月18日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '10/24', reserveVenue: '千代' },
    { name: '第71回鳥取健康テニス（秋期） 一般の部・ジュニアの部', events: '一般：男女複 / ジュニア：男女単', date: '11月7日', dayOfWeek: '（土）', venue: 'テニスコート', reserveDate: '荒天中止', reserveVenue: '' },
    { name: '鳥取県テニス選手権 シングルス', events: '男女シングルス', date: '11月8日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '11/14', reserveVenue: '千代' },
    { name: '第62回鳥取市テニス協会会長杯（秋季）', events: '男女ダブルス', date: '11月15日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '11/21', reserveVenue: '千代' },
    { name: '2026 プリンスオープン鳥取県大会', events: '団体戦（予定）', date: '11月22日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '11/28', reserveVenue: 'ヤマタ' },
    { name: '第41回鳥取市市長杯', events: '男女シングルス', date: '11月23日', dayOfWeek: '（祝）', venue: 'テニスコート', reserveDate: '12/5', reserveVenue: 'ヤマタ' },
    { name: '鳥取県テニス選手権 ダブルス', events: '男女ダブルス', date: '11月29日', dayOfWeek: '（日）', venue: 'テニスコート', reserveDate: '12/6', reserveVenue: 'ヤマタ' },
    { name: '尾坂杯鳥取室内テニス選手権', events: '男女シングルス / 男女ダブルス', date: '12/27～2/23', dayOfWeek: '', venue: '鳥取市民体育館 / 鳥取産業体育館', reserveDate: '', reserveVenue: '' },
  ],

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
    'l45s': { headerRow: 3 },
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
