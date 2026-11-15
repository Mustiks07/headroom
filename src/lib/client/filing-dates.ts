import pack2026 from "../../../data/rules/us-federal-2026.json";
import pack2027 from "../../../data/rules/us-federal-2027.json";

/** Use the same versioned deadlines as the engine, including observed DC holidays. */
export const RETURN_DUE: Readonly<Record<number, string>> = {
  2026: pack2026.returnDueDate,
  2027: pack2027.returnDueDate,
};
