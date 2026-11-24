import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("dark workspace contrast, search recovery, pause feedback and mobile controls", async ({
  page,
}) => {
  let config = structuredClone(fixture);
  await page.addInitScript(() => localStorage.setItem("mockman-theme", "dark"));
  await page.route("**/api/**", async (route) => {
    const isConfig = new URL(route.request().url()).pathname === "/api/config";
    if (isConfig && route.request().method() === "PUT")
      config = {
        ...route.request().postDataJSON(),
        version: config.version + 1,
      };
    await route.fulfill({
      json: isConfig ? config : [],
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "New endpoint", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Mockman home" })).toBeVisible();
  await expect(page.getByLabel("Global mocking")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New endpoint", exact: true }),
  ).toHaveCSS("background-color", "rgb(165, 180, 252)");
  // Check actual computed colors, so cascade mistakes fail this check.
  const contrasts = await page.evaluate(() => {
    const luminance = (color: string) => {
      const rgb = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const value = v / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    return [
      '[data-variant="default"]',
      '[data-variant="outline"]',
      ".endpoint-item.active",
    ].map((selector) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      const values = [
        luminance(style.color),
        luminance(style.backgroundColor),
      ].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    });
  });
  for (const contrast of contrasts)
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({
    path: "test-results/appearance-dark-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Search endpoints").fill("missing-endpoint");
  await expect(
    page.getByRole("heading", { name: "No matching endpoints" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".endpoint-item.active")).toBeVisible();
  await page.getByLabel("Feature mocking").locator("..").click();
  await expect(page.getByText("Feature mocking is paused")).toBeVisible();
  await page.getByRole("button", { name: "Resume mocking" }).click();
  await expect(page.getByText("Feature mocking is paused")).toHaveCount(0);
  await expect(page.getByLabel("Feature mocking")).toBeChecked();
  await page.getByRole("combobox", { name: "Environment" }).click();
  await expect(
    page.getByRole("option", { name: "staging", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: "staging", exact: true }).click();
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: "test-results/appearance-dark-dialog.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("tab", { name: /^Scenarios/ }).click();
  await page.getByRole("button", { name: "Add scenario", exact: true }).click();
  await page.getByRole("combobox", { name: "Behavior", exact: true }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await expect(
    page.locator(".monaco-editor .monaco-editor-background").first(),
  ).toHaveCSS("background-color", "rgb(20, 23, 31)", { timeout: 30000 });
  const editorInput = page.getByRole("textbox", {
    name: "JavaScript code",
    exact: true,
  });
  const setCode = async (code: string) => {
    await editorInput.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(code);
  };
  // Wait for the language worker to report a real syntax error before checking
  // that function-body snippets accept return and still get other diagnostics.
  await setCode("const broken = ;");
  await expect(
    page.locator(".monaco-editor .squiggly-error").first(),
  ).toBeVisible({ timeout: 30000 });
  await setCode(
    'const chosen = responses.find((response) => response.name === "Active");\nreturn { responseId: chosen?.id ?? responses[0]?.id };',
  );
  await expect(page.locator(".monaco-editor .squiggly-error")).toHaveCount(0, {
    timeout: 30000,
  });
  await setCode(
    "const missing = notARealVariable;\nreturn { responseId: missing };",
  );
  await expect(
    page.locator(".monaco-editor .squiggly-error").first(),
  ).toBeVisible({ timeout: 30000 });
  await setCode(
    'const expiresAt = _.get(request.body, "expiresAt");\nconst expired = expiresAt && moment(expiresAt).isBefore(moment());\nconst chosen = input.responses.find((response) => response.name === (expired ? "Expired" : "Active"));\nreturn { responseId: chosen?.id ?? input.responses[0]?.id };',
  );
  await expect(page.locator(".monaco-editor .squiggly-error")).toHaveCount(0, {
    timeout: 30000,
  });
  await page.screenshot({
    path: "test-results/appearance-dark-editor.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("tab", { name: /^Responses/ }).click();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator('.app[data-theme="light"]')).toBeVisible();
  await page.screenshot({
    path: "test-results/appearance-light-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Export feature", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit feature", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/appearance-dark-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("request logs show original payloads, empty bodies, binary data and legacy entries", async ({
  page,
}) => {
  const body =
    '{"id":9007199254740993,"message":"<script>window.__payloadRan=true</script>"}';
  const payloads = [
    {
      body,
      encoding: "utf-8",
      contentType: "application/json",
      sizeBytes: body.length,
      truncated: false,
    },
    {
      body: "",
      encoding: "utf-8",
      contentType: "",
      sizeBytes: 0,
      truncated: false,
    },
    {
      body: "prefix",
      encoding: "utf-8",
      contentType: "text/plain",
      sizeBytes: 70000,
      truncated: true,
    },
    {
      body: "YQBi",
      encoding: "base64",
      contentType: "application/octet-stream",
      sizeBytes: 3,
      truncated: false,
    },
    undefined,
  ];
  const logs = payloads.map((payload, index) => ({
    id: index + 1,
    createdAt: new Date().toISOString(),
    detail: {
      method: "POST",
      path: "/v1/agreements/acceptances",
      endpoint: "accept",
      scenario: "always",
      revision: "1",
      session: `client-${index}`,
      attempt: index + 1,
      status: 200,
      delayMs: 0,
      reason: "active scenario; conditions matched",
      ...(payload ? { payload } : {}),
    },
  }));
  await page.addInitScript(() => localStorage.setItem("mockman-theme", "dark"));
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      json:
        new URL(route.request().url()).pathname === "/api/config"
          ? fixture
          : logs,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: /^Request logs/ }).click();
  await expect(page.locator(".log-row")).toHaveCount(5);
  const rows = page.locator(".log-row");
  for (let index = 0; index < 5; index++)
    await rows.nth(index).locator("summary").click();
  await expect(rows.nth(0).locator(".log-payload pre")).toHaveText(body);
  await expect(rows.nth(0)).toContainText("application/json");
  await expect(rows.nth(0)).toContainText("client-0");
  await expect(rows.nth(1)).toContainText("No request body.");
  await expect(rows.nth(2)).toContainText("Showing the first 64 KiB at most.");
  await expect(rows.nth(3)).toContainText(
    "Binary payload · displayed as base64.",
  );
  await expect(rows.nth(3).locator("pre")).toHaveText("YQBi");
  await expect(rows.nth(4)).toContainText(
    "Payload was not recorded for this request.",
  );
  expect(await page.evaluate(() => "__payloadRan" in window)).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/request-payload-logs.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("feature actions stay fixed while scenarios scroll and JSON previews are highlighted", async ({
  page,
}) => {
  const config = structuredClone(fixture);
  config.projects[0].features[0].name = "IAM device binding";
  const endpoint = config.projects[0].features[0].endpoints[0];
  endpoint.responses[0].body = {
    device: "mobile",
    attempts: 3,
    enabled: true,
    metadata: null,
    values: [1, "two"],
    message: "<script>window.__previewRan = true</script>",
  };
  endpoint.scenarios = Array.from({ length: 12 }, (_, index) => ({
    ...endpoint.scenarios[0],
    id: `scenario-${index + 1}`,
    name: `Scenario ${index + 1}`,
  }));
  endpoint.active = { development: "scenario-1", staging: "scenario-1" };
  await page.addInitScript(() => localStorage.setItem("mockman-theme", "dark"));
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      json:
        new URL(route.request().url()).pathname === "/api/config" ? config : [],
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "IAM device binding." });
  await expect(heading).toBeVisible();
  await expect(page.locator(".app")).toHaveCSS(
    "background-color",
    "rgb(16, 18, 24)",
  );
  const preview = page.locator(".response-card .json-preview").first();
  await expect(preview).toHaveText(
    JSON.stringify(endpoint.responses[0].body, null, 2),
  );
  for (const kind of [
    "key",
    "string",
    "number",
    "literal",
    "null",
    "punctuation",
  ]) {
    expect(await preview.locator(`.json-${kind}`).count()).toBeGreaterThan(0);
  }
  await expect(preview.locator(".json-key").first()).toHaveCSS(
    "color",
    "rgb(159, 197, 255)",
  );
  await expect(preview.locator(".json-string").first()).toHaveCSS(
    "color",
    "rgb(146, 216, 180)",
  );
  expect(await page.evaluate(() => "__previewRan" in window)).toBe(false);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/highlighted-json-desktop.png",
    animations: "disabled",
  });
  const content = page.getByRole("region", {
    name: "Feature content",
    exact: true,
  });
  await page.getByRole("tab", { name: /^Scenarios/ }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390) {
      await page.locator(".feature-nav").first().scrollIntoViewIfNeeded();
      await expect(page.locator(".feature-nav").first()).toBeInViewport();
    }
    await content.evaluate((element) => {
      element.scrollTop = 0;
    });
    const before = await heading.boundingBox();
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByText("Scenario 12", { exact: true }),
    ).toBeInViewport();
    expect(
      await content.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    const after = await heading.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    await expect(
      page.getByRole("button", { name: "New endpoint", exact: true }),
    ).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/sticky-scenarios-${width}.png`,
      animations: "disabled",
    });
  }
});

test("sidebar alignment and large response preview support editing and deletion", async ({
  page,
}) => {
  let config = structuredClone(fixture);
  await page.addInitScript(() => localStorage.setItem("mockman-theme", "dark"));
  await page.route("**/api/**", async (route) => {
    const isConfig = new URL(route.request().url()).pathname === "/api/config";
    if (isConfig && route.request().method() === "PUT")
      config = {
        ...route.request().postDataJSON(),
        version: config.version + 1,
      };
    await route.fulfill({
      json: isConfig ? config : [],
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/");
  const toggle = page.locator(".sidebar-header .sidebar-toggle");
  await expect(toggle).toBeVisible();
  const brandBox = await page
    .locator(".sidebar-header .brand-icon")
    .boundingBox();
  const toggleBox = await toggle.boundingBox();
  expect(brandBox!.y + brandBox!.height / 2).toBeCloseTo(
    toggleBox!.y + toggleBox!.height / 2,
    0,
  );
  await expect(page.locator(".sidebar-bottom")).toHaveCount(0);
  await expect(page.getByText("v0.1", { exact: true })).toHaveCount(0);
  await toggle.click();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/collapsed/);
  await page
    .getByRole("button", {
      name: "View response Agreement accepted",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Agreement accepted");
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(900);
  await expect(dialog.getByText("HTTP 200", { exact: true })).toBeVisible();
  await expect(
    dialog.locator(".response-viewer-body .json-preview"),
  ).toHaveText('{\n  "success": true\n}');
  await dialog.getByText("Response headers (1)", { exact: true }).click();
  await expect(
    dialog.locator(".response-viewer-headers .json-preview"),
  ).toContainText("application/json");
  await expect(
    dialog.getByRole("button", { name: "Edit response", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Delete response", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results/response-large-preview.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Edit response", exact: true })
    .click();
  await dialog.getByLabel("Response name").fill("Updated acceptance");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "View response Updated acceptance",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "View response Temporary failure",
      exact: true,
    })
    .click();
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await dialog
    .getByRole("button", { name: "Delete response", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog
    .getByRole("button", { name: "Delete response", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "View response Temporary failure",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(config.projects[0].features[0].endpoints[0].responses).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", {
      name: "View response Updated acceptance",
      exact: true,
    })
    .click();
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expect(
    dialog.getByRole("button", { name: "Edit response", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results/response-large-preview-mobile.png",
    animations: "disabled",
  });
});

test("feature drops distinguish missing files from multiple files and read file items", async ({
  page,
}) => {
  let config = structuredClone(fixture);
  await page.route("**/api/**", async (route) => {
    const isConfig = new URL(route.request().url()).pathname === "/api/config";
    if (isConfig && route.request().method() === "PUT")
      config = {
        ...route.request().postDataJSON(),
        version: config.version + 1,
      };
    await route.fulfill({ json: isConfig ? config : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  const zone = page.getByLabel("Import feature drop zone");
  const dialog = page.getByRole("dialog");
  const drop = async (
    kind: "link" | "multiple" | "items" | "file",
    name: string,
  ) => {
    const data = await page.evaluateHandle(
      ({ kind, bundle }) => {
        const transfer = new DataTransfer();
        if (kind === "link") {
          transfer.setData("text/uri-list", "file:///tmp/feature.json");
        } else {
          transfer.items.add(
            new File([bundle], "feature.json", { type: "application/json" }),
          );
          if (kind === "multiple")
            transfer.items.add(
              new File([bundle], "second.json", { type: "application/json" }),
            );
          if (kind === "items")
            Object.defineProperty(transfer, "files", { value: [] });
        }
        return transfer;
      },
      {
        kind,
        bundle: JSON.stringify({
          format: "mockman-feature",
          version: 1,
          feature: { ...fixture.projects[0].features[0], name },
        }),
      },
    );
    await zone.dispatchEvent("drop", { dataTransfer: data });
    await data.dispose();
  };
  await drop("link", "Unused");
  await expect(dialog.getByRole("alert")).toContainText(
    "No file was received.",
  );
  await expect(dialog.getByRole("alert")).not.toContainText("one feature JSON");
  await drop("multiple", "Unused");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Drop one feature JSON file at a time.",
  );
  expect(config.projects[0].features).toHaveLength(1);
  await drop("items", "Imported file items");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Imported file items." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await drop("file", "Imported native file");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Imported native file." }),
  ).toBeVisible();
  expect(config.projects[0].features).toHaveLength(3);
});
