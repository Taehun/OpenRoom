import { createStore, type StoreApi } from "zustand/vanilla";

import { createDemoScene } from "../../demo/demo-scene";
import { proposeNaturalPlacement } from "../placement/natural-placement";
import type { PlacementFailureReason } from "../placement/placement-types";
import { validateAndApplyPlacement } from "./natural-placement-command";
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

export type PlacementNoticeKind =
  | "auto-arranged"
  | "auto-retained"
  | "manual-arranged"
  | "manual-unchanged"
  | "manual-failed";

export interface PlacementNotice {
  id: number;
  kind: PlacementNoticeKind;
  message: string;
}

export interface SceneCommitEvent {
  cause: "replace" | "move";
  revision: number;
  scene: Scene;
}

export interface SceneStoreOptions {
  onCommit?: (event: SceneCommitEvent) => void;
  proposePlacement?: typeof proposeNaturalPlacement;
}

export type ArrangeNaturallyResult =
  | { ok: true; changed: true; scene: Scene }
  | { ok: true; changed: false; scene: Scene }
  | {
      ok: false;
      changed: false;
      scene: Scene;
      reason: PlacementFailureReason;
    };

export interface SceneStoreState {
  scene: Scene;
  canonicalSeed: Scene;
  history: Scene[];
  toolMode: ToolMode;
  isTransforming: boolean;
  resetVersion: number;
  stateVersion: number;
  placementNotice: PlacementNotice | null;
  selectObject(objectId: string | null): void;
  setToolMode(mode: ToolMode): void;
  setTransforming(isTransforming: boolean): void;
  applyCommand(request: CommandRequest): CommandResult;
  commitTransform(
    objectId: string,
    position: Vec3,
    rotationY?: number,
  ): CommandResult;
  arrangeNaturally(): ArrangeNaturallyResult;
  undo(): boolean;
  reset(): void;
}

export type SceneStore = StoreApi<SceneStoreState>;

function cloneScene(scene: Scene) {
  return SceneSchema.parse(structuredClone(scene));
}

function completesUnlockedRedesign(
  before: Scene,
  after: Scene,
  request: CommandRequest,
) {
  return (
    request.actor === "agent" &&
    request.command.type === "replace" &&
    before.objects.some(
      ({ locked, source }) => !locked && source === "placeholder",
    ) &&
    !after.objects.some(
      ({ locked, source }) => !locked && source === "placeholder",
    ) &&
    after.objects.some(({ locked, source }) => !locked && source === "product")
  );
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
  const proposePlacement = options.proposePlacement ?? proposeNaturalPlacement;
  let nextNoticeId = 1;

  function notice(
    kind: PlacementNoticeKind,
    message: string,
  ): PlacementNotice {
    return { id: nextNoticeId++, kind, message };
  }

  return createStore<SceneStoreState>()((set, get) => {
    function installCommit(
      scene: Scene,
      previousScene: Scene,
      cause: SceneCommitEvent["cause"] | null,
      placementNotice?: PlacementNotice,
    ) {
      set((state) => ({
        scene,
        history: [...state.history, cloneScene(previousScene)].slice(
          -HISTORY_LIMIT,
        ),
        stateVersion: state.stateVersion + 1,
        ...(placementNotice === undefined ? {} : { placementNotice }),
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
      placementNotice: null,

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
        const before = get().scene;
        const applied = applySceneCommand(before, request);
        if (!applied.ok) return applied;

        let result: Extract<CommandResult, { ok: true }> = applied;
        let placementNotice: PlacementNotice | undefined;
        if (completesUnlockedRedesign(before, applied.scene, request)) {
          try {
            const placement = validateAndApplyPlacement(
              applied.scene,
              proposePlacement(applied.scene),
            );
            if (placement.ok && placement.changed) {
              result = {
                ...applied,
                scene: placement.scene,
                placementOutcome: { kind: "auto-arranged" },
              };
              placementNotice = notice("auto-arranged", "Redesign arranged");
            } else {
              result = {
                ...applied,
                placementOutcome: { kind: "auto-retained" },
              };
              placementNotice = notice(
                "auto-retained",
                "Redesign updated; placement retained",
              );
            }
          } catch {
            result = {
              ...applied,
              placementOutcome: { kind: "auto-retained" },
            };
            placementNotice = notice(
              "auto-retained",
              "Redesign updated; placement retained",
            );
          }
        }

        const cause =
          request.command.type === "replace" || request.command.type === "move"
            ? request.command.type
            : null;
        installCommit(
          result.scene,
          result.previousScene,
          cause,
          placementNotice,
        );
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

      arrangeNaturally() {
        const current = get().scene;
        let proposal;
        try {
          proposal = proposePlacement(current);
        } catch {
          const placementNotice = notice(
            "manual-failed",
            "Could not improve placement; the room was left unchanged",
          );
          set({ placementNotice });
          return {
            ok: false,
            changed: false,
            scene: current,
            reason: "unexpected",
          };
        }

        const placement = validateAndApplyPlacement(current, proposal);
        if (!placement.ok) {
          const placementNotice = notice(
            "manual-failed",
            "Could not improve placement; the room was left unchanged",
          );
          set({ placementNotice });
          return {
            ok: false,
            changed: false,
            scene: current,
            reason: placement.reason,
          };
        }
        if (!placement.changed) {
          const placementNotice = notice(
            "manual-unchanged",
            "Current placement is already the safest option",
          );
          set({ placementNotice });
          return { ok: true, changed: false, scene: current };
        }

        const nextScene = cloneScene(placement.scene);
        nextScene.revision += 1;
        const committedScene = cloneScene(nextScene);
        installCommit(
          committedScene,
          current,
          "move",
          notice("manual-arranged", "Placement improved"),
        );
        return { ok: true, changed: true, scene: committedScene };
      },

      undo() {
        const currentScene = get().scene;
        const history = get().history;
        const previousScene = history.at(-1);
        if (!previousScene) {
          if (get().placementNotice !== null) set({ placementNotice: null });
          return false;
        }

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
          placementNotice: null,
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
          placementNotice: null,
        }));
      },
    };
  });
}
