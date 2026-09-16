// Rust 側は OS 依存の部分だけ(仕様 3): ファイル、SQLite、キーチェーン、PDF、通知、トレイ
//
// モバイル(iOS / Android)ではトレイと「閉じても隠す」が無いので、その 2 つだけ desktop に限定する。
// コマンドは共通。

mod db;
mod fs;
mod pdf;
mod secret;
#[cfg(desktop)]
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(db::DbState::default());

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 閉じても終了せず隠す(仕様 10.4: 常駐して通知を出す)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        });

    builder
        .invoke_handler(tauri::generate_handler![
            fs::default_data_dir,
            fs::read_text,
            fs::write_text,
            fs::read_binary,
            fs::write_binary,
            fs::path_exists,
            fs::list_dir,
            fs::mkdir_all,
            fs::remove_file,
            db::db_open,
            db::db_close,
            db::db_execute,
            db::db_query,
            secret::secret_get,
            secret::secret_set,
            secret::secret_delete,
            pdf::download_file,
            pdf::extract_pdf_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
