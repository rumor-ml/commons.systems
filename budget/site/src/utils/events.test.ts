import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dispatchBudgetEvent } from './events';

describe('dispatchBudgetEvent', () => {
  let eventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    eventListener = vi.fn();
  });

  afterEach(() => {
    // Clean up event listeners to prevent test pollution
    document.removeEventListener('test-event', eventListener);
    document.removeEventListener('category:toggle', eventListener);
    document.removeEventListener('week:navigate', eventListener);
  });

  describe('basic event dispatch', () => {
    it('should dispatch custom event on document', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event');

      expect(eventListener).toHaveBeenCalledTimes(1);
    });

    it('should dispatch event with correct event name', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event');

      expect(eventListener).toHaveBeenCalled();
      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('test-event');
    });

    it('should dispatch event without detail when detail is undefined', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event');

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      // CustomEvent sets detail to null when undefined is passed
      expect(event.detail).toBeNull();
    });
  });

  describe('event detail payload', () => {
    it('should include detail payload when provided', () => {
      const testDetail = { category: 'groceries', hidden: true };
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', testDetail);

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual(testDetail);
    });

    it('should support string detail', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', 'string-detail');

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toBe('string-detail');
    });

    it('should support number detail', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', 42);

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toBe(42);
    });

    it('should support boolean detail', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', true);

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toBe(true);
    });

    it('should support array detail', () => {
      const arrayDetail = ['item1', 'item2', 'item3'];
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', arrayDetail);

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual(arrayDetail);
    });

    it('should support nested object detail', () => {
      const nestedDetail = {
        user: { id: 123, name: 'Test' },
        metadata: { timestamp: Date.now() },
      };
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', nestedDetail);

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual(nestedDetail);
    });
  });

  describe('event bubbling', () => {
    it('should set bubbles property to true', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event');

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.bubbles).toBe(true);
    });

    it('should bubble from child elements to document', () => {
      const childElement = document.createElement('div');
      document.body.appendChild(childElement);

      const childListener = vi.fn();
      const documentListener = vi.fn();

      childElement.addEventListener('test-event', childListener);
      document.addEventListener('test-event', documentListener);

      // Dispatch from child element using native dispatchEvent
      childElement.dispatchEvent(
        new CustomEvent('test-event', {
          detail: { source: 'child' },
          bubbles: true,
        })
      );

      expect(childListener).toHaveBeenCalledTimes(1);
      expect(documentListener).toHaveBeenCalledTimes(1);

      // Clean up
      document.body.removeChild(childElement);
      document.removeEventListener('test-event', documentListener);
    });

    it('should allow multiple listeners to receive same event', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      document.addEventListener('test-event', listener1);
      document.addEventListener('test-event', listener2);

      dispatchBudgetEvent('test-event', { data: 'shared' });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      const event1 = listener1.mock.calls[0][0] as CustomEvent;
      const event2 = listener2.mock.calls[0][0] as CustomEvent;
      expect(event1.detail).toEqual({ data: 'shared' });
      expect(event2.detail).toEqual({ data: 'shared' });

      // Clean up
      document.removeEventListener('test-event', listener1);
      document.removeEventListener('test-event', listener2);
    });
  });

  describe('real-world event patterns', () => {
    it('should dispatch category:toggle event with category detail', () => {
      document.addEventListener('category:toggle', eventListener);

      dispatchBudgetEvent('category:toggle', { category: 'groceries', hidden: true });

      expect(eventListener).toHaveBeenCalledTimes(1);
      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ category: 'groceries', hidden: true });
    });

    it('should dispatch week:navigate event with direction detail', () => {
      document.addEventListener('week:navigate', eventListener);

      dispatchBudgetEvent('week:navigate', { direction: 'next' });

      expect(eventListener).toHaveBeenCalledTimes(1);
      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ direction: 'next' });
    });

    it('should dispatch budget:update event with budget plan detail', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -500, rolloverEnabled: true },
        },
        lastModified: new Date().toISOString(),
      };
      document.addEventListener('budget:update', eventListener);

      dispatchBudgetEvent('budget:update', budgetPlan);

      expect(eventListener).toHaveBeenCalledTimes(1);
      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual(budgetPlan);

      document.removeEventListener('budget:update', eventListener);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string event name', () => {
      document.addEventListener('', eventListener);

      dispatchBudgetEvent('');

      expect(eventListener).toHaveBeenCalledTimes(1);

      document.removeEventListener('', eventListener);
    });

    it('should handle special characters in event name', () => {
      const specialEventName = 'event:with-special_chars.123';
      document.addEventListener(specialEventName, eventListener);

      dispatchBudgetEvent(specialEventName);

      expect(eventListener).toHaveBeenCalledTimes(1);

      document.removeEventListener(specialEventName, eventListener);
    });

    it('should handle null detail (type-wise should be object | undefined)', () => {
      document.addEventListener('test-event', eventListener);

      // TypeScript allows null to be passed as detail (it's an object)
      dispatchBudgetEvent('test-event', null as any);

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toBeNull();
    });

    it('should handle dispatching same event multiple times', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', { count: 1 });
      dispatchBudgetEvent('test-event', { count: 2 });
      dispatchBudgetEvent('test-event', { count: 3 });

      expect(eventListener).toHaveBeenCalledTimes(3);

      const event1 = eventListener.mock.calls[0][0] as CustomEvent;
      const event2 = eventListener.mock.calls[1][0] as CustomEvent;
      const event3 = eventListener.mock.calls[2][0] as CustomEvent;

      expect(event1.detail).toEqual({ count: 1 });
      expect(event2.detail).toEqual({ count: 2 });
      expect(event3.detail).toEqual({ count: 3 });
    });
  });

  describe('timing and synchronicity', () => {
    it('should dispatch event synchronously', () => {
      let listenerCalled = false;

      document.addEventListener('test-event', () => {
        listenerCalled = true;
      });

      dispatchBudgetEvent('test-event');

      // Listener should have been called synchronously
      expect(listenerCalled).toBe(true);
    });

    it('should execute listeners in registration order', () => {
      const callOrder: number[] = [];

      document.addEventListener('test-event', () => callOrder.push(1));
      document.addEventListener('test-event', () => callOrder.push(2));
      document.addEventListener('test-event', () => callOrder.push(3));

      dispatchBudgetEvent('test-event');

      expect(callOrder).toEqual([1, 2, 3]);
    });
  });

  describe('event object properties', () => {
    it('should create CustomEvent instance', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event');

      const event = eventListener.mock.calls[0][0];
      expect(event).toBeInstanceOf(CustomEvent);
    });

    it('should have correct event properties', () => {
      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent('test-event', { data: 'test' });

      const event = eventListener.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('test-event');
      expect(event.bubbles).toBe(true);
      expect(event.cancelable).toBe(false); // CustomEvent default
      expect(event.detail).toEqual({ data: 'test' });
    });
  });

  describe('type safety', () => {
    it('should preserve detail type information', () => {
      interface TestDetail {
        id: number;
        name: string;
      }

      const testDetail: TestDetail = { id: 123, name: 'Test' };

      document.addEventListener('test-event', eventListener);

      dispatchBudgetEvent<TestDetail>('test-event', testDetail);

      const event = eventListener.mock.calls[0][0] as CustomEvent<TestDetail>;
      expect(event.detail.id).toBe(123);
      expect(event.detail.name).toBe('Test');
    });
  });
});
