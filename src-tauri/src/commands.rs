// All SQLite access lives here on the Rust side. The frontend never touches the
// database directly — it calls these #[tauri::command] functions via invoke().

use std::path::Path;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

/// Managed application state: a single SQLite connection behind a Mutex.
pub struct Db(pub Mutex<Connection>);

// ---- Shapes sent to / received from the frontend -------------------------

#[derive(Serialize)]
pub struct PurchaseRow {
    pub id: i64,
    pub date: String,
    pub concept: String,
    pub detail: String,
    pub amount_cents: i64,
    pub running_cents: i64, // running total within the month, computed in SQL
    pub receipt_count: i64,
}

#[derive(Deserialize)]
pub struct ReceiptInput {
    pub filename: String,
    pub mime: String,
    pub data_b64: String, // file bytes, base64-encoded for the JS<->Rust bridge
}

#[derive(Serialize)]
pub struct Attachment {
    pub id: i64,
    pub filename: String,
    pub mime: String,
    pub data_b64: String,
}

// ---- Commands ------------------------------------------------------------

/// Insert a purchase and all its receipts in ONE transaction, so a row and its
/// attachments are never half-written.
#[tauri::command]
pub fn add_purchase(
    db: State<'_, Db>,
    date: String,
    concept: String,
    detail: String,
    amount_cents: i64,
    receipts: Vec<ReceiptInput>,
) -> Result<i64, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO purchases (date, concept, detail, amount_cents) VALUES (?1, ?2, ?3, ?4)",
        params![date, concept, detail, amount_cents],
    )
    .map_err(|e| e.to_string())?;
    let purchase_id = tx.last_insert_rowid();

    for r in receipts {
        let bytes = B64.decode(r.data_b64).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO attachments (purchase_id, filename, mime, data) VALUES (?1, ?2, ?3, ?4)",
            params![purchase_id, r.filename, r.mime, bytes],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(purchase_id)
}

