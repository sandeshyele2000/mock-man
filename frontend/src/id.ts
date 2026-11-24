// Created by Sandesh
export function generateId(): string {
  // Unlike randomUUID(), getRandomValues() also works on HTTP deployments.
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
