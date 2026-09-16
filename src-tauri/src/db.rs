use rusqlite::{types::ValueRef, Connection};
use serde_json::{Map, Value};
use std::sync::Mutex;

#[derive(Default)]
pub struct DbState(pub Mutex<Option<Connection>>);

fn to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                V::Integer(i)
            } else {
                V::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => V::Text(s.clone()),
        other => V::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => Value::String(format!("<blob {} bytes>", b.len())),
    }
}

#[tauri::command]
pub fn db_open(state: tauri::State<DbState>, path: String) -> Result<(), String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(conn);
    Ok(())
}

/// 取り込みで state.sqlite を差し替える前に呼ぶ。最後の接続が閉じるので WAL も本体に書き戻される
#[tauri::command]
pub fn db_close(state: tauri::State<DbState>) -> Result<(), String> {
    if let Some(conn) = state.0.lock().unwrap().take() {
        conn.close().map_err(|(_, e)| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn db_execute(state: tauri::State<DbState>, sql: String, params: Vec<Value>) -> Result<usize, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("db not open")?;
    let p: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    if p.is_empty() && sql.contains(';') {
        conn.execute_batch(&sql).map_err(|e| e.to_string())?;
        return Ok(0);
    }
    conn.execute(&sql, rusqlite::params_from_iter(p.iter()))
        .map_err(|e| format!("{} -- {}", e, sql))
}

#[tauri::command]
pub fn db_query(state: tauri::State<DbState>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("db not open")?;
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("{} -- {}", e, sql))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let p: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(p.iter()), |row| {
            let mut m = Map::new();
            for (i, name) in names.iter().enumerate() {
                m.insert(name.clone(), from_sql(row.get_ref(i)?));
            }
            Ok(m)
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