/// List one month, ordered by date, with the running total computed in SQL.
/// `month` is 'YYYY-MM'.
#[tauri::command]
pub fn list_month(db: State<'_, Db>, month: String) -> Result<Vec<PurchaseRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.date, p.concept, p.detail, p.amount_cents,
                    SUM(p.amount_cents) OVER (ORDER BY p.date, p.id) AS running_cents,
                    (SELECT COUNT(*) FROM attachments a WHERE a.purchase_id = p.id) AS receipt_count
             FROM purchases p
             WHERE substr(p.date, 1, 7) = ?1
             ORDER BY p.date, p.id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![month], |row| {
            Ok(PurchaseRow {
                id: row.get(0)?,
                date: row.get(1)?,
                concept: row.get(2)?,
                detail: row.get(3)?,
                amount_cents: row.get(4)?,
                running_cents: row.get(5)?,
                receipt_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Distinct months that have data, newest first. Drives the month picker.
#[tauri::command]
pub fn list_months(db: State<'_, Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT substr(date, 1, 7) AS m FROM purchases ORDER BY m DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Edit an existing purchase (used by inline grid editing).
#[tauri::command]
pub fn update_purchase(
    db: State<'_, Db>,
    id: i64,
    date: String,
    concept: String,
    detail: String,
    amount_cents: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE purchases SET date = ?2, concept = ?3, detail = ?4, amount_cents = ?5 WHERE id = ?1",
        params![id, date, concept, detail, amount_cents],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a purchase. Attachments go with it (ON DELETE CASCADE).
#[tauri::command]
pub fn delete_purchase(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM purchases WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetch the receipts for one purchase (for viewing / opening).
#[tauri::command]
pub fn list_attachments(db: State<'_, Db>, purchase_id: i64) -> Result<Vec<Attachment>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, filename, mime, data FROM attachments WHERE purchase_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![purchase_id], |row| {
            let bytes: Vec<u8> = row.get(3)?;
            Ok(Attachment {
                id: row.get(0)?,
                filename: row.get(1)?,
                mime: row.get(2)?,
                data_b64: B64.encode(bytes),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Save a receipt to the user's Downloads folder. Returns the saved path.
/// Uses the core path API + std::fs, so no extra Tauri plugins are needed.
#[tauri::command]
pub fn export_attachment(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    attachment_id: i64,
) -> Result<String, String> {
    let (filename, bytes): (String, Vec<u8>) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT filename, data FROM attachments WHERE id = ?1",
            params![attachment_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?
    };

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .or_else(|_| app.path().home_dir())
        .map_err(|e| format!("No se encontró una carpeta de destino: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Don't clobber an existing file: "recibo.pdf" -> "recibo (1).pdf"
    let p = Path::new(&filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("recibo");
    let ext = p.extension().and_then(|s| s.to_str());
    let mut dest = dir.join(&filename);
    let mut i = 1;
    while dest.exists() {
        let name = match ext {
            Some(e) => format!("{stem} ({i}).{e}"),
            None => format!("{stem} ({i})"),
        };
        dest = dir.join(name);
        i += 1;
    }

    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Flexible query: optional date range (from/to, inclusive, 'YYYY-MM-DD') and an
/// optional concept search. The running total accumulates over the result set.
/// Any of the three filters can be null (= no constraint).
#[tauri::command]
pub fn query_purchases(
    db: State<'_, Db>,
    from: Option<String>,
    to: Option<String>,
    search: Option<String>,
) -> Result<Vec<PurchaseRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let like = search
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("%{}%", s.trim()));

    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.date, p.concept, p.detail, p.amount_cents,
                    SUM(p.amount_cents) OVER (ORDER BY p.date, p.id) AS running_cents,
                    (SELECT COUNT(*) FROM attachments a WHERE a.purchase_id = p.id) AS receipt_count
             FROM purchases p
             WHERE (?1 IS NULL OR p.date >= ?1)
               AND (?2 IS NULL OR p.date <= ?2)
               AND (?3 IS NULL OR p.concept LIKE ?3 OR p.detail LIKE ?3)
             ORDER BY p.date, p.id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![from, to, like], |row| {
            Ok(PurchaseRow {
                id: row.get(0)?,
                date: row.get(1)?,
                concept: row.get(2)?,
                detail: row.get(3)?,
                amount_cents: row.get(4)?,
                running_cents: row.get(5)?,
                receipt_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[derive(Serialize)]
pub struct AttachmentMeta {
    pub id: i64,
    pub filename: String,
    pub mime: String,
}

/// Lightweight list of a purchase's receipts (no bytes) — for the edit dialog.
#[tauri::command]
pub fn list_attachment_meta(
    db: State<'_, Db>,
    purchase_id: i64,
) -> Result<Vec<AttachmentMeta>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, filename, mime FROM attachments WHERE purchase_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![purchase_id], |row| {
            Ok(AttachmentMeta {
                id: row.get(0)?,
                filename: row.get(1)?,
                mime: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Add one or more receipts to an existing purchase.
#[tauri::command]
pub fn add_attachments(
    db: State<'_, Db>,
    purchase_id: i64,
    receipts: Vec<ReceiptInput>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for r in receipts {
        let bytes = B64.decode(r.data_b64).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO attachments (purchase_id, filename, mime, data) VALUES (?1, ?2, ?3, ?4)",
            params![purchase_id, r.filename, r.mime, bytes],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove a single receipt.
#[tauri::command]
pub fn delete_attachment(db: State<'_, Db>, attachment_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM attachments WHERE id = ?1", params![attachment_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct MonthSummary {
    pub month: String, // 'YYYY-MM'
    pub total_cents: i64,
    pub count: i64,
}

/// Totals grouped by month, newest first. Drives the "by months" view.
#[tauri::command]
pub fn monthly_summary(db: State<'_, Db>) -> Result<Vec<MonthSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT substr(date, 1, 7) AS month,
                    SUM(amount_cents) AS total_cents,
                    COUNT(*) AS cnt
             FROM purchases
             GROUP BY month
             ORDER BY month DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(MonthSummary {
                month: row.get(0)?,
                total_cents: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ---- Exportar / importar (incluye los recibos en base64) ----

#[derive(Serialize, Deserialize)]
pub struct ExportAttachment {
    pub filename: String,
    pub mime: String,
    pub data_b64: String,
}

#[derive(Serialize, Deserialize)]
pub struct ExportPurchase {
    pub date: String,
    pub concept: String,
    #[serde(default)]
    pub detail: String,
    pub amount_cents: i64,
    pub attachments: Vec<ExportAttachment>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportFile {
    pub version: u32,
    pub exported_at: String,
    pub purchases: Vec<ExportPurchase>,
}

/// Export everything (purchases + receipts) to a JSON file in Downloads.
/// Returns the saved path.
#[tauri::command]
pub fn export_data(app: tauri::AppHandle, db: State<'_, Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let (stamp, exported_at): (String, String) = conn
        .query_row(
            "SELECT strftime('%Y-%m-%d-%H%M%S','now','localtime'), datetime('now','localtime')",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // pass 1: purchases (collected so the statement is freed before the next query)
    let purchases_raw: Vec<(i64, String, String, String, i64)> = {
        let mut stmt = conn
            .prepare("SELECT id, date, concept, detail, amount_cents FROM purchases ORDER BY date, id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    // pass 2: receipts per purchase
    let mut astmt = conn
        .prepare("SELECT filename, mime, data FROM attachments WHERE purchase_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;

    let mut purchases = Vec::with_capacity(purchases_raw.len());
    for (id, date, concept, detail, cents) in purchases_raw {
        let attachments = astmt
            .query_map(params![id], |r| {
                let bytes: Vec<u8> = r.get(2)?;
                Ok(ExportAttachment {
                    filename: r.get(0)?,
                    mime: r.get(1)?,
                    data_b64: B64.encode(bytes),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        purchases.push(ExportPurchase {
            date,
            concept,
            detail,
            amount_cents: cents,
            attachments,
        });
    }

    let file = ExportFile {
        version: 1,
        exported_at,
        purchases,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("gastos-{stamp}.json"));
    std::fs::write(&dest, json).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Import purchases + receipts from a JSON export. Appends to existing data.
/// Returns how many purchases were imported.
#[tauri::command]
pub fn import_data(db: State<'_, Db>, json: String) -> Result<usize, String> {
    let parsed: ExportFile =
        serde_json::from_str(&json).map_err(|_| "El archivo no es un export válido".to_string())?;

    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut count = 0usize;
    for p in parsed.purchases {
        tx.execute(
            "INSERT INTO purchases (date, concept, detail, amount_cents) VALUES (?1, ?2, ?3, ?4)",
            params![p.date, p.concept, p.detail, p.amount_cents],
        )
        .map_err(|e| e.to_string())?;
        let pid = tx.last_insert_rowid();
        for a in p.attachments {
            let bytes = B64.decode(a.data_b64).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO attachments (purchase_id, filename, mime, data) VALUES (?1, ?2, ?3, ?4)",
                params![pid, a.filename, a.mime, bytes],
            )
            .map_err(|e| e.to_string())?;
        }
        count += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

/// Save arbitrary bytes (base64) to the Downloads folder. Used for the PDF
/// report generated in the frontend. Returns the saved path.
#[tauri::command]
pub fn save_download(
    app: tauri::AppHandle,
    filename: String,
    data_b64: String,
) -> Result<String, String> {
    let bytes = B64.decode(data_b64).map_err(|e| e.to_string())?;

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // keep only the file name, never a path the caller might have injected
    let safe = Path::new(&filename)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export.pdf".to_string());

    let dest = dir.join(safe);
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

// ---- color por concepto (para los gráficos) ----

#[derive(Serialize, Deserialize)]
pub struct ConceptColor {
    pub concept: String,
    pub color: String,
}

#[tauri::command]
pub fn list_concept_colors(db: State<'_, Db>) -> Result<Vec<ConceptColor>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT concept, color FROM concept_colors")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ConceptColor {
                concept: r.get(0)?,
                color: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Set (or clear, when `color` is empty) the color for a concept.
#[tauri::command]
pub fn set_concept_color(
    db: State<'_, Db>,
    concept: String,
    color: String,
) -> Result<(), String> {
    let c = concept.trim();
    if c.is_empty() {
        return Ok(());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if color.is_empty() {
        conn.execute("DELETE FROM concept_colors WHERE concept = ?1", params![c])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO concept_colors (concept, color) VALUES (?1, ?2)
             ON CONFLICT(concept) DO UPDATE SET color = excluded.color",
            params![c, color],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
