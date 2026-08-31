import { createStore, type StoreApi } from "zustand/vanilla";

import { createDemoScene } from "../../demo/demo-scene";
import { applySceneCommand } from "./scene-commands";
import {
  SceneSchema,
  type CommandRequest,
  type CommandResult,
  type Scene,
  type ToolMode,
  type Vec3,
} from "./scene-schema";

const HISTORY_LIMIT = 30;

export interface SceneStoreState {
  scene: Scene;
  canonicalSeed: Scene;
  history: Scene[];
  toolMode: ToolMode;
  isTransforming: boolean;
  selectObject(objectId: string | null): void;
  setToolMode(mode: ToolMode): void;
  setTransforming(isTransforming: boolean): void;
  applyCommand(request: CommandRequest): CommandResult;
  commitTransform(
    objectId: string,
    position: Vec3,
    rotationY?: number,
  ): CommandResult;
  undo(): boolean;
  reset(): void;
}

export type SceneStore = StoreApi<SceneStoreState>;

function cloneScene(scene: Scene) {
  return SceneSchema.parse(structuredClone(scene));
}

export function createSceneStore(seed: Scene = createDemoScene()): SceneStore {
  const canonicalSeed = cloneScene(seed);

  return createStore<SceneStoreState>()((set, get) => ({
    scene: cloneScene(canonicalSeed),
    canonicalSeed,
    history: [],
    toolMode: "select",
    isTransforming: false,

    selectObject(objectId) {
      set((state) => {
        if (
          objectId !== null &&
          !state.scene.objects.some((object) => object.id === objectId)
        ) {
          return state;
        }

        const scene = cloneScene(state.scene);
        scene.selectedObjectId = objectId;
        return { scene };
      });
    },

    setToolMode(toolMode) {
      set({ toolMode });
    },

    setTransforming(isTransforming) {
      set({ isTransforming });
    },

    applyCommand(request) {
      const result = applySceneCommand(get().scene, request);
      if (!result.ok) return result;

      set((state) => ({
        scene: result.scene,
        history: [...state.history, cloneScene(result.previousScene)].slice(
          -HISTORY_LIMIT,
        ),
      }));
      return result;
    },

    commitTransform(objectId, position, rotationY) {
      return get().applyCommand({
        expectedRevision: get().scene.revision,
        actor: "human",
        command: {
          type: "move",
          objectId,
          position: { x: position[0], z: position[2] },
          rotationYDegrees:
            rotationY === undefined ? undefined : (rotationY * 180) / Math.PI,
        },
      });
    },

    undo() {
      const history = get().history;
      const previousScene = history.at(-1);
      if (!previousScene) return false;

      set({
        scene: cloneScene(previousScene),
        history: history.slice(0, -1),
        isTransforming: false,
      });
      return true;
    },

    reset() {
      set({
        scene: cloneScene(canonicalSeed),
        history: [],
        toolMode: "select",
        isTransforming: false,
      });
    },
  }));
}
