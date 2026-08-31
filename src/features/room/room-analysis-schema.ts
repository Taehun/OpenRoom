import { z } from "zod";

import { SceneObjectTypeSchema } from "../scene/scene-schema";

export const RoomAnalysisSchema = z
  .object({
    roomType: z.literal("living_room"),
    estimatedAspectRatio: z.number().positive(),
    openings: z.array(
      z
        .object({
          kind: z.enum(["door", "window"]),
          wall: z.enum(["front", "back", "left", "right"]),
          offset: z.number().min(0).max(1),
        })
        .strict(),
    ),
    objects: z.array(
      z
        .object({
          type: SceneObjectTypeSchema,
          anchor: z.string().min(1),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();

export type RoomAnalysis = z.infer<typeof RoomAnalysisSchema>;
