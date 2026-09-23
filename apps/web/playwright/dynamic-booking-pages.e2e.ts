import { expect } from "@playwright/test";

import { test } from "./lib/fixtures";
import { confirmBooking, selectFirstAvailableTimeSlotNextMonth } from "./lib/testUtils";

test.afterEach(({ users }) => users.deleteAll());

// Dynamic group booking is disabled instance-wide (IS_DYNAMIC_GROUP_BOOKING_ENABLED)
test("dynamic group links return 404", async ({ page, users }) => {
  const pro = await users.create();
  const free = await users.create({ username: "free.example" });

  const groupPage = await page.goto(`/${pro.username}+${free.username}`);
  expect(groupPage?.status()).toBe(404);

  const groupEventPage = await page.goto(`/${pro.username}+${free.username}/30`);
  expect(groupEventPage?.status()).toBe(404);
});

test("multiple duration selection updates event length correctly", async ({ page, users }) => {
  const user = await users.create();
  await user.apiLogin();

  await test.step("update event title to include duration placeholder", async () => {
    await page.goto("/event-types");
    await page.waitForSelector('[data-testid="event-types"]');
    await page.click(`text=Multiple duration`);
    await page.waitForSelector('[data-testid="event-title"]');
    await expect(page.getByTestId("vertical-tab-basics")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("vertical-tab-event_advanced_tab_title").click();
    await page.fill('[name="eventName"]', "{Event duration} event btwn {Organiser} {Scheduler}");
    await page.locator('[data-testid="update-eventtype"]').click();
    await page.waitForResponse("/api/trpc/eventTypesHeavy/update?batch=1");
  });

  await page.goto(`/${user.username}/multiple-duration`);

  await page.waitForURL((url) => {
    return url.searchParams.get("overlayCalendar") === "true";
  });

  await page.locator('[data-testid="multiple-choice-30mins"]').waitFor({ state: "visible" });

  await test.step("verify default 30min duration is selected", async () => {
    const duration30 = page.getByTestId("multiple-choice-30mins");
    const activeState = await duration30.getAttribute("data-active");
    expect(activeState).toEqual("true");
  });

  await test.step("book with 90min duration and verify title", async () => {
    await page.getByTestId("multiple-choice-90mins").click();
    await page.locator('[data-testid="time"]').nth(0).waitFor({ state: "visible" });

    const duration90 = page.getByTestId("multiple-choice-90mins");
    const activeState = await duration90.getAttribute("data-active");
    expect(activeState).toEqual("true");

    await selectFirstAvailableTimeSlotNextMonth(page);

    await page.fill('[name="name"]', "Test User");
    await page.fill('[name="email"]', "test@example.com");
    await confirmBooking(page);

    await expect(page.locator("[data-testid=success-page]")).toBeVisible();

    const bookingTitle = page.locator('[data-testid="booking-title"]');
    await expect(bookingTitle).toBeVisible();
    const titleText = await bookingTitle.textContent();
    expect(titleText).toContain("90");
  });
});

// eslint-disable-next-line playwright/no-skipped-test
test.skip("it contains the right event details", async ({ page }) => {
  const response = await page.goto(`http://acme.cal.local:3000/owner1+member1`);
  expect(response?.status()).toBe(200);

  await expect(page.locator('[data-testid="event-title"]')).toHaveText("Group Meeting");
  await expect(page.locator('[data-testid="event-meta"]')).toContainText("Acme Inc");

  expect((await page.locator('[data-testid="event-meta"] [data-testid="avatar"]').all()).length).toBe(3);
});
