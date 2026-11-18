// Created by Sandesh
declare global {
  interface Window {
    __MOCKMAN_CONFIG__?: { apiURL: string; mockURL: string };
  }
}
export const API_BASE_URL =
  window.__MOCKMAN_CONFIG__?.apiURL || import.meta.env.VITE_API_URL;
export const MOCK_SERVER_URL =
  window.__MOCKMAN_CONFIG__?.mockURL || import.meta.env.VITE_MOCK_URL;
export const ADMIN_HOST = new URL(API_BASE_URL).host;
export const MOCK_HOST = new URL(MOCK_SERVER_URL).host;
export const MOCK_PORT =
  new URL(MOCK_SERVER_URL).port ||
  (new URL(MOCK_SERVER_URL).protocol === "https:" ? "443" : "80");
