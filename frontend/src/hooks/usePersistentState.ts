/**
 * Custom React hook for persistent state management
 * Stores and retrieves component state from localStorage
 */

import { useState, useEffect, useCallback } from "react";

/**
 * usePersistentState - A custom hook that persists state to localStorage
 *
 * @param key - The localStorage key to use
 * @param initialValue - The initial value if nothing is in localStorage
 * @returns [value, setValue] - Same as useState but persisted to localStorage
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  // State to store the value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      // Get from local storage by key
      const item =
        typeof window !== "undefined" ? window.localStorage.getItem(key) : null;

      // Parse stored json or if none return initialValue
      if (item) {
        return JSON.parse(item);
      }
      return initialValue;
    } catch (error) {
      console.error(`Error reading from localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that persists to localStorage
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        // Allow value to be a function so we have same API as useState
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;

        // Save state
        setStoredValue(valueToStore);

        // Save to localStorage
        if (typeof window !== "undefined") {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        console.error(`Error writing to localStorage key "${key}":`, error);
      }
    },
    [key, storedValue],
  );

  return [storedValue, setValue];
}

/**
 * useSessionStorage - Similar to usePersistentState but uses sessionStorage
 * State persists only for the current browser tab/window session
 */
export function useSessionStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(key)
          : null;
      if (item) {
        return JSON.parse(item);
      }
      return initialValue;
    } catch (error) {
      console.error(`Error reading from sessionStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        console.error(`Error writing to sessionStorage key "${key}":`, error);
      }
    },
    [key, storedValue],
  );

  return [storedValue, setValue];
}

/**
 * Clear all stored state for a given prefix
 * Useful for cleanup on logout or navigation
 */
export function clearStorageByPrefix(prefix: string, useSession = false) {
  try {
    const storage = useSession ? sessionStorage : localStorage;
    const keys = Object.keys(storage);

    keys.forEach((key) => {
      if (key.startsWith(prefix)) {
        storage.removeItem(key);
      }
    });
  } catch (error) {
    console.error(`Error clearing storage with prefix "${prefix}":`, error);
  }
}
