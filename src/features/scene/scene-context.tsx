"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { useStore } from "zustand";

import { buildRotationOptions } from "../photo/photo-views";
import {
  createSceneStore,
  type SceneStore,
  type SceneStoreState,
} from "./scene-store";

const SceneStoreContext = createContext<SceneStore | null>(null);

export function SceneStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: SceneStore;
}) {
  const [sceneStore] = useState(
    () =>
      store ??
      // The registered photo views decide which orientations the solver may use.
      createSceneStore(undefined, { rotationOptions: buildRotationOptions }),
  );

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
