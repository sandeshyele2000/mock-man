import { expect, test } from "@playwright/test";
import { fixture, fulfillProjectMutation } from "./fixture";

test.skip(!process.env.DEPLOYMENT_URL, "Requires a built dashboard deployment");

for (const access of ["unavailable", "allowed", "denied"] as const) {
  test(`Copy curl handles ${access} clipboard access`, async ({ page }) => {
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/api/config")
          ? fixture
          : [],
      }),
    );
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
          mode === "unavailable"
            ? undefined
            : {
                writeText: (text: string) => {
                  if (mode === "denied")
                    return Promise.reject(
                      new DOMException("Denied", "NotAllowedError"),
                    );
                  document.documentElement.dataset.copiedText = text;
                  return Promise.resolve();
                },
              },
      });
    }, access);
    await page.goto("./");
    await page.getByRole("tab", { name: "Connect", exact: true }).click();
    const curl = page.locator("pre.curl");
    await expect(curl).toBeVisible();
    const copy = page.getByRole("button", { name: "Copy curl", exact: true });
    if (access === "unavailable") {
      await expect(copy).toHaveCount(0);
    } else {
      await copy.click();
      if (access === "denied") {
        await expect(copy).toHaveCount(0);
        await expect(
          page.getByText("curl copied", { exact: true }),
        ).toHaveCount(0);
      } else {
        await expect(copy).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute(
          "data-copied-text",
          (await curl.textContent())!,
        );
        await expect(
          page.getByText("curl copied", { exact: true }),
        ).toBeVisible();
      }
    }
  });
}

test("deployment preserves mount paths for assets, API calls and editor workers", async ({
  page,
  baseURL,
}) => {
  const mount = new URL(baseURL!).pathname;
  const apiPath = mount === "/" ? "/" : "/mockman-api/";
  if (mount !== "/") {
    const redirect = await page.request.get(baseURL!.replace(/\/$/, ""));
    expect(redirect.url()).toBe(baseURL);
  }
  expect((await page.request.get(`${baseURL}assets/missing.js`)).status()).toBe(
    404,
  );
  let config = structuredClone(fixture);
  const failed: string[] = [];
  const workers: string[] = [];
  page.on("pageerror", (error) => failed.push(error.message));
  page.on("response", (response) => {
    if (
      response.url().startsWith(new URL(baseURL!).origin) &&
      response.status() >= 400
    )
      failed.push(`${response.status()} ${response.url()}`);
  });
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.route("**/api/**", async (route) => {
    if (await fulfillProjectMutation(route, config)) return;
    const path = new URL(route.request().url()).pathname;
    expect(path.startsWith(`${apiPath}api/`)).toBe(true);
    const isConfig = path === `${apiPath}api/config`;
    if (isConfig && route.request().method() === "PUT")
      config = {
        ...route.request().postDataJSON(),
        version: config.version + 1,
      };
    await route.fulfill({ json: isConfig ? config : [] });
  });

  await page.goto(baseURL!);
  await expect(
    page.getByRole("button", { name: "New endpoint", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Mockman home" }),
  ).toHaveAttribute("href", "./");
  expect(
    await page
      .getByRole("link", { name: "Mockman home" })
      .evaluate((el) => (el as HTMLAnchorElement).href),
  ).toBe(baseURL);
  const assetURLs = await page.evaluate(() => [
    ...Array.from(
      document.querySelectorAll<HTMLScriptElement>("script[src]"),
      (el) => el.src,
    ),
    ...Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        'link[rel="stylesheet"], link[rel="icon"], link[rel="apple-touch-icon"]',
      ),
      (el) => el.href,
    ),
  ]);
  for (const url of assetURLs.filter((url) =>
    url.startsWith(new URL(baseURL!).origin),
  )) {
    expect(new URL(url).pathname.startsWith(mount)).toBe(true);
    expect((await page.request.get(url)).status()).toBe(200);
  }
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${apiPath}api/config` &&
      response.request().method() === "PUT",
  );
  await page.getByLabel("Feature mocking").locator("..").click();
  await saved;
  await page.reload();
  await expect(page.getByText("Feature mocking is paused")).toBeVisible();
  await page.getByRole("button", { name: "Resume mocking" }).click();
  await page.getByRole("tab", { name: /^Scenarios/ }).click();
  await page.getByRole("button", { name: "Add scenario", exact: true }).click();
  await page.getByRole("combobox", { name: "Behavior", exact: true }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "JavaScript code",
    exact: true,
  });
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("const broken = ;");
  await expect(
    page.locator(".monaco-editor .squiggly-error").first(),
  ).toBeVisible({ timeout: 30000 });
  expect(workers.length).toBeGreaterThan(0);
  for (const worker of workers)
    expect(new URL(worker).pathname.startsWith(mount)).toBe(true);
  expect(failed).toEqual([]);
});
