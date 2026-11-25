import { test, expect } from "@playwright/test";
import { serverConfig } from "../../scripts/config.mjs";
import { seedWorkspace } from "./backendFixture";
test.beforeEach(async ({ request }) => {
  await seedWorkspace(request);
});

test("pause mocking, import features with picker and drop, and persist dark mode", async ({
  page,
  request,
}) => {
  const headers = {
    "X-Mockman-Admin": "1",
    "Content-Type": "application/json",
  };
  const original = await (
    await request.get(`${serverConfig.adminOrigin}/api/config`)
  ).json();
  const feature = original.projects[0].features[0];
  const endpoint = feature.endpoints[0];
  const session = `settings-${Date.now()}`;
  const mockRequest = () =>
    request.fetch(`${serverConfig.mockOrigin}${endpoint.path}`, {
      method: endpoint.method,
      headers: {
        "X-Mock-Project": original.projects[0].id,
        "X-Mock-Environment": original.projects[0].environments[0],
        "X-Mock-Session": session,
      },
    });
  const bundle = JSON.stringify({
    format: "mockman-feature",
    version: 1,
    feature: {
      ...feature,
      name: "Imported with picker",
      endpoints: feature.endpoints.map((endpoint: { path: string }) => ({
        ...endpoint,
        path: `/settings/picker${endpoint.path}`,
      })),
    },
  });
  try {
    const fixture = structuredClone(original);
    for (const project of fixture.projects)
      for (const feature of project.features)
        for (const endpoint of feature.endpoints)
          for (const response of endpoint.responses) response.delayMs = 0;
    const saved = await request.put(`${serverConfig.adminOrigin}/api/config`, {
      headers,
      data: fixture,
    });
    expect(saved.ok()).toBeTruthy();
    await page.goto("/");
    await expect(page.getByLabel("Global mocking")).toHaveCount(0);
    await page.getByLabel("Feature mocking").locator("..").click();
    await expect(page.getByLabel("Feature mocking")).not.toBeChecked();
    expect((await mockRequest()).status()).toBe(404);
    await page.reload();
    await expect(page.getByLabel("Feature mocking")).not.toBeChecked();
    await page.getByLabel("Feature mocking").locator("..").click();
    await expect(page.getByLabel("Feature mocking")).toBeChecked();
    expect((await mockRequest()).status()).not.toBe(404);

    await expect(
      page.getByRole("button", { name: "Import feature", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page
      .getByRole("button", { name: "Add feature", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Import feature JSON").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "not a supported Mockman feature export",
    );
    await dialog.getByLabel("Import feature JSON").setInputFiles({
      name: "feature.json",
      mimeType: "application/json",
      buffer: Buffer.from(bundle),
    });
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Imported with picker." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add feature", exact: true })
      .click();
    const drop = await page.evaluateHandle(
      (text) => {
        const data = new DataTransfer();
        data.items.add(
          new File([text], "feature.json", { type: "application/json" }),
        );
        return data;
      },
      bundle
        .replace("Imported with picker", "Imported with drop")
        .replaceAll("/settings/picker", "/settings/drop"),
    );
    await page
      .getByLabel("Import feature drop zone")
      .dispatchEvent("drop", { dataTransfer: drop });
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Imported with drop." }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Switch to light mode" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/settings-dark-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Add feature", exact: true })
      .click();
    await page.screenshot({
      path: "test-results/settings-dark-import.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/settings-dark-mobile.png",
      fullPage: true,
    });
  } finally {
    const latest = await (
      await request.get(`${serverConfig.adminOrigin}/api/config`)
    ).json();
    await request.put(`${serverConfig.adminOrigin}/api/config`, {
      headers,
      data: { ...original, version: latest.version },
    });
  }
});

test("shared routes use the selected feature in Try request and curl examples", async ({
  page,
  request,
}) => {
  const adminURL = serverConfig.adminOrigin;
  const headers = {
    "X-Mockman-Admin": "1",
    "Content-Type": "application/json",
  };
  const original = await (await request.get(`${adminURL}/api/config`)).json();
  try {
    const config = structuredClone(original);
    const project = config.projects[0];
    const first = project.features[0];
    const endpoint = first.endpoints[0];
    for (const response of endpoint.responses) response.delayMs = 0;
    endpoint.responses[0].status = 200;
    endpoint.responses[0].body = { feature: first.id };
    endpoint.scenarios[0].behavior = "always";
    endpoint.scenarios[0].responseIds = [endpoint.responses[0].id];
    const second = structuredClone(first);
    second.id = "billing";
    second.name = "Billing";
    second.endpoints[0].id = "billing-accept";
    second.endpoints[0].responses[0].body = { feature: "billing" };
    project.features.push(second);
    const saved = await request.put(`${adminURL}/api/config`, {
      headers,
      data: config,
    });
    expect(saved.ok()).toBeTruthy();
    const mock = (feature?: string) =>
      request.fetch(`${serverConfig.mockOrigin}${endpoint.path}`, {
        method: endpoint.method,
        headers: {
          "X-Mock-Project": project.id,
          "X-Mock-Environment": project.environments[0],
          ...(feature ? { "X-Mock-Feature": feature } : {}),
        },
      });
    expect((await mock()).status()).toBe(409);
    expect((await mock("missing")).status()).toBe(404);
    await page.goto("/");
    await page.locator(".feature-nav").filter({ hasText: "Billing" }).click();
    await page
      .getByRole("button", { name: "Try request", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Feature", { exact: true })).toHaveValue(
      "billing",
    );
    const sent = page.waitForRequest(
      (r) => new URL(r.url()).pathname === "/api/try" && r.method() === "POST",
    );
    await dialog.getByRole("button", { name: "Send request" }).click();
    expect((await sent).postDataJSON().feature).toBe("billing");
    await expect(dialog.getByText("HTTP 200")).toBeVisible();
    await expect(dialog.getByTestId("try-body")).toHaveText(
      '{"feature":"billing"}',
    );
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("tab", { name: "Connect", exact: true }).click();
    await expect(page.locator(".curl")).toContainText(
      "X-Mock-Feature: billing",
    );
    await page.getByRole("tab", { name: /^Request logs/ }).click();
    await page.locator(".log-row").first().locator("summary").click();
    await expect(page.locator(".log-row").first()).toContainText("billing");
    await page.getByLabel("Feature mocking").locator("..").click();
    await expect(page.getByLabel("Feature mocking")).not.toBeChecked();
    expect((await mock("billing")).status()).toBe(404);
    const fallback = await mock();
    expect(fallback.status()).toBe(200);
    expect((await fallback.json()).feature).toBe(first.id);
  } finally {
    const latest = await (await request.get(`${adminURL}/api/config`)).json();
    await request.put(`${adminURL}/api/config`, {
      headers,
      data: { ...original, version: latest.version },
    });
  }
});
