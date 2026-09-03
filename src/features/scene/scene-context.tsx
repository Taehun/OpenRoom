"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { useStore } from "zustand";

import {
  createSceneStore,
  type SceneStore,
  type SceneStoreState,
} from "./scene-store";

const SceneStoreContext = createContext<SceneStore | null>(null);

/**
 * Provides the Scene store to everything below it.
 *
 * The store is resolved once, when the provider mounts, in a fixed order: an
 * explicit `store` prop always wins, so tests and fixtures keep driving a
 * scene they own; with no prop a nested provider reuses the store from the
 * provider above it, which is how the root layout's store survives a soft
 * navigation between `/` and `/demo` remounting the workspace; only a
 * provider with neither a prop nor an ancestor creates a store.
 */
export function SceneStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: SceneStore;
}) {
  const inherited = useContext(SceneStoreContext);
  const [sceneStore] = useState(() => store ?? inherited ?? createSceneStore());

  return (
    <SceneStoreContext.Provider value={sceneStore}>
      {children}
    </SceneStoreContext.Provider>
  );
}

export function useSceneStoreApi() {
  const store = useContext(SceneStoreContext);
  if (!store) {
    throw new Error("useSceneStoreApi must be used inside SceneStoreProvider");
  }
  return store;
}

export function useSceneStore<T>(selector: (state: SceneStoreState) => T): T {
  return useStore(useSceneStoreApi(), selector);
}
