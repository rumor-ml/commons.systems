import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager, BudgetState } from './state';
import { CATEGORIES } from '../islands/constants';

describe('StateManager', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  describe('load() - Default State', () => {
    it('returns default state when localStorage is empty', () => {
      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });

    it('returns default state when localStorage returns null', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });
  });

  describe('load() - Error Recovery', () => {
    it('returns default state when JSON is corrupted', () => {
      localStorage.setItem('budget-state', '{invalid json');

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });

    it('returns default state when JSON parse throws', () => {
      localStorage.setItem('budget-state', 'not json at all');

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });

    it('returns default state when localStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });
  });

  describe('load() - Migration from selectedCategory', () => {
    it('migrates old selectedCategory to hiddenCategories', () => {
      const oldState = {
        selectedCategory: 'groceries',
        showVacation: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      // All categories except 'groceries' should be hidden
      const expectedHidden = CATEGORIES.filter((cat) => cat !== 'groceries');
      expect(state.hiddenCategories).toEqual(expectedHidden);
      expect(state.showVacation).toBe(false);
    });

    it('migrates and preserves showVacation when present', () => {
      const oldState = {
        selectedCategory: 'dining',
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      expect(state.showVacation).toBe(true);
    });

    it('defaults showVacation to true when missing during migration', () => {
      const oldState = {
        selectedCategory: 'housing',
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      expect(state.showVacation).toBe(true);
    });

    it('handles null selectedCategory during migration', () => {
      const oldState = {
        selectedCategory: null,
        showVacation: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      // Should not trigger migration path when selectedCategory is null
      expect(state.hiddenCategories).toEqual([]);
    });
  });

  describe('load() - hiddenCategories Validation', () => {
    it('filters out invalid categories from hiddenCategories', () => {
      const storedState = {
        hiddenCategories: ['groceries', 'invalid-category', 'dining', 'fake-cat'],
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual(['groceries', 'dining']);
    });

    it('preserves valid categories in hiddenCategories', () => {
      const storedState = {
        hiddenCategories: ['income', 'housing', 'utilities'],
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual(['income', 'housing', 'utilities']);
    });

    it('returns empty array when hiddenCategories is not an array', () => {
      const storedState = {
        hiddenCategories: 'not-an-array',
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual([]);
    });

    it('returns empty array when hiddenCategories is missing', () => {
      const storedState = {
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual([]);
    });
  });

  describe('load() - budgetPlan Validation', () => {
    it('preserves valid budgetPlan structure', () => {
      const validBudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
          dining: { weeklyTarget: 50, rolloverEnabled: false },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: validBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan).toEqual(validBudgetPlan);
    });

    it('rejects budgetPlan with invalid weeklyTarget (non-number)', () => {
      const invalidBudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: '100', rolloverEnabled: true }, // string instead of number
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: invalidBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      // Invalid entry should be filtered out
      expect(state.budgetPlan?.categoryBudgets).toEqual({});
    });

    it('rejects budgetPlan with invalid rolloverEnabled (non-boolean)', () => {
      const invalidBudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: 'true' }, // string instead of boolean
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: invalidBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      // Invalid entry should be filtered out
      expect(state.budgetPlan?.categoryBudgets).toEqual({});
    });

    it('returns null budgetPlan when categoryBudgets is missing', () => {
      const invalidBudgetPlan = {
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: invalidBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan).toBeNull();
    });

    it('filters out invalid category keys from categoryBudgets', () => {
      const budgetPlanWithInvalidCat = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
          'invalid-category': { weeklyTarget: 50, rolloverEnabled: false },
          dining: { weeklyTarget: 75, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: budgetPlanWithInvalidCat,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan?.categoryBudgets).toEqual({
        groceries: { weeklyTarget: 100, rolloverEnabled: true },
        dining: { weeklyTarget: 75, rolloverEnabled: true },
      });
    });

    it('defaults lastModified when missing', () => {
      const budgetPlanNoTimestamp = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
      };
      const storedState = {
        budgetPlan: budgetPlanNoTimestamp,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan?.lastModified).toBeDefined();
      // Should be a valid ISO timestamp
      expect(new Date(state.budgetPlan!.lastModified).toString()).not.toBe('Invalid Date');
    });

    it('returns null budgetPlan when budgetPlan is not an object', () => {
      const storedState = {
        budgetPlan: 'not-an-object',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan).toBeNull();
    });
  });

  describe('load() - viewGranularity Validation', () => {
    it('preserves valid "week" granularity', () => {
      const storedState = {
        viewGranularity: 'week',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('week');
    });

    it('preserves valid "month" granularity', () => {
      const storedState = {
        viewGranularity: 'month',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('month');
    });

    it('defaults to "month" for invalid granularity', () => {
      const storedState = {
        viewGranularity: 'year',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('month');
    });

    it('defaults to "month" when viewGranularity is missing', () => {
      const storedState = {};
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('month');
    });
  });

  describe('load() - selectedWeek Validation', () => {
    it('preserves valid ISO week format (2025-W01)', () => {
      const storedState = {
        selectedWeek: '2025-W01',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBe('2025-W01');
    });

    it('preserves valid ISO week format (2025-W52)', () => {
      const storedState = {
        selectedWeek: '2025-W52',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBe('2025-W52');
    });

    it('returns null for invalid week format (missing W)', () => {
      const storedState = {
        selectedWeek: '2025-01',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });

    it('returns null for invalid week format (wrong pattern)', () => {
      const storedState = {
        selectedWeek: 'Week-01-2025',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });

    it('returns null when selectedWeek is not a string', () => {
      const storedState = {
        selectedWeek: 12345,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });

    it('returns null when selectedWeek is missing', () => {
      const storedState = {};
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });
  });

  describe('load() - planningMode Validation', () => {
    it('preserves planningMode when true', () => {
      const storedState = {
        planningMode: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(true);
    });

    it('preserves planningMode when false', () => {
      const storedState = {
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(false);
    });

    it('defaults to false when planningMode is missing', () => {
      const storedState = {};
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(false);
    });

    it('defaults to false when planningMode is not boolean', () => {
      const storedState = {
        planningMode: 'true',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(false);
    });
  });

  describe('save() - Success', () => {
    it('saves partial state update', () => {
      const initialState: BudgetState = {
        hiddenCategories: ['groceries'],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      const updated = StateManager.save({ planningMode: true });

      expect(updated.planningMode).toBe(true);
      expect(updated.hiddenCategories).toEqual(['groceries']);

      // Verify it was persisted
      const loaded = StateManager.load();
      expect(loaded.planningMode).toBe(true);
      expect(loaded.hiddenCategories).toEqual(['groceries']);
    });

    it('merges with existing state', () => {
      const initialState: BudgetState = {
        hiddenCategories: ['dining', 'entertainment'],
        showVacation: false,
        budgetPlan: null,
        viewGranularity: 'week',
        selectedWeek: '2025-W05',
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      const updated = StateManager.save({
        hiddenCategories: ['income'],
        viewGranularity: 'month',
      });

      expect(updated).toEqual({
        hiddenCategories: ['income'],
        showVacation: false,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: '2025-W05',
        planningMode: false,
      });
    });

    it('returns updated state after save', () => {
      const updated = StateManager.save({
        showVacation: false,
        selectedWeek: '2025-W10',
      });

      expect(updated.showVacation).toBe(false);
      expect(updated.selectedWeek).toBe('2025-W10');
    });
  });

  describe('save() - Error Recovery', () => {
    it('returns merged state when localStorage.setItem throws (quota exceeded)', () => {
      const initialState: BudgetState = {
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const updated = StateManager.save({ planningMode: true });

      // Should still return updated in-memory state
      expect(updated.planningMode).toBe(true);
      expect(updated.hiddenCategories).toEqual([]);
    });

    it('handles save failure gracefully without crashing', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage unavailable');
      });

      // Should not throw
      expect(() => {
        StateManager.save({ showVacation: false });
      }).not.toThrow();
    });

    it('returns updated state even when persistence fails', () => {
      const initialState: BudgetState = {
        hiddenCategories: ['income'],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Write failed');
      });

      const updated = StateManager.save({
        hiddenCategories: ['groceries', 'dining'],
        viewGranularity: 'week',
      });

      expect(updated.hiddenCategories).toEqual(['groceries', 'dining']);
      expect(updated.viewGranularity).toBe('week');
      expect(updated.showVacation).toBe(true); // Preserved from initial state
    });
  });

  describe('Integration - Complex Scenarios', () => {
    it('handles multiple save/load cycles correctly', () => {
      // First save
      StateManager.save({ hiddenCategories: ['groceries'] });
      let loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual(['groceries']);

      // Second save
      StateManager.save({ planningMode: true });
      loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual(['groceries']);
      expect(loaded.planningMode).toBe(true);

      // Third save
      StateManager.save({ viewGranularity: 'week', selectedWeek: '2025-W08' });
      loaded = StateManager.load();
      expect(loaded.viewGranularity).toBe('week');
      expect(loaded.selectedWeek).toBe('2025-W08');
      expect(loaded.planningMode).toBe(true);
      expect(loaded.hiddenCategories).toEqual(['groceries']);
    });

    it('recovers from corrupted state and allows new saves', () => {
      // Corrupt the state
      localStorage.setItem('budget-state', 'corrupted{data');

      // Load returns default state
      let loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual([]);

      // Save new state
      StateManager.save({ hiddenCategories: ['dining'], planningMode: true });

      // Load again - should have the saved state
      loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual(['dining']);
      expect(loaded.planningMode).toBe(true);
    });

    it('handles partial budgetPlan updates', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };

      StateManager.save({ budgetPlan });

      const loaded = StateManager.load();
      expect(loaded.budgetPlan).toEqual(budgetPlan);

      // Update with new budget plan
      const updatedPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
          dining: { weeklyTarget: 50, rolloverEnabled: false },
        },
        lastModified: '2025-01-10T12:00:00Z',
      };

      StateManager.save({ budgetPlan: updatedPlan });

      const reloaded = StateManager.load();
      expect(reloaded.budgetPlan).toEqual(updatedPlan);
    });
  });

  describe('Banner Display - Warning Banner (load() failures)', () => {
    beforeEach(() => {
      document.body.textContent = '';
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('displays warning banner when load() fails with JSON parse error', () => {
      localStorage.setItem('budget-state', '{invalid json}');

      StateManager.load();

      const banner = document.querySelector('.bg-warning');
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toContain('Failed to load your saved preferences');
    });

    it('warning banner includes correct icon and message', () => {
      localStorage.setItem('budget-state', 'corrupt');

      StateManager.load();

      const banner = document.querySelector('.bg-warning');
      const icon = banner?.querySelector('span');
      const text = banner?.querySelector('p');

      expect(icon?.textContent).toBe('⚠️');
      expect(text?.textContent).toBe(
        'Failed to load your saved preferences. Using defaults. If you are in private browsing mode, your changes will not be saved.'
      );
    });

    it('warning banner has close button that removes banner', () => {
      localStorage.setItem('budget-state', 'corrupt');

      StateManager.load();

      const banner = document.querySelector('.bg-warning');
      const closeBtn = banner?.querySelector('button');
      expect(closeBtn).toBeTruthy();
      expect(closeBtn?.textContent).toBe('✕');

      closeBtn?.dispatchEvent(new Event('click'));

      expect(document.querySelector('.bg-warning')).toBeNull();
    });

    it('warning banner auto-dismisses after 10 seconds', () => {
      localStorage.setItem('budget-state', 'corrupt');

      StateManager.load();

      expect(document.querySelector('.bg-warning')).toBeTruthy();

      vi.advanceTimersByTime(9000);
      expect(document.querySelector('.bg-warning')).toBeTruthy();

      vi.advanceTimersByTime(1000);
      expect(document.querySelector('.bg-warning')).toBeNull();
    });

    it('warning banner has correct CSS classes for styling', () => {
      localStorage.setItem('budget-state', 'corrupt');

      StateManager.load();

      const banner = document.querySelector('.bg-warning');
      expect(banner?.className).toContain('fixed');
      expect(banner?.className).toContain('top-4');
      expect(banner?.className).toContain('z-50');
      expect(banner?.className).toContain('bg-warning');
      expect(banner?.className).toContain('text-white');
    });
  });

  describe('Banner Display - Error Banner (save() failures with budgetPlan)', () => {
    beforeEach(() => {
      document.body.textContent = '';
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('displays error banner when save() fails with budgetPlan in state', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      StateManager.save({ budgetPlan });

      const banner = document.querySelector('.bg-error');
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toContain('Failed to save your budget plan!');
    });

    it('error banner includes correct icon and critical message', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage full');
      });

      StateManager.save({ budgetPlan });

      const banner = document.querySelector('.bg-error');
      const icon = banner?.querySelector('span');
      const text = banner?.querySelector('p');

      expect(icon?.textContent).toBe('❌');
      expect(text?.textContent).toBe(
        'Failed to save your budget plan! Your changes will be lost on refresh. You may be in private browsing mode or your browser storage may be full.'
      );
    });

    it('error banner does NOT auto-dismiss', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      StateManager.save({ budgetPlan });

      expect(document.querySelector('.bg-error')).toBeTruthy();

      vi.advanceTimersByTime(10000);
      expect(document.querySelector('.bg-error')).toBeTruthy();

      vi.advanceTimersByTime(60000);
      expect(document.querySelector('.bg-error')).toBeTruthy();
    });

    it('error banner has close button that removes banner', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      StateManager.save({ budgetPlan });

      const banner = document.querySelector('.bg-error');
      const closeBtn = banner?.querySelector('button');
      expect(closeBtn).toBeTruthy();

      closeBtn?.dispatchEvent(new Event('click'));

      expect(document.querySelector('.bg-error')).toBeNull();
    });

    it('error banner has correct CSS classes for styling', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage full');
      });

      StateManager.save({ budgetPlan });

      const banner = document.querySelector('.bg-error');
      expect(banner?.className).toContain('fixed');
      expect(banner?.className).toContain('top-4');
      expect(banner?.className).toContain('z-50');
      expect(banner?.className).toContain('bg-error');
      expect(banner?.className).toContain('text-white');
    });
  });

  describe('Banner Display - Warning Banner (save() failures without budgetPlan)', () => {
    beforeEach(() => {
      document.body.textContent = '';
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('displays warning banner when save() fails without budgetPlan', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      StateManager.save({ showVacation: false });

      const banner = document.querySelector('.bg-warning');
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toContain('Failed to save your preferences');
    });

    it('warning banner for save() failure shows correct message', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage unavailable');
      });

      StateManager.save({ planningMode: true });

      const banner = document.querySelector('.bg-warning');
      const text = banner?.querySelector('p');

      expect(text?.textContent).toBe(
        'Failed to save your preferences. Changes may not persist on refresh.'
      );
    });

    it('warning banner for save() failure auto-dismisses after 10 seconds', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage error');
      });

      StateManager.save({ hiddenCategories: ['groceries'] });

      expect(document.querySelector('.bg-warning')).toBeTruthy();

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.bg-warning')).toBeNull();
    });
  });

  describe('Banner Display - Multiple Banners', () => {
    beforeEach(() => {
      document.body.textContent = '';
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('allows multiple warning banners to coexist in DOM', () => {
      localStorage.setItem('budget-state', 'corrupt1');
      StateManager.load();

      localStorage.setItem('budget-state', 'corrupt2');
      StateManager.load();

      const banners = document.querySelectorAll('.bg-warning');
      expect(banners.length).toBe(2);
    });

    it('each banner has independent close functionality', () => {
      localStorage.setItem('budget-state', 'corrupt1');
      StateManager.load();

      localStorage.setItem('budget-state', 'corrupt2');
      StateManager.load();

      const banners = document.querySelectorAll('.bg-warning');
      const firstCloseBtn = banners[0].querySelector('button');

      firstCloseBtn?.dispatchEvent(new Event('click'));

      expect(document.querySelectorAll('.bg-warning').length).toBe(1);
    });

    it('error banner and warning banner can coexist', () => {
      localStorage.setItem('budget-state', 'corrupt');
      StateManager.load();

      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage full');
      });
      StateManager.save({ budgetPlan });

      expect(document.querySelector('.bg-warning')).toBeTruthy();
      expect(document.querySelector('.bg-error')).toBeTruthy();
    });
  });
});
