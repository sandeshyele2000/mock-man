import { test, expect } from "@playwright/test";
import { serverConfig } from "../../scripts/config.mjs";
test("create, edit, activate, try, inspect logs and reset a mock endpoint", async ({
  page,
  request,
}) => {
  const backendURL = serverConfig.adminOrigin;
  const config = await (await request.get(`${backendURL}/api/config`)).json();
  const headers = {
    "X-Mockman-Admin": "1",
    "Content-Type": "application/json",
  };
  const unique = `e2e-${Date.now()}`;
  try {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "New endpoint" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/dashboard-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "New endpoint" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Test acceptance");
    await dialog.getByLabel("Identifier", { exact: true }).fill(unique);
    await dialog.getByLabel("Method", { exact: true }).selectOption("POST");
    await dialog.getByLabel("API path").fill("/e2e/accept");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Add response" }).click();
    await dialog.getByLabel("Response name").fill("Failure");
    await dialog.getByLabel("Status code").fill("503");
    await dialog.getByLabel("Response body (JSON)").fill("{invalid");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Invalid JSON");
    await dialog.getByLabel("Response body (JSON)").fill('{"error":"retry"}');
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Add response" }).click();
    await dialog.getByLabel("Response name").fill("Success");
    await dialog.getByLabel("Response body (JSON)").fill('{"ok":true}');
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("tab", { name: /Scenarios/ }).click();
    await page.getByRole("button", { name: "Add scenario" }).click();
    await dialog.getByLabel("Scenario name").fill("Retry once");
    await dialog
      .getByLabel("Behavior", { exact: true })
      .selectOption("failFirst");
    await dialog.getByLabel("Attempt threshold").fill("1");
    await dialog
      .getByLabel("Failure response")
      .selectOption({ label: "Failure · 503" });
    await dialog
      .getByLabel("Success response")
      .selectOption({ label: "Success · 200" });
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Add scenario" }).click();
    await dialog.getByLabel("Scenario name").fill("Always success");
    await dialog
      .getByLabel("Response", { exact: true })
      .selectOption({ label: "Success · 200" });
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .locator(".scenario-card")
      .filter({ hasText: "Always success" })
      .getByRole("button", { name: "Activate scenario" })
      .click();
    await expect(
      page.locator(".scenario-card").filter({ hasText: "Always success" }),
    ).toContainText("Active in development");
    await page
      .locator(".scenario-card")
      .filter({ hasText: "Retry once" })
      .getByRole("button", { name: "Activate scenario" })
      .click();
    await page
      .getByRole("button", { name: "Edit scenario Retry once" })
      .click();
    await dialog.getByLabel("Scenario name").fill("Retry first attempt");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByLabel("Session ID").fill(unique);
    await page.getByRole("button", { name: "Try request" }).click();
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByText("HTTP 503")).toBeVisible();
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByText("HTTP 200")).toBeVisible();
    await expect(dialog.getByTestId("try-body")).toHaveText('{"ok":true}');
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("tab", { name: /Request logs/ }).click();
    await expect(page.getByText("Attempt 2", { exact: true })).toBeVisible();
    await page.getByText("Attempt 2", { exact: true }).click();
    await expect(
      page
        .locator(".log-row")
        .filter({ has: page.getByText("Attempt 2", { exact: true }) })
        .getByText("active scenario; conditions matched", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset attempts" }).click();
    await dialog
      .getByRole("button", { name: `This endpoint · session ${unique}` })
      .click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Try request" }).click();
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByText("HTTP 503")).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("tab", { name: /Scenarios/ }).click();
    await page.getByRole("button", { name: "Add scenario" }).click();
    await dialog.getByLabel("Scenario name").fill("Conditional success");
    await dialog
      .getByLabel("Response", { exact: true })
      .selectOption({ label: "Success · 200" });
    await dialog.getByRole("button", { name: "Add condition" }).click();
    await dialog.getByLabel("Condition 1 key").fill("mode");
    await dialog.getByLabel("Condition 1 value").fill("fast");
    await dialog.getByLabel("Rule priority").fill("10");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Try request" }).click();
    await dialog
      .getByLabel("POST · Request path and query")
      .fill("/e2e/accept?mode=fast");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByText("HTTP 200")).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByLabel("Session ID").fill("");
    await expect(
      page.getByRole("button", { name: "Reset attempts" }),
    ).toBeDisabled();
    await page.getByLabel("Session ID").fill(unique);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Try request" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/dashboard-mobile.png",
      fullPage: true,
    });
  } finally {
    const latest = await (await request.get(`${backendURL}/api/config`)).json();
    await request.put(`${backendURL}/api/config`, {
      headers,
      data: { ...config, version: latest.version },
    });
  }
});
