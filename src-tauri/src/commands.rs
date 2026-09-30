// All SQLite access lives here on the Rust side. The frontend never touches the
// database directly — it calls these #[tauri::command] functions via invoke().

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
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

/// Insert a purchase, its receipts and its list memberships in ONE transaction,
/// so a row and its attachments are never half-written.
#[tauri::command]
pub fn add_purchase(
    db: State<'_, Db>,
    date: String,
    concept: String,
    detail: String,
    amount_cents: i64,
    receipts: Vec<ReceiptInput>,
    list_ids: Vec<i64>,
) -> Result<i64, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO purchases (date, concept, detail, amount_cents, seq) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(seq), 0) + 1 FROM purchases))",
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

    for list_id in list_ids {
        tx.execute(
            "INSERT OR IGNORE INTO list_items (list_id, purchase_id) VALUES (?1, ?2)",
            params![list_id, purchase_id],
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
                    SUM(p.amount_cents) OVER (ORDER BY p.date, p.seq, p.id) AS running_cents,
                    (SELECT COUNT(*) FROM attachments a WHERE a.purchase_id = p.id) AS receipt_count
             FROM purchases p
             WHERE substr(p.date, 1, 7) = ?1
             ORDER BY p.date, p.seq, p.id",
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
        "UPDATE purchases
            SET seq = CASE WHEN date = ?2 THEN seq ELSE (SELECT COALESCE(MAX(seq), 0) + 1 FROM purchases) END,
                date = ?2, concept = ?3, detail = ?4, amount_cents = ?5
          WHERE id = ?1",
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
                    SUM(p.amount_cents) OVER (ORDER BY p.date, p.seq, p.id) AS running_cents,
                    (SELECT COUNT(*) FROM attachments a WHERE a.purchase_id = p.id) AS receipt_count
             FROM purchases p
             WHERE (?1 IS NULL OR p.date >= ?1)
               AND (?2 IS NULL OR p.date <= ?2)
               AND (?3 IS NULL OR p.concept LIKE ?3 OR p.detail LIKE ?3)
             ORDER BY p.date, p.seq, p.id",
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

/// A list in the export. `purchases` are positions in `ExportFile::purchases`,
/// so the file doesn't depend on database ids.
#[derive(Serialize, Deserialize)]
pub struct ExportList {
    pub name: String,
    pub purchases: Vec<usize>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportFile {
    pub version: u32,
    pub exported_at: String,
    pub purchases: Vec<ExportPurchase>,
    #[serde(default)] // version-1 files have no lists
    pub lists: Vec<ExportList>,
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
            .prepare("SELECT id, date, concept, detail, amount_cents FROM purchases ORDER BY date, seq, id")
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
    let mut index_of: HashMap<i64, usize> = HashMap::new(); // purchase id -> position
    for (id, date, concept, detail, cents) in purchases_raw {
        index_of.insert(id, purchases.len());
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

    // pass 3: lists, pointing at purchases by position
    let lists_raw: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, name FROM lists ORDER BY name COLLATE NOCASE")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let mut istmt = conn
        .prepare("SELECT purchase_id FROM list_items WHERE list_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut lists = Vec::with_capacity(lists_raw.len());
    for (list_id, name) in lists_raw {
        let ids = istmt
            .query_map(params![list_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut positions: Vec<usize> =
            ids.iter().filter_map(|id| index_of.get(id).copied()).collect();
        positions.sort_unstable();
        lists.push(ExportList {
            name,
            purchases: positions,
        });
    }

    let file = ExportFile {
        version: 2,
        exported_at,
        purchases,
        lists,
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
    let mut new_ids: Vec<i64> = Vec::with_capacity(parsed.purchases.len());
    for p in parsed.purchases {
        tx.execute(
            "INSERT INTO purchases (date, concept, detail, amount_cents, seq) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(seq), 0) + 1 FROM purchases))",
            params![p.date, p.concept, p.detail, p.amount_cents],
        )
        .map_err(|e| e.to_string())?;
        let pid = tx.last_insert_rowid();
        new_ids.push(pid);
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

    // Lists merge by name: an existing list with the same name gets the items.
    for l in parsed.lists {
        let name = l.name.trim();
        if name.is_empty() {
            continue;
        }
        let existing: Option<i64> = tx
            .query_row("SELECT id FROM lists WHERE name = ?1", params![name], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let list_id = match existing {
            Some(id) => id,
            None => {
                tx.execute("INSERT INTO lists (name) VALUES (?1)", params![name])
                    .map_err(|e| e.to_string())?;
                tx.last_insert_rowid()
            }
        };
        for pos in l.purchases {
            if let Some(pid) = new_ids.get(pos) {
                tx.execute(
                    "INSERT OR IGNORE INTO list_items (list_id, purchase_id) VALUES (?1, ?2)",
                    params![list_id, pid],
                )
                .map_err(|e| e.to_string())?;
            }
        }
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

// ---- listas: agrupar compras de cualquier mes ----

#[derive(Serialize)]
pub struct ListSummary {
    pub id: i64,
    pub name: String,
    pub count: i64,
    pub total_cents: i64,
}

/// Map a `SELECT id, date, concept, detail, amount_cents, running_cents,
/// receipt_count` row into a PurchaseRow.
fn purchase_row(row: &rusqlite::Row) -> rusqlite::Result<PurchaseRow> {
    Ok(PurchaseRow {
        id: row.get(0)?,
        date: row.get(1)?,
        concept: row.get(2)?,
        detail: row.get(3)?,
        amount_cents: row.get(4)?,
        running_cents: row.get(5)?,
        receipt_count: row.get(6)?,
    })
}

/// Trim a list name and reject empty ones.
fn clean_list_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("Ponle un nombre a la lista.".into());
    }
    Ok(n.to_string())
}

/// Turn a UNIQUE violation on lists.name into a readable message.
fn list_name_error(e: rusqlite::Error) -> String {
    match e {
        rusqlite::Error::SqliteFailure(ref f, _)
            if f.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            "Ya existe una lista con ese nombre.".into()
        }
        other => other.to_string(),
    }
}

/// All lists with how many purchases they hold and their total, by name.
#[tauri::command]
pub fn list_lists(db: State<'_, Db>) -> Result<Vec<ListSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.name, COUNT(p.id), COALESCE(SUM(p.amount_cents), 0)
             FROM lists l
             LEFT JOIN list_items li ON li.list_id = l.id
             LEFT JOIN purchases p ON p.id = li.purchase_id
             GROUP BY l.id
             ORDER BY l.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ListSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
                total_cents: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Create an empty list. Returns its id.
#[tauri::command]
pub fn create_list(db: State<'_, Db>, name: String) -> Result<i64, String> {
    let name = clean_list_name(&name)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO lists (name) VALUES (?1)", params![name])
        .map_err(list_name_error)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn rename_list(db: State<'_, Db>, id: i64, name: String) -> Result<(), String> {
    let name = clean_list_name(&name)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE lists SET name = ?2 WHERE id = ?1", params![id, name])
        .map_err(list_name_error)?;
    Ok(())
}

/// Delete a list. Its purchases stay; only the membership rows go (CASCADE).
#[tauri::command]
pub fn delete_list(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM lists WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The purchases in a list, by date, with a running total within the list.
#[tauri::command]
pub fn purchases_in_list(db: State<'_, Db>, list_id: i64) -> Result<Vec<PurchaseRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.date, p.concept, p.detail, p.amount_cents,
                    SUM(p.amount_cents) OVER (ORDER BY p.date, p.seq, p.id) AS running_cents,
                    (SELECT COUNT(*) FROM attachments a WHERE a.purchase_id = p.id) AS receipt_count
             FROM list_items li
             JOIN purchases p ON p.id = li.purchase_id
             WHERE li.list_id = ?1
             ORDER BY p.date, p.seq, p.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![list_id], purchase_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Add purchases to a list. Ones already in it are skipped. Returns how many
/// were actually added.
#[tauri::command]
pub fn add_to_list(
    db: State<'_, Db>,
    list_id: i64,
    purchase_ids: Vec<i64>,
) -> Result<usize, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut added = 0usize;
    for pid in purchase_ids {
        added += tx
            .execute(
                "INSERT OR IGNORE INTO list_items (list_id, purchase_id) VALUES (?1, ?2)",
                params![list_id, pid],
            )
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(added)
}

/// Take purchases out of a list (the purchases themselves are kept).
#[tauri::command]
pub fn remove_from_list(
    db: State<'_, Db>,
    list_id: i64,
    purchase_ids: Vec<i64>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for pid in purchase_ids {
        tx.execute(
            "DELETE FROM list_items WHERE list_id = ?1 AND purchase_id = ?2",
            params![list_id, pid],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Ids of the lists a purchase belongs to (for the edit dialog).
#[tauri::command]
pub fn lists_of_purchase(db: State<'_, Db>, purchase_id: i64) -> Result<Vec<i64>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT list_id FROM list_items WHERE purchase_id = ?1")
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map(params![purchase_id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
}

/// Make a purchase belong to exactly these lists: removes it from the others
/// and adds it to the new ones, keeping existing memberships untouched.
#[tauri::command]
pub fn set_purchase_lists(
    db: State<'_, Db>,
    purchase_id: i64,
    list_ids: Vec<i64>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT list_id FROM list_items WHERE purchase_id = ?1")
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map(params![purchase_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        ids
    };
    for old in current.iter().filter(|id| !list_ids.contains(id)) {
        tx.execute(
            "DELETE FROM list_items WHERE list_id = ?1 AND purchase_id = ?2",
            params![old, purchase_id],
        )
        .map_err(|e| e.to_string())?;
    }
    for new in list_ids.iter().filter(|id| !current.contains(id)) {
        tx.execute(
            "INSERT OR IGNORE INTO list_items (list_id, purchase_id) VALUES (?1, ?2)",
            params![new, purchase_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---- orden dentro del mismo día ----

/// Reorder the purchases of one day. `ids` is the new order of the rows the
/// user sees for that day — possibly only some of them, when a search is
/// active. Those rows are shuffled among the slots they already occupy, so
/// hidden rows of the same day keep their place.
#[tauri::command]
pub fn reorder_day(db: State<'_, Db>, date: String, ids: Vec<i64>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let day: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT id FROM purchases WHERE date = ?1 ORDER BY seq, id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![date], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    if ids.iter().any(|id| !day.contains(id)) {
        return Err("Solo se pueden ordenar compras del mismo día.".into());
    }

    // Walk the day in its current order; each slot held by a moved row gets
    // the next id from the new order, the rest stay put.
    let mut moved = ids.iter();
    let new_order: Vec<i64> = day
        .iter()
        .map(|id| {
            if ids.contains(id) {
                *moved.next().unwrap_or(id)
            } else {
                *id
            }
        })
        .collect();

    for (i, id) in new_order.iter().enumerate() {
        tx.execute(
            "UPDATE purchases SET seq = ?1 WHERE id = ?2",
            params![i as i64 + 1, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
