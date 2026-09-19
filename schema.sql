-- ランキング本体
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  ms         INTEGER NOT NULL,   -- クリアタイム（ミリ秒）
  fails      INTEGER NOT NULL,   -- やり直し回数
  loss       INTEGER NOT NULL,   -- 累計損害額
  processed  INTEGER NOT NULL,   -- 処理した書類数
  created_at INTEGER NOT NULL    -- 記録時刻（UNIX秒）
);
CREATE INDEX IF NOT EXISTS idx_scores_ms ON scores(ms ASC);
CREATE INDEX IF NOT EXISTS idx_scores_created ON scores(created_at DESC);

-- 進行中のセッション。サーバー側で時間を計測するための台帳
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  started_at INTEGER NOT NULL,   -- サーバーが開始を記録した時刻（ミリ秒）
  ok         INTEGER NOT NULL DEFAULT 0,
  fails      INTEGER NOT NULL DEFAULT 0,
  loss       INTEGER NOT NULL DEFAULT 0,
  processed  INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
