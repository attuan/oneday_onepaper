// arXiv の手元の索引。
//
// Hugging Face の secemp9/arxiv-complete(metadata config、Parquet 1 ファイル 1.6 GB)から、
// 選んだカテゴリの論文だけを SQLite(FTS5)に入れる。検索はレート制限もネットも要らない。
// Parquet の読み込みと SQLite への書き込みはここだけが持つ。TS 側は core/scholar/arxivLocal.ts。

use std::io::Write;
use std::path::{Path, PathBuf};

use arrow::array::{Array, StringArray, TimestampMillisecondArray};
use arrow::datatypes::{DataType, TimeUnit};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::ProjectionMask;
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use tauri::ipc::Channel;

fn expand(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

#[derive(Serialize, Clone)]
pub struct Progress {
    /// download | read | finish
    pub phase: String,
    pub done: u64,
    pub total: u64,
    pub kept: u64,
}

#[derive(Serialize, Clone)]
pub struct IndexStats {
    pub path: String,
    pub papers: u64,
    pub categories: Vec<String>,
    pub built_at: String,
    pub source: String,
    /// 索引の中で一番新しい版の日付。データセットのスナップショットの目安
    pub snapshot: Option<String>,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct Hit {
    pub id: String,
    pub title: String,
    pub authors: String,
    #[serde(rename = "abstract")]
    pub abstract_: String,
    pub categories: String,
    pub primary_category: String,
    pub doi: Option<String>,
    pub journal_ref: Option<String>,
    pub year: Option<i64>,
    pub first_date: Option<String>,
}

const COLUMNS: [&str; 10] = ["paper_id", "title", "authors", "abstract", "categories", "primary_category", "doi", "journal_ref", "first_version_date", "latest_version_date"];

const SCHEMA: &str = "
CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  abstract TEXT NOT NULL,
  categories TEXT NOT NULL,
  primary_category TEXT NOT NULL,
  doi TEXT,
  journal_ref TEXT,
  year INTEGER,
  first_date TEXT,
  latest_date TEXT
);
CREATE VIRTUAL TABLE papers_fts USING fts5(title, abstract, content='papers', content_rowid='rowid', tokenize='porter unicode61');
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

/// 大きなファイルを途中経過つきで保存する(Parquet 用。download_file は PDF 専用)
#[tauri::command]
pub async fn download_large(url: String, dest: String, on_progress: Channel<Progress>) -> Result<u64, String> {
    let client = tauri_plugin_http::reqwest::Client::builder()
        .user_agent("OneDayOnePaper/0.1 (personal research tool)")
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0);
    let p = expand(&dest);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let part = PathBuf::from(format!("{}.part", p.display()));
    let mut file = std::io::BufWriter::new(std::fs::File::create(&part).map_err(|e| e.to_string())?);
    let mut done: u64 = 0;
    let mut reported: u64 = 0;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        if done - reported >= 8 * 1024 * 1024 {
            reported = done;
            let _ = on_progress.send(Progress { phase: "download".into(), done, total, kept: 0 });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if total > 0 && done != total {
        let _ = std::fs::remove_file(&part);
        return Err(format!("途中で切れました ({} / {} bytes)", done, total));
    }
    std::fs::rename(&part, &p).map_err(|e| e.to_string())?;
    let _ = on_progress.send(Progress { phase: "download".into(), done, total, kept: 0 });
    Ok(done)
}

/// Parquet から索引を作る。dest が既にあれば作り直す
#[tauri::command]
pub async fn arxiv_index_build(parquet: String, dest: String, categories: Vec<String>, on_progress: Channel<Progress>) -> Result<IndexStats, String> {
    let cats = normalize_categories(&categories);
    tauri::async_runtime::spawn_blocking(move || {
        build(&expand(&parquet), &expand(&dest), &cats, &|p| {
            let _ = on_progress.send(p);
        })
    })
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn arxiv_index_stats(path: String) -> Result<Option<IndexStats>, String> {
    let p = expand(&path);
    if !p.exists() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(&p, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    stats(&conn, &p).map(Some)
}

/// query の語を FTS5 で検索する。mode は all(すべて含む)か any(どれかを含む。似た論文を探すとき)
#[tauri::command]
pub fn arxiv_index_search(path: String, query: String, mode: String, categories: Vec<String>, year_from: Option<i64>, year_to: Option<i64>, limit: u32) -> Result<Vec<Hit>, String> {
    search(&expand(&path), &query, &mode, &normalize_categories(&categories), year_from, year_to, limit)
}

fn search(path: &Path, query: &str, mode: &str, cats: &[String], year_from: Option<i64>, year_to: Option<i64>, limit: u32) -> Result<Vec<Hit>, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let q = fts_query(query, mode);
    if q.is_empty() {
        return Ok(vec![]);
    }
    let mut sql = String::from(
        "SELECT p.id, p.title, p.authors, p.abstract, p.categories, p.primary_category, p.doi, p.journal_ref, p.year, p.first_date \
         FROM papers_fts f JOIN papers p ON p.rowid = f.rowid \
         WHERE papers_fts MATCH ?1 AND (?2 IS NULL OR p.year >= ?2) AND (?3 IS NULL OR p.year <= ?3)",
    );
    let mut values: Vec<rusqlite::types::Value> = vec![q.into(), year_from.into(), year_to.into()];
    if !cats.is_empty() {
        let mut parts = vec![];
        for c in cats {
            parts.push(format!("p.primary_category = ?{0} OR p.primary_category LIKE ?{0} || '.%'", values.len() + 1));
            values.push(c.clone().into());
        }
        sql.push_str(&format!(" AND ({})", parts.join(" OR ")));
    }
    // タイトルの一致を抄録より重く見る
    sql.push_str(&format!(" ORDER BY bm25(papers_fts, 4.0, 1.0) LIMIT {}", limit.clamp(1, 200)));
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("{} -- {}", e, sql))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(values.iter()), |r| {
            Ok(Hit {
                id: r.get(0)?,
                title: r.get(1)?,
                authors: r.get(2)?,
                abstract_: r.get(3)?,
                categories: r.get(4)?,
                primary_category: r.get(5)?,
                doi: r.get(6)?,
                journal_ref: r.get(7)?,
                year: r.get(8)?,
                first_date: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---- 中身 ----

fn build(parquet: &Path, dest: &Path, cats: &[String], on_progress: &dyn Fn(Progress)) -> Result<IndexStats, String> {
    let file = std::fs::File::open(parquet).map_err(|e| format!("{}: {}", parquet.display(), e))?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).map_err(|e| format!("Parquet を開けません: {}", e))?;
    let total = builder.metadata().file_metadata().num_rows().max(0) as u64;
    let mask = {
        let schema = builder.parquet_schema();
        let mut leaves = vec![];
        for name in COLUMNS {
            let idx = schema
                .columns()
                .iter()
                .position(|c| c.name() == name)
                .ok_or_else(|| format!("Parquet に列 {} がありません。metadata config のファイルですか?", name))?;
            leaves.push(idx);
        }
        ProjectionMask::leaves(schema, leaves)
    };
    let reader = builder
        .with_projection(mask)
        .with_batch_size(4096)
        .build()
        .map_err(|e| e.to_string())?;

    let tmp = PathBuf::from(format!("{}.tmp", dest.display()));
    let _ = std::fs::remove_file(&tmp);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut conn = Connection::open(&tmp).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-200000;")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;

    let mut done: u64 = 0;
    let mut kept: u64 = 0;
    for batch in reader {
        let batch = batch.map_err(|e| format!("Parquet の読み込みに失敗: {}", e))?;
        let col = |name: &str| -> Result<arrow::array::ArrayRef, String> {
            let i = batch.schema().index_of(name).map_err(|e| e.to_string())?;
            Ok(batch.column(i).clone())
        };
        let texts: Vec<StringArray> = COLUMNS[..8].iter().map(|n| col(n).and_then(as_strings)).collect::<Result<_, _>>()?;
        let first = as_dates(col("first_version_date")?)?;
        let latest = as_dates(col("latest_version_date")?)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut ins = tx
                .prepare_cached("INSERT OR REPLACE INTO papers(id, title, authors, abstract, categories, primary_category, doi, journal_ref, year, first_date, latest_date) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
                .map_err(|e| e.to_string())?;
            for i in 0..batch.num_rows() {
                let categories = value(&texts[4], i).unwrap_or("");
                if !matches_categories(categories, cats) {
                    continue;
                }
                let id = match value(&texts[0], i) {
                    Some(id) if !id.is_empty() => id,
                    _ => continue,
                };
                let first_date = first[i].clone();
                let year = first_date.as_ref().and_then(|d| d[..4].parse::<i64>().ok());
                ins.execute(params![
                    id,
                    squash(value(&texts[1], i).unwrap_or("")),
                    value(&texts[2], i).unwrap_or(""),
                    squash(value(&texts[3], i).unwrap_or("")),
                    categories,
                    value(&texts[5], i).unwrap_or(""),
                    none_if_empty(value(&texts[6], i)),
                    none_if_empty(value(&texts[7], i)),
                    year,
                    first_date,
                    latest[i].clone(),
                ])
                .map_err(|e| e.to_string())?;
                kept += 1;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        done += batch.num_rows() as u64;
        on_progress(Progress { phase: "read".into(), done, total, kept });
    }

    on_progress(Progress { phase: "finish".into(), done, total, kept });
    conn.execute_batch("INSERT INTO papers_fts(papers_fts) VALUES('rebuild'); CREATE INDEX papers_cat ON papers(primary_category, year); CREATE INDEX papers_year ON papers(year);")
        .map_err(|e| e.to_string())?;
    let built_at = now_iso();
    let source = parquet.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    for (k, v) in [("categories", cats.join(" ")), ("built_at", built_at), ("source", source)] {
        conn.execute("INSERT INTO meta(key, value) VALUES(?, ?)", params![k, v]).map_err(|e| e.to_string())?;
    }
    conn.execute_batch("PRAGMA journal_mode=DELETE;").map_err(|e| e.to_string())?;
    drop(conn);
    let _ = std::fs::remove_file(dest);
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    let conn = Connection::open_with_flags(dest, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    stats(&conn, dest)
}

fn stats(conn: &Connection, path: &Path) -> Result<IndexStats, String> {
    let get = |k: &str| -> String { conn.query_row("SELECT value FROM meta WHERE key = ?", [k], |r| r.get::<_, String>(0)).unwrap_or_default() };
    let papers: i64 = conn.query_row("SELECT COUNT(*) FROM papers", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let snapshot: Option<String> = conn.query_row("SELECT MAX(latest_date) FROM papers", [], |r| r.get(0)).unwrap_or(None);
    let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let categories = get("categories").split_whitespace().map(|s| s.to_string()).collect();
    Ok(IndexStats { path: path.to_string_lossy().to_string(), papers: papers.max(0) as u64, categories, built_at: get("built_at"), source: get("source"), snapshot, bytes })
}

fn as_strings(col: arrow::array::ArrayRef) -> Result<StringArray, String> {
    let c = if col.data_type() == &DataType::Utf8 { col } else { arrow::compute::cast(&col, &DataType::Utf8).map_err(|e| e.to_string())? };
    c.as_any().downcast_ref::<StringArray>().cloned().ok_or_else(|| "文字列の列ではありません".to_string())
}

fn as_dates(col: arrow::array::ArrayRef) -> Result<Vec<Option<String>>, String> {
    let c = arrow::compute::cast(&col, &DataType::Timestamp(TimeUnit::Millisecond, None)).map_err(|e| e.to_string())?;
    let a = c.as_any().downcast_ref::<TimestampMillisecondArray>().ok_or_else(|| "日時の列ではありません".to_string())?;
    Ok((0..a.len()).map(|i| if a.is_null(i) { None } else { Some(ymd(a.value(i).div_euclid(86_400_000))) }).collect())
}

fn value<'a>(a: &'a StringArray, i: usize) -> Option<&'a str> {
    if a.is_null(i) {
        None
    } else {
        Some(a.value(i))
    }
}

/// "None" は Parquet 側の欠損の書き方
fn none_if_empty(v: Option<&str>) -> Option<String> {
    match v.map(str::trim) {
        Some("") | Some("None") | None => None,
        Some(s) => Some(s.to_string()),
    }
}

/// arXiv のメタデータは改行と連続空白で折り返されている
fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn normalize_categories(cats: &[String]) -> Vec<String> {
    let mut out: Vec<String> = cats
        .iter()
        .flat_map(|c| c.split(|ch: char| ch == ',' || ch.is_whitespace()))
        .map(|c| c.trim().trim_end_matches('.').to_string())
        .filter(|c| !c.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// categories(空白区切り)のどれかが wanted のどれかに一致するか。"cs" は cs.* 全部、"cs.CL" はそれだけ
pub fn matches_categories(categories: &str, wanted: &[String]) -> bool {
    if wanted.is_empty() {
        return true;
    }
    categories.split_whitespace().any(|c| {
        wanted.iter().any(|w| {
            c.eq_ignore_ascii_case(w) || (c.len() > w.len() && c.as_bytes()[w.len()] == b'.' && c[..w.len()].eq_ignore_ascii_case(w))
        })
    })
}

/// FTS5 の MATCH 式。語ごとに引用符で囲むので、演算子や記号が混ざっても構文エラーにならない
pub fn fts_query(query: &str, mode: &str) -> String {
    let words: Vec<String> = query
        .split(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_' || c == '\''))
        .map(|w| w.trim_matches(|c: char| c == '-' || c == '_' || c == '\''))
        .filter(|w| w.chars().count() >= 2)
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect();
    words.join(if mode == "any" { " OR " } else { " AND " })
}

/// 1970-01-01 からの日数 → YYYY-MM-DD
fn ymd(days: i64) -> String {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    format!("{}T{:02}:{:02}:{:02}Z", ymd(secs.div_euclid(86_400)), secs.rem_euclid(86_400) / 3600, secs.rem_euclid(3600) / 60, secs.rem_euclid(60))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories() {
        let w = normalize_categories(&["cs.CL, stat.".into(), " cs.CL".into()]);
        assert_eq!(w, vec!["cs.CL".to_string(), "stat".to_string()]);
        assert!(matches_categories("hep-ph cs.CL", &w));
        assert!(matches_categories("stat.ML", &w));
        assert!(!matches_categories("cs.CV math.ST", &w));
        assert!(!matches_categories("statistics", &w));
        assert!(matches_categories("anything", &[]));
    }

    #[test]
    fn query() {
        assert_eq!(fts_query("retrieval-augmented generation (RAG) \"eval\"", "all"), "\"retrieval-augmented\" AND \"generation\" AND \"RAG\" AND \"eval\"");
        assert_eq!(fts_query("a OR b", "any"), "\"OR\"");
        assert_eq!(fts_query("", "all"), "");
    }

    /// 本物と同じ列構成の小さな Parquet で、索引の作成と検索を通す。ODOP_TEST_PARQUET にパスを入れて実行する
    #[test]
    fn builds_and_searches_from_parquet() {
        let Ok(parquet) = std::env::var("ODOP_TEST_PARQUET") else { return };
        let dest = std::env::temp_dir().join(format!("odop-arxiv-index-{}.sqlite", std::process::id()));
        let seen = std::cell::RefCell::new(vec![]);
        let stats = build(Path::new(&parquet), &dest, &["cs".to_string()], &|p| seen.borrow_mut().push(p.phase.clone())).expect("build");
        assert_eq!(stats.papers, 3, "hep-ph が除かれて cs.* だけ");
        assert_eq!(stats.categories, vec!["cs".to_string()]);
        assert_eq!(stats.snapshot.as_deref(), Some("2023-03-01"));
        assert!(seen.borrow().contains(&"read".to_string()) && seen.borrow().last() == Some(&"finish".to_string()));
        assert_eq!(arxiv_index_stats(dest.to_string_lossy().to_string()).unwrap().unwrap().papers, 3);

        let all = search(&dest, "retrieval augmented generation", "all", &[], None, None, 10).expect("search");
        assert_eq!(all.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["2301.00001"]);
        assert_eq!(all[0].abstract_, "We explore retrieval augmented generation (RAG) models.", "改行が畳まれる");
        assert_eq!(all[0].year, Some(2023));
        assert_eq!(all[0].first_date.as_deref(), Some("2023-01-02"));
        assert_eq!(all[0].doi, None, "\"None\" は欠損");

        let any = search(&dest, "retrieval augmented generation", "any", &[], None, None, 10).expect("search");
        assert_eq!(any.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["2301.00001", "2301.00004"], "タイトルの一致が先");
        let by_cat = search(&dest, "retrieval", "any", &["cs.IR".to_string()], None, None, 10).expect("search");
        assert_eq!(by_cat.len(), 1);
        assert_eq!(by_cat[0].id, "2301.00004");
        let by_year = search(&dest, "diffusion retrieval", "any", &[], Some(2022), None, 10).expect("search");
        assert!(!by_year.is_empty() && by_year.iter().all(|h| h.year >= Some(2022)));
        assert!(search(&dest, "a OR b", "all", &[], None, None, 10).expect("search").is_empty(), "演算子を語として扱っても壊れない");
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn dates() {
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(11_778), "2002-04-01");
        assert_eq!(ymd(11_016), "2000-02-29");
        assert_eq!(ymd(20_692), "2026-08-27");
        assert_eq!(ymd(-1), "1969-12-31");
    }
}
