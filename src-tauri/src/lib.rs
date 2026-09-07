// Rust 側は OS 依存の部分だけ(仕様 3): ファイル、SQLite、キーチェーン

mod db;
mod fs;
mod secret;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(db::DbState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
