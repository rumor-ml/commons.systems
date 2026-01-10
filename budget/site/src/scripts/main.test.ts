import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager } from './state';
import { Category, WeekId, BudgetPlan } from '../islands/types';

/**
 * Integration tests for main.ts event handling
 *
 * These tests verify the complete flow: event → state update → localStorage persistence
 * This addresses the missing integration tests identified in TODO(#1365)
 */

describe('main.ts Event Handler Integration Tests', () => {
  beforeEach(() => {
    // Clear localStorage and DOM before each test
    localStorage.clear();
    // Clear DOM by removing all child nodes
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    vi.clearAllMocks();

    // Simulate the page being loaded so event handlers can be initialized
    // We need to set readyState to 'complete' to bypass DOMContentLoaded waiting
    Object.defineProperty(document, 'readyState', {
      writable: true,
      value: 'complete',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Category Toggle Event Flow', () => {
    it('dispatching budget:category-toggle updates state and persists to localStorage', async () => {
      // Import main.ts to initialize event handlers
      await import('./main');

      // Setup initial state
      StateManager.save({ hiddenCategories: [] });

      // Dispatch the category toggle event
      const event = new CustomEvent('budget:category-toggle', {
        detail: { category: 'groceries' as Category },
      });
      document.dispatchEvent(event);

      // Verify state was updated in memory
      const state = StateManager.load();
      expect(state.hiddenCategories).toContain('groceries');

      // Verify state was persisted to localStorage
      const stored = localStorage.getItem('budget-state');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.hiddenCategories).toContain('groceries');
    });

    it('validation error displays error banner when category is missing', async () => {
      await import('./main');

      // Dispatch event with missing category
      const event = new CustomEvent('budget:category-toggle', {
        detail: {} as any,
      });
      document.dispatchEvent(event);

      // Verify error banner was created
      const errorBanner = document.querySelector('[class*="bg-"]');
      expect(errorBanner).toBeTruthy();
      expect(errorBanner?.textContent).toContain('category');
    });

    it('toggles category visibility (hide then show)', async () => {
      await import('./main');

      StateManager.save({ hiddenCategories: [] });

      // Hide groceries
      let event = new CustomEvent('budget:category-toggle', {
        detail: { category: 'groceries' as Category },
      });
      document.dispatchEvent(event);

      let state = StateManager.load();
      expect(state.hiddenCategories).toContain('groceries');

      // Show groceries again (toggle)
      event = new CustomEvent('budget:category-toggle', {
        detail: { category: 'groceries' as Category },
      });
      document.dispatchEvent(event);

      state = StateManager.load();
      expect(state.hiddenCategories).not.toContain('groceries');
    });
  });

  describe('Vacation Toggle Event Flow', () => {
    it('dispatching budget:vacation-toggle updates state and persists', async () => {
      await import('./main');

      StateManager.save({ showVacation: true });

      const event = new CustomEvent('budget:vacation-toggle', {
        detail: { showVacation: false },
      });
      document.dispatchEvent(event);

      const state = StateManager.load();
      expect(state.showVacation).toBe(false);

      const stored = localStorage.getItem('budget-state');
      const parsed = JSON.parse(stored!);
      expect(parsed.showVacation).toBe(false);
    });
  });

  describe('Week Change Event Flow', () => {
    it('dispatching budget:week-change updates selectedWeek and persists', async () => {
      await import('./main');

      StateManager.save({ selectedWeek: null });

      const event = new CustomEvent('budget:week-change', {
        detail: { week: '2025-W05' as WeekId },
      });
      document.dispatchEvent(event);

      const state = StateManager.load();
      expect(state.selectedWeek).toBe('2025-W05');

      const stored = localStorage.getItem('budget-state');
      const parsed = JSON.parse(stored!);
      expect(parsed.selectedWeek).toBe('2025-W05');
    });
  });

  describe('Granularity Toggle Event Flow', () => {
    it('dispatching budget:granularity-toggle updates viewGranularity and persists', async () => {
      await import('./main');

      StateManager.save({ viewGranularity: 'month' });

      const event = new CustomEvent('budget:granularity-toggle', {
        detail: { granularity: 'week' as 'week' | 'month' },
      });
      document.dispatchEvent(event);

      const state = StateManager.load();
      expect(state.viewGranularity).toBe('week');

      const stored = localStorage.getItem('budget-state');
      const parsed = JSON.parse(stored!);
      expect(parsed.viewGranularity).toBe('week');
    });
  });

  describe('Budget Plan Save Event Flow', () => {
    it('successful save exits planning mode and switches to weekly view', async () => {
      await import('./main');

      StateManager.save({ planningMode: true, viewGranularity: 'month' });

      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -100, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };

      const event = new CustomEvent('budget:plan-save', {
        detail: { budgetPlan },
      });
      document.dispatchEvent(event);

      const state = StateManager.load();
      expect(state.budgetPlan).toEqual(budgetPlan);
      expect(state.planningMode).toBe(false);
      expect(state.viewGranularity).toBe('week');
    });

    it('save verification failure path is tested (save succeeds but verification finds mismatch)', async () => {
      await import('./main');

      StateManager.save({ planningMode: true });

      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -100, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };

      // Mock StateManager.save to return a state where budgetPlan is null
      // This simulates a verification failure where the save didn't persist correctly
      const originalSave = StateManager.save.bind(StateManager);
      vi.spyOn(StateManager, 'save').mockImplementation((state) => {
        const result = originalSave(state);
        // Return state with null budgetPlan to trigger verification failure
        return { ...result, budgetPlan: null };
      });

      const event = new CustomEvent('budget:plan-save', {
        detail: { budgetPlan },
      });
      document.dispatchEvent(event);

      // Verify error banner exists (from save verification failure path)
      const errorBanner = document.querySelector('[class*="bg-"]');
      expect(errorBanner).toBeTruthy();
      expect(errorBanner?.textContent).toContain('Failed to save budget plan');
    });

    it('QuotaExceededError shows error banner from StateManager', async () => {
      await import('./main');

      StateManager.save({ planningMode: true });

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });

      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -100, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };

      const event = new CustomEvent('budget:plan-save', {
        detail: { budgetPlan },
      });
      document.dispatchEvent(event);

      // When save() throws, StateManager shows a generic error banner
      const errorBanner = document.querySelector('[class*="bg-"]');
      expect(errorBanner).toBeTruthy();
      const bannerText = errorBanner?.textContent || '';
      // StateManager.save() shows this message when budgetPlan is in state
      expect(bannerText).toContain('Failed to save your budget plan');
      expect(bannerText).toContain('private browsing mode');
    });

    it('storage unavailable error shows error banner from StateManager', async () => {
      await import('./main');

      StateManager.save({ planningMode: true });

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage unavailable');
      });

      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -100, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };

      const event = new CustomEvent('budget:plan-save', {
        detail: { budgetPlan },
      });
      document.dispatchEvent(event);

      const errorBanner = document.querySelector('[class*="bg-"]');
      expect(errorBanner).toBeTruthy();
      const bannerText = errorBanner?.textContent || '';
      // StateManager.save() shows this generic message when save throws
      expect(bannerText).toContain('Failed to save your budget plan');
      expect(bannerText).toContain('private browsing mode');
    });

    it('preserves unmodified categories when updating budget plan', async () => {
      await import('./main');

      // Set up initial budget plan with multiple categories
      const initial: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -100, rolloverEnabled: false },
          dining: { weeklyTarget: -50, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };
      StateManager.save({ budgetPlan: initial, planningMode: true });

      // Update only groceries category
      const updated: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -600, rolloverEnabled: true },
          dining: { weeklyTarget: -50, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };

      const event = new CustomEvent('budget:plan-save', {
        detail: { budgetPlan: updated },
      });
      document.dispatchEvent(event);

      // Verify state was updated
      const state = StateManager.load();
      expect(state.budgetPlan?.categoryBudgets.dining).toEqual(initial.categoryBudgets.dining); // Unchanged
      expect(state.budgetPlan?.categoryBudgets.groceries?.weeklyTarget).toBe(-600); // Changed
      expect(state.budgetPlan?.categoryBudgets.groceries?.rolloverEnabled).toBe(true); // Changed

      // Verify localStorage persistence
      const stored = localStorage.getItem('budget-state');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.budgetPlan.categoryBudgets.dining).toEqual(initial.categoryBudgets.dining);
      expect(parsed.budgetPlan.categoryBudgets.groceries.weeklyTarget).toBe(-600);
    });

    it('simulates page reload and verifies budget plan persistence', async () => {
      await import('./main');

      // Set up budget plan
      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -100, rolloverEnabled: true },
          dining: { weeklyTarget: -50, rolloverEnabled: false },
        },
        lastModified: new Date().toISOString(),
      };
      StateManager.save({ budgetPlan, planningMode: true });

      // Simulate page reload by clearing in-memory state
      // In a real app, this would be a full page refresh
      // We verify that localStorage.getItem still works and contains correct data
      const stored = localStorage.getItem('budget-state');
      expect(stored).toBeTruthy();

      // Load from localStorage (simulating fresh page load)
      const loaded = StateManager.load();
      expect(loaded.budgetPlan).toBeTruthy();
      expect(loaded.budgetPlan?.categoryBudgets.groceries).toEqual(
        budgetPlan.categoryBudgets.groceries
      );
      expect(loaded.budgetPlan?.categoryBudgets.dining).toEqual(budgetPlan.categoryBudgets.dining);
    });

    it('migrates from null to first budget plan', async () => {
      await import('./main');

      // Start with no budget plan (fresh state)
      StateManager.save({ budgetPlan: null, planningMode: true });

      // Verify initial state
      let state = StateManager.load();
      expect(state.budgetPlan).toBeNull();

      // Save first budget plan
      const firstPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -100, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };

      const event = new CustomEvent('budget:plan-save', {
        detail: { budgetPlan: firstPlan },
      });
      document.dispatchEvent(event);

      // Verify migration from null to first plan
      state = StateManager.load();
      expect(state.budgetPlan).toBeTruthy();
      expect(state.budgetPlan?.categoryBudgets.groceries).toEqual(
        firstPlan.categoryBudgets.groceries
      );

      // Verify localStorage persistence
      const stored = localStorage.getItem('budget-state');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.budgetPlan.categoryBudgets.groceries).toEqual(
        firstPlan.categoryBudgets.groceries
      );
    });
  });

  describe('Budget Plan Cancel Event Flow', () => {
    it('dispatching budget:plan-cancel exits planning mode', async () => {
      await import('./main');

      StateManager.save({ planningMode: true });

      const event = new CustomEvent('budget:plan-cancel', {
        detail: {},
      });
      document.dispatchEvent(event);

      const state = StateManager.load();
      expect(state.planningMode).toBe(false);
    });
  });

  describe('Error Handling in wrapEventHandler', () => {
    it('localStorage errors are caught and display error banner', async () => {
      await import('./main');

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage error');
      });

      const event = new CustomEvent('budget:category-toggle', {
        detail: { category: 'groceries' as Category },
      });

      // Should not throw
      expect(() => document.dispatchEvent(event)).not.toThrow();

      // Should show error banner
      const errorBanner = document.querySelector('[class*="bg-"]');
      expect(errorBanner).toBeTruthy();
    });

    it('storage quota errors show warning banner from StateManager', async () => {
      await import('./main');

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });

      const event = new CustomEvent('budget:vacation-toggle', {
        detail: { showVacation: false },
      });
      document.dispatchEvent(event);

      const errorBanner = document.querySelector('[class*="bg-"]');
      expect(errorBanner).toBeTruthy();
      // StateManager.save() shows a warning (not error) when budgetPlan is not in state
      expect(errorBanner?.textContent).toContain('Failed to save your preferences');
    });
  });
});
