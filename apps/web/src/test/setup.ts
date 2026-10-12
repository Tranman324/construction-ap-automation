import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5_000 });

// ─── jsdom polyfills required by Radix UI in test environments ──────────────

// Radix Select / Combobox calls these pointer capture methods on pointerdown.
// jsdom does not implement them, so we stub them out.
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

// Radix UI calls scrollIntoView when opening Select menus in some versions.
window.HTMLElement.prototype.scrollIntoView = () => undefined;

class ResizeObserverMock implements ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

class TestStorage implements Storage {
	private readonly store = new Map<string, string>();

	get length(): number {
		return this.store.size;
	}

	clear(): void {
		this.store.clear();
	}

	getItem(key: string): string | null {
		return this.store.get(key) ?? null;
	}

	key(index: number): string | null {
		return Array.from(this.store.keys())[index] ?? null;
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}
}

function needsStoragePolyfill(storage: Storage | undefined): boolean {
	return (
		!storage ||
		typeof storage.getItem !== "function" ||
		typeof storage.setItem !== "function" ||
		typeof storage.removeItem !== "function" ||
		typeof storage.clear !== "function"
	);
}

if (needsStoragePolyfill(window.localStorage)) {
	const localStorageMock = new TestStorage();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: localStorageMock,
	});
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: localStorageMock,
	});
}
