// Rust 側は OS 依存の部分だけ(仕様 3): ファイル、SQLite、キーチェーン、PDF、通知、トレイ

mod db;
mod fs;
mod pdf;
mod secret;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(db::DbState::default())
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
        })
        .invoke_handler(tauri::generate_handler![
            fs::default_data_dir,
            fs::read_text,
            fs::write_text,
            fs::path_exists,
            fs::list_dir,
            fs::mkdir_all,
            fs::remove_file,
            db::db_open,
            db::db_execute,
            db::db_query,
            secret::secret_get,
            secret::secret_set,
            secret::secret_delete,
            pdf::download_file,
            pdf::extract_pdf_text,
            tray::show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
