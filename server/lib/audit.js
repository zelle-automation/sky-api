import { query } from "./db.js";

export function audit(userId, action, entityType, entityId, detail) {
  return query("INSERT INTO travel.audit_log (user_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5)", [
    userId,
    action,
    entityType ?? null,
    entityId ?? null,
    detail == null ? null : JSON.stringify(detail),
  ]).catch((e) => console.warn("audit:", e.message));
}
