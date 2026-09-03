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

export interface SceneCommitEvent {
  cause: "replace" | "move";
  revision: number;
  scene: Scene;
}

export interface SceneStoreOptions {
  onCommit?: (event: SceneCommitEvent) => void;
}

export interface SceneStoreState {
  scene: Scene;
  canonicalSeed: Scene;
  history: Scene[];
  toolMode: ToolMode;
  isTransforming: boolean;
  resetVersion: number;
  stateVersion: number;
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

function notifyCommit(
  observer: SceneStoreOptions["onCommit"],
  event: SceneCommitEvent,
) {
  try {
    observer?.({
      ...event,
      scene: SceneSchema.parse(structuredClone(event.scene)),
    });
  } catch {
    // A derived-render observer cannot affect canonical command success.
  }
}

export function createSceneStore(
  seed: Scene = createDemoScene(),
  options: SceneStoreOptions = {},
): SceneStore {
  const canonicalSeed = cloneScene(seed);

  return createStore<SceneStoreState>()((set, get) => {
    function installCommit(
      scene: Scene,
      previousScene: Scene,
      cause: SceneCommitEvent["cause"] | null,
    ) {
      set((state) => ({
        scene,
        history: [...state.history, cloneScene(previousScene)].slice(
          -HISTORY_LIMIT,
        ),
        stateVersion: state.stateVersion + 1,
      }));
      if (cause !== null) {
        notifyCommit(options.onCommit, {
          cause,
          revision: scene.revision,
          scene,
        });
      }
    }

    return {
      scene: cloneScene(canonicalSeed),
      canonicalSeed,
      history: [],
      toolMode: "select",
      isTransforming: false,
      resetVersion: 0,
      stateVersion: 1,

      selectObject(objectId) {
        set((state) => {
          if (
            objectId !== null &&
            !state.scene.objects.some((object) => object.id === objectId)
          ) {
            return state;
          }
          if (state.scene.selectedObjectId === objectId) return state;

          const scene = cloneScene(state.scene);
          scene.selectedObjectId = objectId;
          return { scene, stateVersion: state.stateVersion + 1 };
        });
      },

      setToolMode(toolMode) {
        set({ toolMode });
      },

      setTransforming(isTransforming) {
        set({ isTransforming });
      },

      applyCommand(request) {
        const applied = applySceneCommand(get().scene, request);
        if (!applied.ok) return applied;

        const cause =
          request.command.type === "replace" || request.command.type === "move"
            ? request.command.type
            : null;
        installCommit(applied.scene, applied.previousScene, cause);
        return applied;
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
        const currentScene = get().scene;
        const history = get().history;
        const previousScene = history.at(-1);
        if (!previousScene) return false;

        const restoredScene = cloneScene(previousScene);
        if (
          currentScene.selectedObjectId === null ||
          restoredScene.objects.some(
            ({ id }) => id === currentScene.selectedObjectId,
          )
        ) {
          restoredScene.selectedObjectId = currentScene.selectedObjectId;
        }

        set((state) => ({
          scene: restoredScene,
          history: history.slice(0, -1),
          isTransforming: false,
          stateVersion: state.stateVersion + 1,
        }));
        return true;
      },

      reset() {
        set((state) => ({
          scene: cloneScene(canonicalSeed),
          history: [],
          toolMode: "select",
          isTransforming: false,
          resetVersion: state.resetVersion + 1,
          stateVersion: state.stateVersion + 1,
        }));
      },
    };
  });
}
