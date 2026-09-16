use std::path::{Path, PathBuf};

fn expand(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

#[tauri::command]
pub fn default_data_dir() -> String {
    let base = dirs::document_dir().or_else(dirs::home_dir).unwrap_or_else(|| PathBuf::from("."));
    base.join("OneDayOnePaper").to_string_lossy().to_string()
}

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(expand(&path)).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub fn write_text(path: String, content: String) -> Result<(), String> {
    let p = expand(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // 途中で落ちても壊れないように一時ファイル経由
    let tmp = PathBuf::from(format!("{}.tmp", p.display()));
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// バイナリ(state.sqlite・PDF)をそのまま返す。JSON を経由しないので ArrayBuffer で届く
#[tauri::command]
pub fn read_binary(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(expand(&path)).map_err(|e| format!("{}: {}", path, e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 本文を生バイトで受け取り、パスは x-path ヘッダ(encodeURIComponent 済み)で受け取る
#[tauri::command]
pub fn write_binary(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("本文がバイナリではありません".into());
    };
    let raw = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("x-path ヘッダがありません")?;
    let p = expand(&percent_decode(raw)?);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", p.display()));
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3).ok_or("x-path の % エスケープが不正です")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "x-path の % エスケープが不正です")?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "x-path が UTF-8 ではありません".into())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::exists(&expand(&path))
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<String>, String> {
    let p = expand(&path);
    if !p.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(p).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_file() {
            out.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn mkdir_all(path: String) -> Result<(), String> {
    std::fs::create_dir_all(expand(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_file(path: String) -> Result<(), String> {
    std::fs::remove_file(expand(&path)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_encode_uri_component() {
        // JS の encodeURIComponent("/Users/a/ダウンロード/One Day.zip")
        let s = "%2FUsers%2Fa%2F%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%2FOne%20Day.zip";
        assert_eq!(percent_decode(s).unwrap(), "/Users/a/ダウンロード/One Day.zip");
        assert_eq!(percent_decode("plain-name_1.pdf").unwrap(), "plain-name_1.pdf");
    }

    #[test]
    fn rejects_broken_escapes() {
        assert!(percent_decode("%").is_err());
        assert!(percent_decode("%2").is_err());
        assert!(percent_decode("%zz").is_err());
        assert!(percent_decode("%FF").is_err()); // UTF-8 でない
    }
}
