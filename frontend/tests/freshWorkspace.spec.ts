import { expect, test } from "@playwright/test";
import { serverConfig } from "../../scripts/config.mjs";
test("an empty database can create its first project feature and endpoint", async ({
  page,
  request,
}) => {
  const headers = {
    "Content-Type": "application/json",
    "X-Mockman-Admin": "1",
  };
  const original = await (
    await request.get(`${serverConfig.adminOrigin}/api/config`)
  ).json();
  const reset = await request.put(`${serverConfig.adminOrigin}/api/config`, {
    headers,
    data: { version: original.version, projects: [] },
  });
  expect(reset.ok()).toBe(true);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Project", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("First project");
    await dialog.getByLabel("Identifier", { exact: true }).fill("first");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole("button", { name: "Add feature", exact: true })
      .click();
    await dialog.getByLabel("Name", { exact: true }).fill("First feature");
    await dialog.getByLabel("Identifier", { exact: true }).fill("feature");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole("button", { name: "New endpoint", exact: true })
      .click();
    await dialog.getByLabel("Name", { exact: true }).fill("First endpoint");
    await dialog.getByLabel("Identifier", { exact: true }).fill("endpoint");
    await dialog.getByLabel("API path").fill("/first");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    const saved = await (
      await request.get(`${serverConfig.adminOrigin}/api/config`)
    ).json();
    expect(saved.projects[0].features[0].endpoints[0].path).toBe("/first");
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
