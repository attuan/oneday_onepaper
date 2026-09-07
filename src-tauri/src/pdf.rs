// OA の PDF を保存し、本文テキストを抜く(仕様 7.3)

use std::path::PathBuf;

fn expand(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

#[tauri::command]
pub async fn download_file(url: String, dest: String) -> Result<u64, String> {
    let client = tauri_plugin_http::reqwest::Client::builder()
        .user_agent("OneDayOnePaper/0.1 (personal research tool)")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"%PDF") && !ct.contains("pdf") {
        return Err(format!("PDF ではありませんでした (content-type: {})", ct));
    }
    let p = expand(&dest);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

#[tauri::command]
pub async fn extract_pdf_text(path: String) -> Result<String, String> {
    let p = expand(&path);
    // pdf-extract は壊れた PDF で panic することがあるので別スレッドで受け止める
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::panic::catch_unwind(|| pdf_extract::extract_text(&p))
    })
    .await
    .map_err(|e| e.to_string())?;
    match result {
        Ok(Ok(text)) => Ok(normalize(&text)),
        Ok(Err(e)) => Err(format!("PDF の解析に失敗: {}", e)),
        Err(_) => Err("PDF の解析中にエラーが発生しました".into()),
    }
}

fn normalize(text: &str) -> String {
    // 連続する空行と行末の空白を詰める
    let mut out = String::with_capacity(text.len());
    let mut blank = 0;
    for line in text.lines() {
        let t = line.trim_end();
        if t.is_empty() {
            blank += 1;
            if blank <= 1 {
                out.push('\n');
            }
        } else {
            blank = 0;
            out.push_str(t);
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn extracts_text_from_real_pdf() {
        let Ok(path) = std::env::var("ODOP_TEST_PDF") else { return };
        let text = super::normalize(&pdf_extract::extract_text(&path).expect("extract"));
        assert!(text.contains("Transformer"), "text: {}", &text[..text.len().min(500)]);
        println!("chars={} first={}", text.chars().count(), &text[..text.len().min(200)]);
    }
}
