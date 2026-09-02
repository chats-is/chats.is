export const helpers = page => {
  const row = t => page.locator('tbody tr').filter({ hasText: t });
  return {
    row,
    appear: async (t, ms = 15000) => {
      try { await row(t).first().waitFor({ state: 'visible', timeout: ms }); return true; }
      catch { return false; }
    },
    vanish: async (t, ms = 15000) => {
      try { await row(t).first().waitFor({ state: 'detached', timeout: ms }); return true; }
      catch { return false; }
    },
    dlg: () => page.locator('[role="dialog"]').last(),
    confirm: async () => {
      const y = page.locator('[role="alertdialog"], [role="dialog"]').last()
        .getByRole('button', { name: /delete|remove|continue|confirm/i });
      if (await y.count()) await y.last().click();
    },
    pickSelect: async (label, optionText) => {
      const c = page.locator('[role="dialog"] [role="combobox"], [role="dialog"] button[aria-haspopup]');
      await c.first().click();
      await page.waitForTimeout(500);
      const opt = page.getByRole('option').filter({ hasText: optionText }).first();
      if (await opt.count()) await opt.click();
      else await page.getByRole('option').first().click();
      await page.waitForTimeout(300);
    }
  };
};
