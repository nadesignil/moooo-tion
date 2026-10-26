// Project manifest: the single place where every motion's timing lives.
// The agent writes the code that draws; the manifest says WHEN and with WHAT
// parameters. The studio edits the manifest live; code only reads it.
import {z} from 'zod';

export const CurveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bezier'),
    v: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('spring'),
    damping: z.number(),
    stiffness: z.number(),
    mass: z.number().optional(),
  }),
]);
export type Curve = z.infer<typeof CurveSchema>;

export const ParamValue = z.union([z.number(), z.string(), z.boolean()]);

export const ActionSchema = z.object({
  id: z.string(),
  /** human title, as a designer would say it */
  title: z.string(),
  /** the object it moves (display + grouping) */
  layer: z.string(),
  /** effect id from the catalog (role.name), informative for now */
  effect: z.string().optional(),
  /** seconds from the start of the scene */
  start: z.number(),
  /** seconds */
  duration: z.number().positive(),
  curve: CurveSchema,
  params: z.record(z.string(), ParamValue).optional(),
  variants: z.array(z.string()).optional(),
});
export type Action = z.infer<typeof ActionSchema>;

/** Subscene: display-only grouping of a scene's time range. */
export const GroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  from: z.number(),
  to: z.number(),
});
export type Group = z.infer<typeof GroupSchema>;

export const BacklogItemSchema = z.object({
  id: z.string(),
  /** where in the scene it applies (seconds) */
  at: z.number(),
  actionId: z.string().optional(),
  kind: z.enum(['prompt', 'effect', 'comment']),
  text: z.string(),
  createdAt: z.string(),
});
export type BacklogItem = z.infer<typeof BacklogItemSchema>;

/**
 * A visual object of the scene (phone, card, music…), wrapped in <Layer name> by the
 * code. The list is the stacking order (first = bottom); it is empty until the user
 * touches a layer in the studio — then it is written out in full.
 */
export const LayerSchema = z.object({
  name: z.string(),
  hidden: z.boolean().optional(),
  /** video/audio inside the layer plays silent */
  muted: z.boolean().optional(),
});
export type SceneLayer = z.infer<typeof LayerSchema>;

export const SceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** seconds */
  duration: z.number().positive(),
  groups: z.array(GroupSchema),
  actions: z.array(ActionSchema),
  layers: z.array(LayerSchema).default([]),
  backlog: z.array(BacklogItemSchema).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;

/** «Настройки проекта»: style and bans travel to the agent, the music plays under the whole video */
export const ProjectSettingsSchema = z.object({
  /** style preset id (runtime/styles.ts): 'dribbble-ui' | 'apple-keynote' | 'editorial' | 'custom' */
  style: z.string().default('custom'),
  /** the user's own words about the style (the «Свой» preset, or additions to a preset) */
  styleNote: z.string().optional(),
  /** techniques the agent must not use (crossfades, glows, particles…) */
  bans: z.array(z.string()).default([]),
  /** file inside public/ (audio/…); the runtime plays it under all scenes */
  music: z
    .object({
      file: z.string().optional(),
      gain: z.number().min(0).max(2).default(1),
      /** where in the track the video starts, seconds (play from the chorus without cutting the file) */
      from: z.number().min(0).optional(),
    })
    .optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** background of the «Оживление скриншота» variants: a shader (runtime/shaders.ts), a fill or an image */
export const BackgroundSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('shader'),
    shader: z.string(),
    /** c1 base, c2 main, c3 accent, c4 halo (blobs); empty → the preset's palette */
    colors: z.array(z.string()).max(4).optional(),
    speed: z.number().min(0).max(4).default(1),
    /** pattern size (dither, dot grid): 1 = default */
    zoom: z.number().min(0.25).max(4).optional(),
  }),
  /** one color = solid fill; two or three = linear gradient */
  z.object({
    type: z.literal('fill'),
    colors: z.array(z.string()).min(1).max(3),
    angle: z.number().default(160),
  }),
  /** file inside public/ */
  z.object({
    type: z.literal('image'),
    file: z.string(),
    fit: z.enum(['cover', 'contain']).default('cover'),
  }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

/** «Оживление скриншота»: one interface frame → a few short variants that differ by choreography */
export const ScreenTemplateSchema = z.object({
  /** the Figma frame — layers give exact elements to animate */
  figmaUrl: z.string(),
  /** optional end state: the video is a transition from figmaUrl to this frame */
  endFrameUrl: z.string().optional(),
  background: BackgroundSchema,
  /** animation preset: dribbble | keynote | custom (by the references) */
  preset: z.string().default('dribbble'),
  /** 1 — key elements move, 2 — key + secondary, 3 — key + secondary + the frame/scaffold */
  intensity: z.number().int().min(1).max(3).default(2),
  variants: z.number().int().min(1).max(4).default(2),
  /** device mockup from library/mockups/<material>/ */
  mockup: z
    .object({
      material: z.string(),
      /** copied into public/ at creation */
      file: z.string().default('mockup/device.png'),
      /** device image size and the screen rect inside it (px of that image); content goes UNDER the device */
      size: z.tuple([z.number(), z.number()]).optional(),
      screen: z.object({x: z.number(), y: z.number(), w: z.number(), h: z.number(), r: z.number()}).optional(),
    })
    .optional(),
  /** the motion is generated as AI video (Magnific) instead of Remotion code */
  aiVideo: z.boolean().default(false),
  prompt: z.string().optional(),
});
export type ScreenTemplate = z.infer<typeof ScreenTemplateSchema>;

export const TEMPLATES = ['showreel', 'screen'] as const;
export type TemplateKind = (typeof TEMPLATES)[number];

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** the length the user asked for; the header shows the deviation */
  targetSeconds: z.number().positive().optional(),
  /** the project's style and rules for the agent (sprint 2: «Настройки проекта») */
  settings: ProjectSettingsSchema.optional(),
  /** project template; absent = showreel. In «screen» every scene is a variant, rendered on its own */
  template: z.enum(TEMPLATES).optional(),
  screen: ScreenTemplateSchema.optional(),
  scenes: z.array(SceneSchema).min(1),
});
export type Project = z.infer<typeof ProjectSchema>;

export const isVariants = (project: Pick<Project, 'template'>) => project.template === 'screen';

export const sceneFrames = (scene: Scene, fps: number) => Math.round(scene.duration * fps);

export const projectFrames = (project: Project) => project.scenes.reduce((sum, s) => sum + sceneFrames(s, project.fps), 0);

/** Curve presets offered in the studio */
export const CURVE_PRESETS: Record<string, Curve> = {
  'Плавный выход': {type: 'bezier', v: [0.16, 1, 0.3, 1]},
  'Плавно туда-обратно': {type: 'bezier', v: [0.65, 0, 0.35, 1]},
  'Сильно туда-обратно': {type: 'bezier', v: [0.76, 0, 0.24, 1]},
  Разгон: {type: 'bezier', v: [0.7, 0, 0.84, 0]},
  'С перелётом': {type: 'bezier', v: [0.34, 1.4, 0.64, 1]},
  Линейно: {type: 'bezier', v: [0, 0, 1, 1]},
  'Пружина мягкая': {type: 'spring', damping: 16, stiffness: 110},
  'Пружина упругая': {type: 'spring', damping: 10, stiffness: 180},
};
