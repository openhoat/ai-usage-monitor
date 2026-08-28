import { expect, test } from '@playwright/test'

test.describe('Dashboard', () => {
  test('should render the page with global dot and providers', async ({ page }) => {
    await page.goto('/')

    // Page title
    await expect(page.locator('h1')).toHaveText('AI Usage Monitor')

    // Global status dot
    const globalDot = page.locator('[data-testid="global-dot"]')
    await expect(globalDot).toBeVisible()

    // Refresh button
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible()

    // Wait for provider cards to load (rounded-lg cards from ProviderCard)
    await expect(page.locator('.rounded-lg').first()).toBeVisible({ timeout: 15000 })

    // Provider cards should be rendered (dots visible inside cards)
    // Global dot is in the header, provider dots are inside cards
    const allDots = page.locator('.rounded-full')
    const count = await allDots.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('should show provider details directly without expand', async ({ page }) => {
    await page.goto('/')

    // Wait for cards to render
    await expect(page.locator('.rounded-lg').first()).toBeVisible({ timeout: 15000 })

    // Details (percentages or error messages) should be visible without clicking
    const details = page.locator('.text-sm.font-semibold, .text-sm.text-destructive')
    const count = await details.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should show error details for a failed provider', async ({ page }) => {
    await page.goto('/')

    // Wait for cards to render
    await expect(page.locator('.rounded-lg').first()).toBeVisible({ timeout: 15000 })

    // Find a provider with error status (dot with bg-destructive inside a card)
    const errorText = page.locator('.text-destructive').first()
    const errorCount = await errorText.count()

    if (errorCount > 0) {
      // Error message should be visible directly without clicking
      await expect(errorText).toBeVisible({ timeout: 3000 })
    }
  })

  test('should refresh data when clicking refresh button', async ({ page }) => {
    await page.goto('/')

    const refreshBtn = page.getByRole('button', { name: /refresh/i })
    await refreshBtn.click()

    // Button should show "Refreshing…" while loading
    await expect(page.getByRole('button', { name: /refreshing/i })).toBeVisible({ timeout: 3000 })

    // Then return to "Refresh" when done
    await expect(refreshBtn).toBeVisible({ timeout: 30000 })
  })
})
