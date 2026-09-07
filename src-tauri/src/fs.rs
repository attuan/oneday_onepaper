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
