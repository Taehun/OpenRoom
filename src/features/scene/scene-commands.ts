import {
  SceneSchema,
  type CommandRequest,
  type CommandResult,
  type Scene,
  type SceneCommandErrorCode,
  type SceneObject,
  type Vec3,
} from "./scene-schema";

const ROOM_INSET_M = 0.1;

function failure(
  scene: Scene,
  code: SceneCommandErrorCode,
  message: string,
  retryable = false,
): CommandResult {
  return {
    ok: false,
    scene,
    error: { code, message, retryable },
  };
}

function findObject(scene: Scene, objectId: string) {
  return scene.objects.find((object) => object.id === objectId);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function clampPositionToRoom(
  scene: Scene,
  object: SceneObject,
  requested: { x: number; z: number },
): { position: Vec3; adjustedToFit: boolean } {
  const xLimit =
    scene.room.width / 2 - ROOM_INSET_M - object.dimensionsM.width / 2;
  const zLimit =
    scene.room.depth / 2 - ROOM_INSET_M - object.dimensionsM.depth / 2;
  const x = clamp(requested.x, -xLimit, xLimit);
  const z = clamp(requested.z, -zLimit, zLimit);

  return {
    position: [x, object.position[1], z],
    adjustedToFit: x !== requested.x || z !== requested.z,
  };
}

function success(
  previousScene: Scene,
  nextScene: Scene,
  message: string,
  details?: { adjustedToFit?: boolean; appliedPosition?: Vec3 },
): CommandResult {
  return {
    ok: true,
    previousScene,
    scene: SceneSchema.parse(nextScene),
    message,
    ...details,
  };
}

export function applySceneCommand(
  scene: Scene,
  request: CommandRequest,
): CommandResult {
  if (scene.revision !== request.expectedRevision) {
    return failure(
      scene,
      "SCENE_REVISION_CONFLICT",
      `Expected revision ${request.expectedRevision}, current revision is ${scene.revision}.`,
      true,
    );
  }

  const nextScene = structuredClone(scene);

  if (request.command.type === "set-style") {
    nextScene.styleIntent = request.command.style.trim();
    nextScene.revision += 1;
    return success(scene, nextScene, `Style set to ${nextScene.styleIntent}.`);
  }

  const object = findObject(nextScene, request.command.objectId);
  if (!object) {
    return failure(
      scene,
      "OBJECT_NOT_FOUND",
      `Object ${request.command.objectId} was not found.`,
    );
  }

  if (request.command.type === "preserve") {
    object.locked = request.command.preserved;
    nextScene.revision += 1;
    return success(
      scene,
      nextScene,
      request.command.preserved
        ? `${object.id} is preserved.`
        : `${object.id} is editable.`,
    );
  }

  if (object.locked) {
    return failure(
      scene,
      "OBJECT_LOCKED",
      `${object.id} is locked and cannot be changed.`,
    );
  }

  if (request.command.type === "replace") {
    if (object.type !== request.command.product.category) {
      return failure(
        scene,
        "CATEGORY_MISMATCH",
        `${request.command.product.category} cannot replace ${object.type}.`,
      );
    }

    const dimensionsM = {
      width: request.command.product.dimensionsCm.width / 100,
      height: request.command.product.dimensionsCm.height / 100,
      depth: request.command.product.dimensionsCm.depth / 100,
    };
    object.source = "product";
    object.product = structuredClone(request.command.product);
    object.dimensionsM = dimensionsM;
    object.position = [
      object.position[0],
      object.type === "rug" ? 0.01 : dimensionsM.height / 2,
      object.position[2],
    ];
    object.scale = [1, 1, 1];
    object.styleTags = [...request.command.product.styleTags];
    object.addedBy = request.actor;
    nextScene.revision += 1;

    return success(
      scene,
      nextScene,
      `${request.command.product.title} now previews in the room.`,
    );
  }

  const { position, adjustedToFit } = clampPositionToRoom(
    nextScene,
    object,
    request.command.position,
  );
  object.position = position;
  if (request.command.rotationYDegrees !== undefined) {
    object.rotation = [
      object.rotation[0],
      (request.command.rotationYDegrees * Math.PI) / 180,
      object.rotation[2],
    ];
  }
  object.addedBy = request.actor;
  nextScene.revision += 1;

  return success(scene, nextScene, `${object.id} moved.`, {
    adjustedToFit,
    appliedPosition: position,
  });
}
