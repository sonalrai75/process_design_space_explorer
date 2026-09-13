export const GATE_COOKIE = "pds_gate";

export async function gateToken(password) {
  const input = new TextEncoder().encode(
    `process-design:${password}`
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
