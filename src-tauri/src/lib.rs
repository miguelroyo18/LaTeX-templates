// This is the Tauri v2 entry point. `npm create tauri-app` generates a
// src-tauri/src/lib.rs for you — merge the marked pieces below into it.

mod commands; // <-- add this

use std::fs;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use commands::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Put the database in the OS app-data dir, e.g.
            //   macOS:   ~/Library/Application Support/<bundle-id>/
            //   Windows: %APPDATA%\<bundle-id>\
            //   Linux:   ~/.local/share/<bundle-id>/
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let conn = Connection::open(dir.join("purchases.db"))?;

            // Create tables / indexes / pragmas on first run.
            conn.execute_batch(include_str!("schema.sql"))?;

            // Migration: add `detail` to databases created before it existed.
            let has_detail: bool = conn
                .prepare("SELECT 1 FROM pragma_table_info('purchases') WHERE name = 'detail'")?
                .exists([])?;
            if !has_detail {
                conn.execute(
                    "ALTER TABLE purchases ADD COLUMN detail TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }

            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_purchase,
            commands::list_month,
            commands::list_months,
            commands::update_purchase,
            commands::delete_purchase,
            commands::list_attachments,
            commands::export_attachment,
            commands::query_purchases,
            commands::list_attachment_meta,
            commands::add_attachments,
            commands::delete_attachment,
            commands::monthly_summary,
            commands::export_data,
            commands::import_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
