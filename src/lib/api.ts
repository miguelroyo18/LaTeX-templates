import { invoke } from "@tauri-apps/api/core";

// ---- Types (mirror the Rust structs) -------------------------------------

export interface PurchaseRow {
  id: number;
  date: string; // 'YYYY-MM-DD'
  concept: string;
  detail: string;
  amount_cents: number;
  running_cents: number;
  receipt_count: number;
}

export interface ReceiptInput {
  filename: string;
  mime: string;
  data_b64: string;
}

export interface Attachment {
  id: number;
  filename: string;
  mime: string;
  data_b64: string;
}

// ---- Command wrappers ----------------------------------------------------

export const addPurchase = (
  date: string,
  concept: string,
  detail: string,
  amount_cents: number,
  receipts: ReceiptInput[],
  list_ids: number[] = [],
) =>
  invoke<number>("add_purchase", {
    date,
    concept,
    detail,
    amountCents: amount_cents,
    receipts,
    listIds: list_ids,
  });

export const listMonth = (month: string) =>
  invoke<PurchaseRow[]>("list_month", { month });

export const queryPurchases = (
  from: string | null,
  to: string | null,
  search: string | null,
) => invoke<PurchaseRow[]>("query_purchases", { from, to, search });

export interface MonthSummary {
  month: string; // 'YYYY-MM'
  total_cents: number;
  count: number;
}

export const monthlySummary = () => invoke<MonthSummary[]>("monthly_summary");

export const exportData = () => invoke<string>("export_data"); // devuelve la ruta
export const importData = (json: string) => invoke<number>("import_data", { json });

// Guarda bytes (en base64) en Descargas; usado por el informe PDF.
export const saveDownload = (filename: string, dataB64: string) =>
  invoke<string>("save_download", { filename, dataB64 });

export interface ConceptColor {
  concept: string;
  color: string;
}
export const listConceptColors = () =>
  invoke<ConceptColor[]>("list_concept_colors");
// color vacío ("") borra el color del concepto (vuelve al verde por defecto)
export const setConceptColor = (concept: string, color: string) =>
  invoke<void>("set_concept_color", { concept, color });

export const listMonths = () => invoke<string[]>("list_months");

export const updatePurchase = (
  id: number,
  date: string,
  concept: string,
  detail: string,
  amount_cents: number,
) =>
  invoke<void>("update_purchase", {
    id,
    date,
    concept,
    detail,
    amountCents: amount_cents,
  });

export const deletePurchase = (id: number) =>
  invoke<void>("delete_purchase", { id });

export const listAttachments = (purchase_id: number) =>
  invoke<Attachment[]>("list_attachments", { purchaseId: purchase_id });

export const exportAttachment = (attachment_id: number) =>
  invoke<string>("export_attachment", { attachmentId: attachment_id });

export interface AttachmentMeta {
  id: number;
  filename: string;
  mime: string;
}

export const listAttachmentMeta = (purchase_id: number) =>
  invoke<AttachmentMeta[]>("list_attachment_meta", { purchaseId: purchase_id });

export const addAttachments = (purchase_id: number, receipts: ReceiptInput[]) =>
  invoke<void>("add_attachments", { purchaseId: purchase_id, receipts });

export const deleteAttachment = (attachment_id: number) =>
  invoke<void>("delete_attachment", { attachmentId: attachment_id });

// ---- Listas ---------------------------------------------------------------

export interface ListSummary {
  id: number;
  name: string;
  count: number;
  total_cents: number;
}

export const listLists = () => invoke<ListSummary[]>("list_lists");
export const createList = (name: string) => invoke<number>("create_list", { name });
export const renameList = (id: number, name: string) =>
  invoke<void>("rename_list", { id, name });
export const deleteList = (id: number) => invoke<void>("delete_list", { id });

export const purchasesInList = (list_id: number) =>
  invoke<PurchaseRow[]>("purchases_in_list", { listId: list_id });

/** Returns how many were actually added (ones already in the list are skipped). */
export const addToList = (list_id: number, purchase_ids: number[]) =>
  invoke<number>("add_to_list", { listId: list_id, purchaseIds: purchase_ids });
export const removeFromList = (list_id: number, purchase_ids: number[]) =>
  invoke<void>("remove_from_list", { listId: list_id, purchaseIds: purchase_ids });

/** New order for the purchases of one day (the ids as they appear on screen). */
export const reorderDay = (date: string, ids: number[]) =>
  invoke<void>("reorder_day", { date, ids });

export const listsOfPurchase = (purchase_id: number) =>
  invoke<number[]>("lists_of_purchase", { purchaseId: purchase_id });
export const setPurchaseLists = (purchase_id: number, list_ids: number[]) =>
  invoke<void>("set_purchase_lists", { purchaseId: purchase_id, listIds: list_ids });

/** cents -> editable string, e.g. 1250 -> "12,50" (for the edit form input). */
export const centsToInput = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", ",");

// ---- Money helpers -------------------------------------------------------
// Everything is cents internally; we only format for display.

export const CURRENCY = "EUR"; // you're in ES — change if you ever need to

const fmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: CURRENCY });

export const centsToText = (cents: number) => fmt.format(cents / 100);

/** Like centsToText, but a price of 0 shows nothing (purchases without price). */
export const priceText = (cents: number) => (cents === 0 ? "" : centsToText(cents));

/** Parse a user-typed amount like "12,50" or "12.50" into integer cents. */
export const textToCents = (text: string): number | null => {
  const cleaned = text.replace(/[^0-9.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

// ---- File helpers --------------------------------------------------------

/** Read a dropped/selected File into the ReceiptInput shape the backend wants. */
export const fileToReceipt = (file: File): Promise<ReceiptInput> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:<mime>;base64,XXXX"
      const data_b64 = result.split(",")[1] ?? "";
      resolve({
        filename: file.name,
        mime: file.type || "application/octet-stream",
        data_b64,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Turn a Blob (e.g. a generated PDF) into base64 without the data-URI prefix. */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Turn a stored attachment back into an object URL for previewing / opening. */
export const attachmentToUrl = (a: Attachment): string => {
  const bytes = Uint8Array.from(atob(a.data_b64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: a.mime }));
};
