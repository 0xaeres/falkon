import assert from "node:assert/strict";

// Run in cua_repl against the repository step: await checkBranchSelector(tab).
export async function checkBranchSelector(tab) {
  const trigger = tab.playwright.getByLabel("Branch for payments-api", { exact: true });
  await trigger.click();
  const placement = await tab.playwright.evaluate(() => {
    const menu = document.querySelector(".branch-menu");
    const bounds = menu.getBoundingClientRect();
    return { side: menu.dataset.side, inside: bounds.left >= 0 && bounds.right <= innerWidth };
  });
  assert.ok(["left", "right", "top", "bottom"].includes(placement.side));
  assert.ok(placement.inside, "Branch menu must remain inside the viewport");
  await tab.playwright.getByRole("menuitemradio", { name: "develop", exact: true }).click();
  assert.equal(await trigger.innerText(), "develop");
  assert.ok(await trigger.isEnabled(), "Changing a branch must not deselect its repository");
  await trigger.press("ArrowDown");
  await tab.playwright.getByRole("menuitemradio", { name: "main", exact: true }).press("Escape");
  const focus = await trigger.evaluate((element) => ({
    returned: element === document.activeElement,
    expanded: element.getAttribute("aria-expanded"),
    outline: getComputedStyle(element).outlineColor,
  }));
  assert.ok(focus.returned, "Escape must return focus to the trigger");
  assert.equal(focus.expanded, "false");
  assert.equal(focus.outline, "rgb(161, 161, 170)");
  assert.equal(await tab.playwright.getByLabel("Branch for fraud-rules", { exact: true }).isEnabled(), false);
  return "Branch selection, repository state, keyboard focus, disabled state, and viewport checks passed";
}

export async function checkOrganizationSelector(tab) {
  const trigger = tab.playwright.getByLabel("Organization", { exact: true });
  const inset = await trigger.evaluate((element) => {
    const button = element.getBoundingClientRect();
    const arrow = element.querySelector("svg").getBoundingClientRect();
    return button.right - arrow.right;
  });
  assert.ok(inset >= 12, "Organization chevron needs room from the right edge");
  await trigger.press("ArrowDown");
  const glass = await tab.playwright.evaluate(() => {
    const style = getComputedStyle(document.querySelector(".select-menu"));
    return { blur: style.backdropFilter, background: style.backgroundImage };
  });
  assert.equal(glass.blur, "blur(28px) saturate(1.3)");
  assert.ok(glass.background.startsWith("linear-gradient("));
  await tab.playwright.getByRole("menuitemradio", { name: "acme-payments", exact: true }).click();
  assert.equal(await trigger.innerText(), "acme-payments");
  assert.ok(await tab.playwright.getByLabel("Branch for payments-api", { exact: true }).isEnabled());
  return "Organization chevron, glass surface, and selection checks passed";
}
